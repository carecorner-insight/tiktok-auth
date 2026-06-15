import type { CareyBotState } from '../types/state';
import type { NodeResult } from '../types/nodes';
import { SAFETY_CHECK_MESSAGE } from '../config/questionnaire';

// Presents the safety check question to a MODERATE-scored user.
// On the next turn, safetyGateNode evaluates the answer.
export function safetyCheckNode(_state: CareyBotState): NodeResult {
  return {
    pendingResponse: SAFETY_CHECK_MESSAGE,
    conversationPhase: 'safetyCheck',
  };
}
