import { randomUUID } from 'crypto';
import type { CareyBotState } from '../types/state';
import type { NodeResult } from '../types/nodes';
import { ageCheckNode } from './ageCheckNode';
import { newKpiState } from '../analytics/contract';

export function restartNode(_state: CareyBotState): NodeResult {
  return {
    sessionId: randomUUID(),
    ...(_state.kpi ? { kpi: newKpiState(_state.messages[_state.messages.length - 1]?.timestamp ?? Date.now()) } : {}),
    age: null,
    questionIndex: 0,
    answers: [],
    tag: null,
    conversationPhase: 'ageCheck',
    selectedOption: null,
    messages: [],
    pendingResponse: ageCheckNode({ ..._state, age: null }).pendingResponse,
    crisisDetected: false,
    pendingHandoff: null,
    socialCoachOffered: false,
    aiBotChatId: null,
    menuSelection: false,
    justSwitchedLane: false,
    referralRequested: false,
    awaitingReferralAge: false,
    ageAsked: false,
  };
}
