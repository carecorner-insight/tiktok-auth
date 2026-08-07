import type { CareyBotState } from '../types/state';
import type { NodeResult } from '../types/nodes';
import {
  OPENING_TEXT,
  MENU_TEXT,
  SCENARIO_MENU_TEXT,
  SCENARIO_MENU_REPEAT_TEXT,
} from '../config/questionnaire';
import type { MenuMode } from '../lib/menuMode';
import { scenarioMenuEnabled } from '../lib/pivotFlags';

// Growing We build: the 6-option scenario menu, always numbered.
// Triage build: `intent` mode presents the open-ended prompt (LLM classifies the
// reply); `numbered` mode presents the classic 3-option menu. Toggled globally
// via the UAT live-log page for A/B testing.
export function makeMenuPresenter(mode: MenuMode) {
  return function menuPresenter(state: CareyBotState): NodeResult {
    if (scenarioMenuEnabled()) {
      // First showing leads with "Thanks!" (it follows the age reply); a
      // re-display via the "menu" keyword drops it, per the brief.
      const isRedisplay = state.conversationPhase === 'option' || state.selectedOption !== null;
      return {
        pendingResponse: isRedisplay ? SCENARIO_MENU_REPEAT_TEXT : SCENARIO_MENU_TEXT,
        conversationPhase: 'menu',
        selectedOption: null,
        aiBotChatId: null,
      };
    }

    return {
      pendingResponse: mode === 'numbered' ? MENU_TEXT : OPENING_TEXT,
      conversationPhase: 'menu',
      aiBotChatId: null,
    };
  };
}
