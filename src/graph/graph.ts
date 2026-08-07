import { StateGraph, Annotation, END, START } from '@langchain/langgraph';
import type { CareyBotState, Platform, ConversationPhase, MenuOption, Message } from '../types/state';
import type { tag } from '../types/state';
import { TOTAL_QUESTIONS } from '../config/questionnaire';

import { makeRouter } from '../nodes/router';
import { questionnaireNode } from '../nodes/questionnaireNode';
import { answerEvaluator } from '../nodes/answerEvaluator';
import { makeEmergencyHandler } from '../nodes/emergencyHandler';
import { makeMenuPresenter } from '../nodes/menuPresenter';
import { makeIntentClassifierNode } from '../nodes/intentClassifierNode';
import type { MenuMode } from '../lib/menuMode';
import { scenarioMenuEnabled } from '../lib/pivotFlags';
import { makeResourceRedirectNode } from '../nodes/resourceRedirectNode';
import { restartNode } from '../nodes/restartNode';
import { ageCheckNode } from '../nodes/ageCheckNode';
import { ageGateNode } from '../nodes/ageGateNode';

import { makeAuthGuard } from '../nodes/authGuard';
import { makeFreeTextNode } from '../nodes/freeTextNode';
import { makeSocialCoachNode } from '../nodes/socialCoachNode';
import { makeSessionPersister } from '../nodes/sessionPersister';
import { safetyCheckNode } from '../nodes/safetyCheckNode';
import { safetyGateNode } from '../nodes/safetyGateNode';

// ── Services interfaces (graph accepts abstractions, not concretions) ─────────

interface IWhitelistService {
  isAuthorized(platform: Platform, userId: string): Promise<boolean>;
}

interface ISessionManager {
  save(state: CareyBotState): Promise<void>;
  clear(platform: Platform, userId: string): Promise<void>;
}

interface IAIBotsClient {
  chat(chatId: string | null, text: string, primeMessage?: string): Promise<{ reply: string; chatId: string }>;
}

interface ITypingIndicator {
  sendTypingIndicator(userId: string): Promise<void>;
}

export interface GraphServices {
  whitelist: IWhitelistService;
  session: ISessionManager;
  aiBots: IAIBotsClient;
  socialCoach: IAIBotsClient; // separate AIBots/Directus bot for menu option 2
  intentLLM: IAIBotsClient;   // cheap DirectLLMClient seeded with INTENT_CLASSIFIER_PROMPT
  menuMode: MenuMode;         // 'intent' | 'numbered' — A/B toggle for the entry UX
  typing: ITypingIndicator;
}

// ── State annotation — replacement reducers for arrays ────────────────────────
// LangGraph default concatenates arrays; we always want full replacement.

const GraphAnnotation = Annotation.Root({
  platform:           Annotation<Platform>,
  userId:             Annotation<string>,
  conversationId:     Annotation<string>,
  isAuthorized:       Annotation<boolean>,
  age:                Annotation<number | null>,
  questionIndex:      Annotation<number>,
  answers:            Annotation<string[]>({ reducer: (_, next) => next, default: () => [] }),
  tag:                Annotation<tag | null>,
  conversationPhase:  Annotation<ConversationPhase>,
  selectedOption:     Annotation<MenuOption | null>,
  messages:           Annotation<Message[]>({ reducer: (_, next) => next, default: () => [] }),
  pendingResponse:    Annotation<string | null>,
  crisisDetected:     Annotation<boolean>,
  pendingHandoff:     Annotation<'socialCoach' | null>,
  socialCoachOffered: Annotation<boolean>,
  referralRequested:  Annotation<boolean>,
  awaitingReferralAge: Annotation<boolean>,
  ageAsked:           Annotation<boolean>,
  justSwitchedLane:   Annotation<boolean>,
  aiBotChatId:        Annotation<string | null>,
});

// ── Routing functions (used in addConditionalEdges) ───────────────────────────

