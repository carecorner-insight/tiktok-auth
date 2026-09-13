import type { CareyBotState } from '../types/state';
import type { NodeResult } from '../types/nodes';
import { ageCheckNode } from './ageCheckNode';

export function restartNode(_state: CareyBotState): NodeResult {
  return {
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
