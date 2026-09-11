import type { CareyBotState } from '../types/state';
import type { NodeResult } from '../types/nodes';
import { WELCOME_TEXT, WELCOME_BACK_TEXT, SCENARIO_MENU_REPEAT_TEXT } from '../config/questionnaire';
import { screenerEnabled } from '../lib/pivotFlags';

// Triage build (NUS study) — unchanged.
const AGE_CHECK_MESSAGE =
  "I'm Carey. I help young people in Singapore with the social side of life — figuring out what to say, working through awkward moments, and talking about whatever's on your mind.\n\n" +
  "I'm not a real person, and it's best not to share personal details here.\n\n" +
  "Privacy Note: By replying, you consent to your messages being processed through Telegram's servers subject to their privacy policy. We store conversation history for quality improvement and crisis interventions only.\n\n" +
  "Before we start, how old are you? Please reply with just a number.";

export function ageCheckNode(state: CareyBotState): NodeResult {
  if (!screenerEnabled()) {
    // Returning user whose age we already know (loaded from the persistent
    // age:{platform}:{userId} key): don't re-ask, and don't re-read the full
    // disclosures at every session — go straight to the scenario menu.
    if (state.age !== null) {
      return {
        pendingResponse: `${WELCOME_BACK_TEXT}\n\n${SCENARIO_MENU_REPEAT_TEXT}`,
        conversationPhase: 'menu',
      };
    }
    return { pendingResponse: WELCOME_TEXT };
  }

  return { pendingResponse: AGE_CHECK_MESSAGE };
}