// After auth check, call the router to get the target node. Unauthorized users
// end here; authorized users are dispatched by phase. The router is mode-aware
// (intent re-classifies in-lane turns), so it's built per-graph from menuMode.
function makeRouteFromAuth(router: (s: CareyBotState) => string) {
  return function routeFromAuth(state: typeof GraphAnnotation.State): string {
    if (!state.isAuthorized) {
      console.log('[route] auth → END (unauthorized)');
      return END;
    }
    const next = router(state as CareyBotState);
    console.log(`[route] auth → ${next}`);
    return next;
  };
}

function routeFromAnswerEvaluator(state: typeof GraphAnnotation.State): string {
  const next =
    state.tag === 'high'                  ? 'emergencyHandler'  :
    state.questionIndex < TOTAL_QUESTIONS ? 'questionnaireNode' :
    state.tag === 'moderate'              ? 'safetyCheckNode'   :
                                            'menuPresenter';
  console.log(`[route] answerEvaluator → ${next} (tag=${state.tag}, questionIndex=${state.questionIndex})`);
  return next;
}

function routeFromSafetyGate(state: typeof GraphAnnotation.State): string {
  const next = state.crisisDetected ? 'emergencyHandler' : 'menuPresenter';
  console.log(`[route] safetyGate → ${next} (crisisDetected=${state.crisisDetected})`);
  return next;
}

function routeFromIntentClassifier(state: typeof GraphAnnotation.State): string {
  // Crisis (local phrase match or LLM label) → emergency response this turn.
  if (state.crisisDetected && state.conversationPhase === 'crisis') {
    console.log('[route] intentClassifier → emergencyHandler (crisis)');
    return 'emergencyHandler';
  }
  if (!state.selectedOption) {
    // UNCLEAR / LLM failure — pendingResponse already carries the fallback menu.
    console.log('[route] intentClassifier → sessionPersister (unclear → menu fallback)');
    return 'sessionPersister';
  }
  const map: Record<number, string> = scenarioMenuEnabled()
    ? { 1: 'socialCoachNode', 2: 'socialCoachNode', 3: 'socialCoachNode',
        4: 'socialCoachNode', 5: 'socialCoachNode', 6: 'socialCoachNode' }
    : { 1: 'freeTextNode', 2: 'socialCoachNode', 3: 'resourceRedirectNode' };
  const next = map[state.selectedOption];
  console.log(`[route] intentClassifier → ${next} (selectedOption=${state.selectedOption})`);
  return next;
}

// The coach emitted [REFERRAL] — hand off to the age-triaged referral. This is
// the Growing We build's only user-reachable route to a human.
function routeFromSocialCoach(state: typeof GraphAnnotation.State): string {
  if (state.crisisDetected && state.conversationPhase === 'crisis') {
    return 'emergencyHandler';
  }
  if (state.referralRequested) {
    console.log('[route] socialCoach → resourceRedirectNode (referral)');
    return 'resourceRedirectNode';
  }
  return 'sessionPersister';
}

// ── Graph builder ─────────────────────────────────────────────────────────────

