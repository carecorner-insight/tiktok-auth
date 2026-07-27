import type { CareyBotState } from '../types/state';
import type { NodeResult } from '../types/nodes';

const AGE_CHECK_MESSAGE =
  "Hi! I'm Carey, a digital mental health support assistant for young people aged 13–25 in Singapore.\n\n" +
  "I'm not a real person, and it's best not to share personal details here.\n\n" +
  "Privacy Note: By replying, you consent to your messages being processed through Telegram's servers subject to their privacy policy. We store conversation history for quality improvement and crisis interventions only.\n\n"
  "Before we start, how old are you? Please reply with just a number.";

export function ageCheckNode(_state: CareyBotState): NodeResult {
  return { pendingResponse: AGE_CHECK_MESSAGE };
}
