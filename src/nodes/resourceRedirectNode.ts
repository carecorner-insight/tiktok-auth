import type { CareyBotState } from '../types/state';
import type { NodeResult } from '../types/nodes';
import { COUNSELLING_URL } from '../config/questionnaire';

export function resourceRedirectNode(_state: CareyBotState): NodeResult {
  return {
    pendingResponse:
      `Here are some resources that may help:\n\n` +
      `📅 Book a counselling session: ${COUNSELLING_URL}\n\n` +
      `You can also reach out to someone you trust, or contact a crisis line if you need immediate support.`,
    conversationPhase: 'ended',
  };
}
