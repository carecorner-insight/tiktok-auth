import type { CareyBotState } from '../types/state';
import type { NodeResult } from '../types/nodes';
import { getLastUserInput } from '../types/nodes';
import { RISK_THRESHOLDS, PHQ9_QUESTIONS } from '../config/questionnaire';

export function answerEvaluator(state: CareyBotState): NodeResult {
  const input = getLastUserInput(state);

  if (input !== 'yes' && input !== 'no') {
    const question = PHQ9_QUESTIONS[state.questionIndex];
    return {
      pendingResponse: `Please reply with Yes or No.\n\n${question.text}\n\nYes / No`,
    };
  }

  const isYes = input === 'yes';
  const newAnswers = [...state.answers, input];
  const newIndex = state.questionIndex + 1;

  // Q1 (index 0) = suicidal ideation — any "yes" is immediate high risk
  if (state.questionIndex === 0 && isYes) {
    return {
      answers: newAnswers,
      questionIndex: newIndex,
      tag: 'high',
      crisisDetected: true,
      conversationPhase: 'ended',
    };
  }

  // Questions 2–8 still in progress — just record and advance
  if (newIndex < 9) {
    return {
      answers: newAnswers,
      questionIndex: newIndex,
    };
  }

  // All 9 questions answered — tabulate Q2–Q9 (indices 1–8)
  const tabScore = newAnswers.slice(1).filter(a => a === 'yes').length;
  const tag =
    tabScore >= RISK_THRESHOLDS.high   ? 'high'   :
    tabScore >= RISK_THRESHOLDS.medium ? 'medium' :
                                         'low';

  return {
    answers: newAnswers,
    questionIndex: newIndex,
    tag,
    crisisDetected: tag === 'high',
    conversationPhase: tag === 'high' ? 'ended' : 'menu',
  };
}
