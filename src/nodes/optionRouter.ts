import type { CareyBotState, MenuOption } from '../types/state';
import type { NodeResult } from '../types/nodes';
import { getLastUserInput } from '../types/nodes';
import { MENU_TEXT } from '../config/questionnaire';

const VALID_OPTIONS = new Set([1, 2, 3, 4]);

export function optionRouter(state: CareyBotState): NodeResult {
  const raw = getLastUserInput(state).replace(/[.\s]/g, '');
  const parsed = parseInt(raw, 10);

  if (VALID_OPTIONS.has(parsed)) {
    return {
      selectedOption: parsed as MenuOption,
      conversationPhase: 'option',
    };
  }

  return {
    selectedOption: null,
    pendingResponse: MENU_TEXT,
    conversationPhase: 'menu',
  };
}
