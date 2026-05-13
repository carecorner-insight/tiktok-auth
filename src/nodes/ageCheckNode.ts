import type { CareyBotState } from '../types/state';
import type { NodeResult } from '../types/nodes';

const AGE_CHECK_MESSAGE =
  "Hi! I'm Carey, a digital mental health support assistant for young people aged 13–25 in Singapore.\n\n" +
  "I'm not a real person, and it's best not to share personal details here.\n\n" +
  "Before we start, are you between 13 and 25 years old?\n\nYes / No";

export function ageCheckNode(_state: CareyBotState): NodeResult {
  return { pendingResponse: AGE_CHECK_MESSAGE };
}
