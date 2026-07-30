import type { CareyBotState } from '../types/state';
import type { NodeResult } from '../types/nodes';
import { OPENING_TEXT, MENU_TEXT } from '../config/questionnaire';
import type { MenuMode } from '../lib/menuMode';

// `intent` mode presents the open-ended prompt (LLM classifies the reply);
// `numbered` mode presents the classic numbered menu. Toggled globally via the
// UAT live-log page for A/B testing.
export function makeMenuPresenter(mode: MenuMode) {
  return function menuPresenter(_state: CareyBotState): NodeResult {
    return {
      pendingResponse: mode === 'numbered' ? MENU_TEXT : OPENING_TEXT,
      conversationPhase: 'menu',
      aiBotChatId: null,
    };
  };
}
