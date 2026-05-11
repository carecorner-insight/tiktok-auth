import type { CareyBotState } from '@/types/state';
import type { NodeResult } from '@/types/nodes';
import { PHQ9_QUESTIONS, TOTAL_QUESTIONS } from '@/config/questionnaire';

export function questionnaireNode(state: CareyBotState): NodeResult {
  if (state.questionIndex >= TOTAL_QUESTIONS) {
    throw new Error(`questionnaireNode: questionIndex ${state.questionIndex} out of bounds`);
  }

  const question = PHQ9_QUESTIONS[state.questionIndex];
  return {
    pendingResponse: `${question.text}\n\nYes / No`,
  };
}
