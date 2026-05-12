import type { CareyBotState } from '../types/state';
import type { NodeResult } from '../types/nodes';
import { PHQ9_QUESTIONS, TOTAL_QUESTIONS, INTRO_MESSAGE } from '../config/questionnaire';

export function questionnaireNode(state: CareyBotState): NodeResult {
  if (state.questionIndex >= TOTAL_QUESTIONS) {
    throw new Error(`questionnaireNode: questionIndex ${state.questionIndex} out of bounds`);
  }

  const question = PHQ9_QUESTIONS[state.questionIndex];
  const questionText = `${question.text}\n\nYes / No`;

  const hasSpokenBefore = state.messages.some(m => m.role === 'assistant');
  const response = (!hasSpokenBefore && state.questionIndex === 0)
    ? `${INTRO_MESSAGE}\n\n${questionText}`
    : questionText;

  return { pendingResponse: response };
}
