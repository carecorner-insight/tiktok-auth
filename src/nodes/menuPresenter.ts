import type { CareyBotState } from '../types/state';
import type { NodeResult } from '../types/nodes';
import { MENU_TEXT } from '../config/questionnaire';

export function menuPresenter(_state: CareyBotState): NodeResult {
  return {
    pendingResponse: MENU_TEXT,
    conversationPhase: 'menu',
  };
}
