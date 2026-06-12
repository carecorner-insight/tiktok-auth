import { StateGraph, Annotation, END, START } from '@langchain/langgraph';
import type { CareyBotState, Platform, ConversationPhase, MenuOption, Message } from '../types/state';
import type { tag } from '../types/state';
import { TOTAL_QUESTIONS } from '../config/questionnaire';

import { router } from '../nodes/router';
import { questionnaireNode } from '../nodes/questionnaireNode';
import { answerEvaluator } from '../nodes/answerEvaluator';
import { makeEmergencyHandler } from '../nodes/emergencyHandler';
import { menuPresenter } from '../nodes/menuPresenter';
import { optionRouter } from '../nodes/optionRouter';
import { makeResourceRedirectNode } from '../nodes/resourceRedirectNode';
import { restartNode } from '../nodes/restartNode';
import { ageCheckNode } from '../nodes/ageCheckNode';
import { ageGateNode } from '../nodes/ageGateNode';

import { makeAuthGuard } from '../nodes/authGuard';
import { makeFreeTextNode } from '../nodes/freeTextNode';
import { makeWellbeingCheckNode } from '../nodes/wellbeingCheckNode';
import { makeStressManagementNode } from '../nodes/stressManagementNode';
import { makeSessionPersister } from '../nodes/sessionPersister';

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
  typing: ITypingIndicator;
}

// ── State annotation — replacement reducers for arrays ────────────────────────
// LangGraph default concatenates arrays; we always want full replacement.

const GraphAnnotation = Annotation.Root({
  platform:           Annotation<Platform>,
  userId:             Annotation<string>,
  conversationId:     Annotation<string>,
  isAuthorized:       Annotation<boolean>,
  questionIndex:      Annotation<number>,
  answers:            Annotation<string[]>({ reducer: (_, next) => next, default: () => [] }),
  tag:                Annotation<tag | null>,
  conversationPhase:  Annotation<ConversationPhase>,
  selectedOption:     Annotation<MenuOption | null>,
  messages:           Annotation<Message[]>({ reducer: (_, next) => next, default: () => [] }),
  pendingResponse:    Annotation<string | null>,
  crisisDetected:     Annotation<boolean>,
  aiBotChatId:        Annotation<string | null>,
});

// ── Routing functions (used in addConditionalEdges) ───────────────────────────

// After auth check, call the router directly to get the target node.
// Unauthorized users end here; authorized users are dispatched by phase.
function routeFromAuth(state: typeof GraphAnnotation.State): string {
  if (!state.isAuthorized) {
    console.log('[route] auth → END (unauthorized)');
    return END;
  }
  const next = router(state as CareyBotState);
  console.log(`[route] auth → ${next}`);
  return next;
}

function routeFromAnswerEvaluator(state: typeof GraphAnnotation.State): string {
  const next =
    state.tag === 'high'                        ? 'emergencyHandler'  :
    state.questionIndex < TOTAL_QUESTIONS       ? 'questionnaireNode' :
                                                  'menuPresenter';
  console.log(`[route] answerEvaluator → ${next} (tag=${state.tag}, questionIndex=${state.questionIndex})`);
  return next;
}

function routeFromOptionRouter(state: typeof GraphAnnotation.State): string {
  if (!state.selectedOption) {
    console.log('[route] optionRouter → sessionPersister (invalid selection)');
    return 'sessionPersister';
  }
  const map: Record<number, string> = {
    1: 'freeTextNode',
    2: 'wellbeingCheckNode',
    3: 'stressManagementNode',
    4: 'resourceRedirectNode',
  };
  const next = map[state.selectedOption];
  console.log(`[route] optionRouter → ${next} (selectedOption=${state.selectedOption})`);
  return next;
}

// ── Graph builder ─────────────────────────────────────────────────────────────

export function buildGraph(services: GraphServices) {
  const authGuard        = makeAuthGuard(services.whitelist);
  const emergencyHandler = makeEmergencyHandler(services.aiBots, services.typing);
  const freeTextNode     = makeFreeTextNode(services.aiBots, services.typing);
  const wellbeingCheck   = makeWellbeingCheckNode(services.aiBots, services.typing);
  const stressMgmt       = makeStressManagementNode(services.aiBots, services.typing);
  const resourceRedirect = makeResourceRedirectNode(services.aiBots, services.typing);
  const sessionPersist   = makeSessionPersister(services.session);

  const graph = new StateGraph(GraphAnnotation)

    // ── Nodes ──
    .addNode('authGuard',            authGuard)
    .addNode('restartNode',          restartNode)
    .addNode('ageCheckNode',         ageCheckNode)
    .addNode('ageGateNode',          ageGateNode)
    .addNode('questionnaireNode',    questionnaireNode)
    .addNode('answerEvaluator',      answerEvaluator)
    .addNode('emergencyHandler',     emergencyHandler)
    .addNode('menuPresenter',        menuPresenter)
    .addNode('optionRouter',         optionRouter)
    .addNode('freeTextNode',         freeTextNode)
    .addNode('wellbeingCheckNode',   wellbeingCheck)
    .addNode('stressManagementNode', stressMgmt)
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
      emergencyHandler:     'emergencyHandler',
      menuPresenter:        'menuPresenter',
      optionRouter:         'optionRouter',
      freeTextNode:         'freeTextNode',
      wellbeingCheckNode:   'wellbeingCheckNode',
      stressManagementNode: 'stressManagementNode',
      resourceRedirectNode: 'resourceRedirectNode',
      sessionPersister:     'sessionPersister',
      [END]: END,
    })

    // ── answerEvaluator → emergency | next question | menu ──
    .addConditionalEdges('answerEvaluator', routeFromAnswerEvaluator, {
      emergencyHandler:  'emergencyHandler',
      questionnaireNode: 'questionnaireNode',
      menuPresenter:     'menuPresenter',
    })

    // ── optionRouter → option node | re-present menu ──
    .addConditionalEdges('optionRouter', routeFromOptionRouter, {
      freeTextNode:         'freeTextNode',
      wellbeingCheckNode:   'wellbeingCheckNode',
      stressManagementNode: 'stressManagementNode',
      resourceRedirectNode: 'resourceRedirectNode',
      sessionPersister:     'sessionPersister',
    })

    // ── All terminal nodes → sessionPersister → END ──
    .addEdge('restartNode',          'sessionPersister')
    .addEdge('ageCheckNode',         'sessionPersister')
    .addEdge('ageGateNode',          'sessionPersister')
    .addEdge('questionnaireNode',    'sessionPersister')
    .addEdge('emergencyHandler',     'sessionPersister')
    .addEdge('menuPresenter',        'sessionPersister')
    .addEdge('freeTextNode',         'sessionPersister')
    .addEdge('wellbeingCheckNode',   'sessionPersister')
    .addEdge('stressManagementNode', 'sessionPersister')
    .addEdge('resourceRedirectNode', 'sessionPersister')
    .addEdge('sessionPersister',     END);

  return graph.compile();
}