export function buildGraph(services: GraphServices) {
  const authGuard        = makeAuthGuard(services.whitelist);
  const emergencyHandler = makeEmergencyHandler(services.aiBots, services.typing);
  const freeTextNode     = makeFreeTextNode(services.aiBots, services.typing, services.menuMode);
  const socialCoach      = makeSocialCoachNode(services.socialCoach, services.typing);
  const resourceRedirect = makeResourceRedirectNode(services.aiBots, services.typing);
  const sessionPersist   = makeSessionPersister(services.session);
  const menuPresenter    = makeMenuPresenter(services.menuMode);
  const intentClassifier = makeIntentClassifierNode(services.intentLLM, services.menuMode);
  const routeFromAuth    = makeRouteFromAuth(makeRouter(services.menuMode));

  const graph = new StateGraph(GraphAnnotation)

    // ── Nodes ──
    .addNode('authGuard',            authGuard)
    .addNode('restartNode',          restartNode)
    .addNode('ageCheckNode',         ageCheckNode)
    .addNode('ageGateNode',          ageGateNode)
    .addNode('questionnaireNode',    questionnaireNode)
    .addNode('answerEvaluator',      answerEvaluator)
    .addNode('safetyCheckNode',      safetyCheckNode)
    .addNode('safetyGateNode',       safetyGateNode)
    .addNode('emergencyHandler',     emergencyHandler)
    .addNode('menuPresenter',        menuPresenter)
    .addNode('intentClassifierNode', intentClassifier)
    .addNode('freeTextNode',         freeTextNode)
    .addNode('socialCoachNode',      socialCoach)
    .addNode('resourceRedirectNode', resourceRedirect)
    .addNode('sessionPersister',     sessionPersist)

    // ── Entry ──
    .addEdge(START, 'authGuard')

    // ── Auth check → dispatch by phase, or END for unauthorized ──
    .addConditionalEdges('authGuard', routeFromAuth, {
      restartNode:          'restartNode',
      ageCheckNode:         'ageCheckNode',
      ageGateNode:          'ageGateNode',
      questionnaireNode:    'questionnaireNode',
      answerEvaluator:      'answerEvaluator',
      safetyCheckNode:      'safetyCheckNode',
      safetyGateNode:       'safetyGateNode',
      emergencyHandler:     'emergencyHandler',
      menuPresenter:        'menuPresenter',
      intentClassifierNode: 'intentClassifierNode',
      freeTextNode:         'freeTextNode',
      resourceRedirectNode: 'resourceRedirectNode',
      socialCoachNode:      'socialCoachNode',
      sessionPersister:     'sessionPersister',
      [END]: END,
    })

    // ── answerEvaluator → emergency | next question | safety check | menu ──
    .addConditionalEdges('answerEvaluator', routeFromAnswerEvaluator, {
      emergencyHandler:  'emergencyHandler',
      questionnaireNode: 'questionnaireNode',
      safetyCheckNode:   'safetyCheckNode',
      menuPresenter:     'menuPresenter',
    })

    // ── safetyGateNode → emergency (not safe) | menu (safe) ──
    .addConditionalEdges('safetyGateNode', routeFromSafetyGate, {
      emergencyHandler: 'emergencyHandler',
      menuPresenter:    'menuPresenter',
    })

    // ── socialCoach → crisis | referral | done ──
    .addConditionalEdges('socialCoachNode', routeFromSocialCoach, {
      emergencyHandler:     'emergencyHandler',
      resourceRedirectNode: 'resourceRedirectNode',
      sessionPersister:     'sessionPersister',
    })

    // ── intentClassifier → crisis | option node | menu fallback ──
    .addConditionalEdges('intentClassifierNode', routeFromIntentClassifier, {
      emergencyHandler:     'emergencyHandler',
      freeTextNode:         'freeTextNode',
      resourceRedirectNode: 'resourceRedirectNode',
      socialCoachNode:      'socialCoachNode',
      sessionPersister:     'sessionPersister',
    })

    // ── All terminal nodes → sessionPersister → END ──
    .addEdge('restartNode',          'sessionPersister')
    .addEdge('ageCheckNode',         'sessionPersister')
    .addEdge('ageGateNode',          'sessionPersister')
    .addEdge('questionnaireNode',    'sessionPersister')
    .addEdge('safetyCheckNode',      'sessionPersister')
    .addEdge('emergencyHandler',     'sessionPersister')
    .addEdge('menuPresenter',        'sessionPersister')
    .addEdge('freeTextNode',         'sessionPersister')
    .addEdge('resourceRedirectNode', 'sessionPersister')
    .addEdge('sessionPersister',     END);

  return graph.compile();
}
