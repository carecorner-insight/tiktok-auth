import type { CareyBotState } from '../types/state';
import type { NodeResult } from '../types/nodes';
import { getLastUserInput } from '../types/nodes';
import { PHQ9_QUESTIONS } from '../config/questionnaire';

const OUT_OF_SCOPE_MESSAGE =
  "Thanks for letting me know.\n\n" +
  "This space is mainly designed for young people aged 13–25, but I still want to make sure you're supported.\n\n" +
  "If you'd like, you can still tell me what's been going on, and I'll do my best to support you here.\n\n" +
  "And if you'd like extra support, you can also reach the Care Corner team here:\nhttps://carecorner-ist.my.site.com/insight/";

const QUESTIONNAIRE_PREAMBLE =
  "Thanks! I'd like to ask you 4 short questions about how you've been feeling over the past 2 weeks. " +
  "Please answer Yes or No to each one.";

export function ageGateNode(state: CareyBotState): NodeResult {
  const input = getLastUserInput(state);

  if (input !== 'yes' && input !== 'no') {
    return {
      pendingResponse: `Please reply with Yes or No.\n\nAre you between 13 and 25 years old?\n\nYes / No`,
    };
  }

  if (input === 'no') {
    return {
      conversationPhase: 'option',
      selectedOption: 1,
      pendingResponse: OUT_OF_SCOPE_MESSAGE,
    };
  }

  // Yes — move directly to Q1
  return {
    conversationPhase: 'questionnaire',
    pendingResponse: `${QUESTIONNAIRE_PREAMBLE}\n\n${PHQ9_QUESTIONS[0].text}\n\nYes / No`,
  };
}
