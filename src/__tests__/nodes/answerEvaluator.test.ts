import { answerEvaluator } from '@/nodes/answerEvaluator';
import { makeState } from '@/__tests__/mocks';
import {
  SUICIDAL_YES_ANSWERS,
  HIGH_TAB_ANSWERS,
  MEDIUM_TAB_ANSWERS,
  LOW_TAB_ANSWERS,
  ALL_NO_ANSWERS,
} from '@/__tests__/mocks';

const stateWithInput = (input: string, questionIndex: number, answers: string[] = []) =>
  makeState({
    questionIndex,
    answers,
    conversationPhase: 'questionnaire',
    messages: [{ role: 'user', content: input, timestamp: Date.now() }],
  });

describe('answerEvaluator — Q1 (suicidal ideation)', () => {
  it('triggers high risk immediately when Q1 answer is "yes"', () => {
    const result = answerEvaluator(stateWithInput('yes', 0));
    expect(result.tag).toBe('high');
    expect(result.crisisDetected).toBe(true);
    expect(result.conversationPhase).toBe('ended');
    expect(result.answers).toEqual(['yes']);
  });

  it('does NOT trigger high risk when Q1 answer is "no"', () => {
    const result = answerEvaluator(stateWithInput('no', 0));
    expect(result.tag).toBeUndefined();
    expect(result.crisisDetected).toBeUndefined();
    expect(result.questionIndex).toBe(1);
    expect(result.answers).toEqual(['no']);
  });

  it('is case-insensitive for "Yes", "YES", "No", "NO"', () => {
    expect(answerEvaluator(stateWithInput('YES', 0)).tag).toBe('high');
    expect(answerEvaluator(stateWithInput('Yes', 0)).tag).toBe('high');
    expect(answerEvaluator(stateWithInput('NO', 0)).tag).toBeUndefined();
  });

  it('terminates questionnaire immediately — does not advance to Q2', () => {
    const result = answerEvaluator(stateWithInput('yes', 0));
    expect(result.questionIndex).toBe(1);
    expect(result.conversationPhase).toBe('ended');
  });
});

describe('answerEvaluator — mid-questionnaire (Q2–Q8)', () => {
  it('increments questionIndex and appends answer without setting tag', () => {
    const result = answerEvaluator(stateWithInput('yes', 2, ['no', 'no']));
    expect(result.questionIndex).toBe(3);
    expect(result.answers).toEqual(['no', 'no', 'yes']);
    expect(result.tag).toBeUndefined();
    expect(result.conversationPhase).toBeUndefined();
  });
});

describe('answerEvaluator — final tabulation (after Q9)', () => {
  it('sets tag=high when tabulation score >= 6', () => {
    // Q1=no, then 6 yes in Q2-Q9
    const answers = HIGH_TAB_ANSWERS.slice(0, 8); // first 8 already answered
    const result = answerEvaluator(stateWithInput('yes', 8, answers));
    expect(result.tag).toBe('high');
    expect(result.crisisDetected).toBe(true);
    expect(result.conversationPhase).toBe('ended');
  });

  it('sets tag=medium when tabulation score is 3–5', () => {
    const answers = MEDIUM_TAB_ANSWERS.slice(0, 8);
    const result = answerEvaluator(stateWithInput('no', 8, answers));
    expect(result.tag).toBe('medium');
    expect(result.conversationPhase).toBe('menu');
  });

  it('sets tag=low when tabulation score is 0–2', () => {
    const answers = LOW_TAB_ANSWERS.slice(0, 8);
    const result = answerEvaluator(stateWithInput('no', 8, answers));
    expect(result.tag).toBe('low');
    expect(result.conversationPhase).toBe('menu');
  });

  it('sets tag=low when all answers are no', () => {
    const answers = ALL_NO_ANSWERS.slice(0, 8);
    const result = answerEvaluator(stateWithInput('no', 8, answers));
    expect(result.tag).toBe('low');
    expect(result.conversationPhase).toBe('menu');
  });

  it('does not evaluate tabulation until all 9 questions are answered', () => {
    const result = answerEvaluator(stateWithInput('yes', 5, Array(5).fill('yes')));
    expect(result.tag).toBeUndefined();
    expect(result.questionIndex).toBe(6);
  });
});
