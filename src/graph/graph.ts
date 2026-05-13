import { StateGraph, Annotation, END, START } from '@langchain/langgraph';
import type { CareyBotState, Platform, ConversationPhase, MenuOption, Message } from '../types/state';
import type { tag } from '../types/state';

import { router } from '../nodes/router';
import { questionnaireNode } from '../nodes/questionnaireNode';
import { answerEvaluator } from '../nodes/answerEvaluator';
import { emergencyHandler } from '../nodes/emergencyHandler';
import { menuPresenter } from '../nodes/menuPresenter';
import { optionRouter } from '../nodes/optionRouter';
import { resourceRedirectNode } from '../nodes/resourceRedirectNode';
import { restartNode } from '../nodes/restartNode';

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
  chat(chatId: string | null, text: string): Promise<{ reply: string; chatId: string }>;
}

export interface GraphServices {
  whitelist: IWhitelistService;
  session: ISessionManager;
  aiBots: IAIBotsClient;
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
  if (!state.isAuthorized) return END;
  return router(state as CareyBotState);
}

function routeFromAnswerEvaluator(state: typeof GraphAnnotation.State): string {
  if (state.tag === 'high') return 'emergencyHandler';
  if (state.questionIndex < 9) return 'questionnaireNode';
  return 'menuPresenter';
}

function routeFromOptionRouter(state: typeof GraphAnnotation.State): string {
  if (!state.selectedOption) return 'sessionPersister'; // invalid selection
  const map: Record<number, string> = {
    1: 'freeTextNode',
    2: 'wellbeingCheckNode',
    3: 'stressManagementNode',
    4: 'resourceRedirectNode',
  };
  return map[state.selectedOption];
}

// ── Graph builder ─────────────────────────────────────────────────────────────

export function buildGraph(services: GraphServices) {
  const authGuard       = makeAuthGuard(services.whitelist);
  const freeTextNode    = makeFreeTextNode(services.aiBots);
  const wellbeingCheck  = makeWellbeingCheckNode(services.aiBots);
  const stressMgmt      = makeStressManagementNode(services.aiBots);
  const sessionPersist  = makeSessionPersister(services.session);

  const graph = new StateGraph(GraphAnnotation)

    // ── Nodes ──
    .addNode('authGuard',            authGuard)
    .addNode('restartNode',          restartNode)
    .addNode('questionnaireNode',    questionnaireNode)
    .addNode('answerEvaluator',      answerEvaluator)
    .addNode('emergencyHandler',     emergencyHandler)
    .addNode('menuPresenter',        menuPresenter)
    .addNode('optionRouter',         optionRouter)
    .addNode('freeTextNode',         freeTextNode)
    .addNode('wellbeingCheckNode',   wellbeingCheck)
    .addNode('stressManagementNode', stressMgmt)
    .addNode('resourceRedirectNode', resourceRedirectNode)
    .addNode('sessionPersister',     sessionPersist)

    // ── Entry ──
    .addEdge(START, 'authGuard')

    // ── Auth check → dispatch by phase, or END for unauthorized ──
    .addConditionalEdges('authGuard', routeFromAuth, {
      restartNode:          'restartNode',
      questionnaireNode:    'questionnaireNode',
      answerEvaluator:      'answerEvaluator',
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
