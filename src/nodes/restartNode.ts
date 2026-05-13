import type { CareyBotState } from '../types/state';
import type { NodeResult } from '../types/nodes';
import { PHQ9_QUESTIONS, INTRO_MESSAGE } from '../config/questionnaire';

export function restartNode(_state: CareyBotState): NodeResult {
  return {
    questionIndex: 0,
    answers: [],
    tag: null,
    conversationPhase: 'questionnaire',
    selectedOption: null,
    messages: [],
    pendingResponse: `${INTRO_MESSAGE}\n\n${PHQ9_QUESTIONS[0].text}\n\nYes / No`,
    crisisDetected: false,
    aiBotChatId: null,
  };
}
