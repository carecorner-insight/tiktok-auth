import type { CareyBotState } from '../types/state';
import type { NodeResult } from '../types/nodes';
import { EMERGENCY_MESSAGE } from '../config/questionnaire';

export function emergencyHandler(_state: CareyBotState): NodeResult {
  return {
    pendingResponse: EMERGENCY_MESSAGE,
    conversationPhase: 'ended',
  };
}
