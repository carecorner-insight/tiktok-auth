import type { CareyBotState } from '../types/state';
import type { NodeResult } from '../types/nodes';
import { getLastUserInput } from '../types/nodes';
import { CSSRS_QUESTIONS, TOTAL_QUESTIONS } from '../config/questionnaire';

// C-SSRS risk scoring (applied once all 4 questions are answered).
// By this point Q3 and Q4 are guaranteed "no" — any "yes" triggers early HIGH exit.
//
// Priority order (highest wins):
//   Q2 = yes                → MODERATE (active suicidal ideation, no plan/attempt)
//   Q1 = yes, Q2 = no       → ELEVATED (passive death wish only)
//   Q1 = no, Q2 = no        → LOW
function scoreAnswers(answers: string[]): 'low' | 'elevated' | 'moderate' {
  const q2Yes = answers[1] === 'yes';
  const q1Yes = answers[0] === 'yes';
  if (q2Yes) return 'moderate';
  if (q1Yes) return 'elevated';
  return 'low';
}

export function answerEvaluator(state: CareyBotState): NodeResult {
  const input = getLastUserInput(state).toLowerCase().trim();

  if (input !== 'yes' && input !== 'no') {
    const question = CSSRS_QUESTIONS[state.questionIndex];
    return {
      pendingResponse: `Please reply with Yes or No.\n\n${question.text}\n\nYes / No`,
    };
  }

  const isYes      = input === 'yes';
  const newAnswers = [...state.answers, input];
  const newIndex   = state.questionIndex + 1;
  const question   = CSSRS_QUESTIONS[state.questionIndex];

  // Q3 or Q4 answered yes → immediate HIGH risk, stop the screener
  if (question.isHighRiskTrigger && isYes) {
    return {
      answers: newAnswers,
      questionIndex: newIndex,
      tag: 'high',
      crisisDetected: true,
    };
  }

  // More questions remain — record answer and advance
  if (newIndex < TOTAL_QUESTIONS) {
    return {
      answers: newAnswers,
      questionIndex: newIndex,
    };
  }

  // All 4 questions answered — tabulate final risk level
  const tag = scoreAnswers(newAnswers);

  return {
    answers: newAnswers,
    questionIndex: newIndex,
    tag,
    crisisDetected: false,
    // conversationPhase is set by the graph routing:
    //   high     → emergencyHandler (sets 'crisis')
    //   moderate → safetyCheckNode (sets 'safetyCheck')
    //   elevated / low → menuPresenter (sets 'menu')
  };
}
