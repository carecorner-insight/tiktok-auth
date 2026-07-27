import type { CareyBotState } from '../types/state';
import type { NodeResult } from '../types/nodes';

const AGE_CHECK_MESSAGE =
  "Hi! I'm Carey, a digital mental health support assistant for young people aged 13–25 in Singapore.\n\n" +
  "I'm not a real person, and it's best not to share personal details here.\n\n" +
  "Before we start, how old are you? Please reply with just a number.";

export function restartNode(_state: CareyBotState): NodeResult {
  return {
    age: null,
    questionIndex: 0,
    answers: [],
    tag: null,
    conversationPhase: 'ageCheck',
    selectedOption: null,
    messages: [],
    pendingResponse: AGE_CHECK_MESSAGE,
    crisisDetected: false,
    aiBotChatId: null,
  };
}
