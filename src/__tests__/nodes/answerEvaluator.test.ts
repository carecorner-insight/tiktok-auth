import { answerEvaluator } from '@/nodes/answerEvaluator';
import { makeState } from '@/__tests__/mocks';
import { TOTAL_QUESTIONS, RISK_THRESHOLDS, PHQ9_QUESTIONS } from '@/config/questionnaire';

// TOTAL_QUESTIONS = 4: Q1 (suicidal, index 0) + Q2–Q4 (tabulated, indices 1–3)
// RISK_THRESHOLDS: high ≥ 2, medium ≥ 1, else low (based on Q2–Q4 yes count)

const stateWithInput = (input: string, questionIndex: number, answers: string[] = []) =>
  makeState({
    questionIndex,
    answers,
    conversationPhase: 'questionnaire',
    messages: [{ role: 'user', content: input, timestamp: Date.now() }],
  });

// ── Q1 — suicidal ideation (index 0) ─────────────────────────────────────────

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

  it('terminates questionnaire immediately — conversationPhase becomes ended', () => {
    const result = answerEvaluator(stateWithInput('yes', 0));
    expect(result.conversationPhase).toBe('ended');
  });

  it('is case-insensitive for "Yes"', () => {
    expect(answerEvaluator(stateWithInput('Yes', 0)).tag).toBe('high');
  });

  it('is case-insensitive for "YES"', () => {
    expect(answerEvaluator(stateWithInput('YES', 0)).tag).toBe('high');
  });

  it('is case-insensitive for "NO" — not high risk', () => {
    expect(answerEvaluator(stateWithInput('NO', 0)).tag).toBeUndefined();
  });
});

// ── Mid-questionnaire (Q2, index 1) ──────────────────────────────────────────

describe('answerEvaluator — mid-questionnaire (Q2, index 1)', () => {
  it('increments questionIndex and appends answer without setting tag', () => {
    const result = answerEvaluator(stateWithInput('yes', 1, ['no']));
    expect(result.questionIndex).toBe(2);
    expect(result.answers).toEqual(['no', 'yes']);
    expect(result.tag).toBeUndefined();
    expect(result.conversationPhase).toBeUndefined();
  });

  it('works for a "no" mid-questionnaire answer too', () => {
    const result = answerEvaluator(stateWithInput('no', 1, ['no']));
    expect(result.questionIndex).toBe(2);
    expect(result.answers).toEqual(['no', 'no']);
    expect(result.tag).toBeUndefined();
  });
});

// ── Mid-questionnaire (Q3, index 2) ──────────────────────────────────────────

describe('answerEvaluator — mid-questionnaire (Q3, index 2)', () => {
  it('does not evaluate tabulation until all questions are answered', () => {
    const result = answerEvaluator(stateWithInput('yes', 2, ['no', 'yes']));
    expect(result.tag).toBeUndefined();
    expect(result.questionIndex).toBe(3);
  });
});

// ── Final question (Q4, index 3) — tabulation ────────────────────────────────

describe('answerEvaluator — final tabulation (Q4, index 3)', () => {
  it(`sets tag=high when tabulation score ≥ ${RISK_THRESHOLDS.high} (2 yes in Q2–Q4)`, () => {
    // Q1=no, Q2=yes, Q3=yes → score=2 after adding 'no' for Q4: still ≥ 2
    const result = answerEvaluator(stateWithInput('no', 3, ['no', 'yes', 'yes']));
    expect(result.tag).toBe('high');
    expect(result.crisisDetected).toBe(true);
    expect(result.conversationPhase).toBe('ended');
    expect(result.answers).toEqual(['no', 'yes', 'yes', 'no']);
  });

  it('sets tag=high when all 3 of Q2–Q4 are yes (score=3)', () => {
    const result = answerEvaluator(stateWithInput('yes', 3, ['no', 'yes', 'yes']));
    expect(result.tag).toBe('high');
    expect(result.crisisDetected).toBe(true);
    expect(result.conversationPhase).toBe('ended');
  });

  it(`sets tag=medium when tabulation score = ${RISK_THRESHOLDS.medium} (1 yes in Q2–Q4)`, () => {
    const result = answerEvaluator(stateWithInput('no', 3, ['no', 'yes', 'no']));
    expect(result.tag).toBe('medium');
    expect(result.crisisDetected).toBe(false); // explicitly set to false for non-high
    expect(result.conversationPhase).toBe('menu');
  });

  it('sets tag=low when tabulation score = 0 (all no in Q2–Q4)', () => {
    const result = answerEvaluator(stateWithInput('no', 3, ['no', 'no', 'no']));
    expect(result.tag).toBe('low');
    expect(result.conversationPhase).toBe('menu');
  });

  it('advances questionIndex to TOTAL_QUESTIONS after final answer', () => {
    const result = answerEvaluator(stateWithInput('no', 3, ['no', 'no', 'no']));
    expect(result.questionIndex).toBe(TOTAL_QUESTIONS);
  });
});

// ── Invalid input ─────────────────────────────────────────────────────────────

describe('answerEvaluator — invalid input', () => {
  it('re-prompts when answer is not "yes" or "no"', () => {
    const result = answerEvaluator(stateWithInput('maybe', 1, ['no']));
    expect(result.pendingResponse).toContain('Please reply with Yes or No');
    expect(result.pendingResponse).toContain(PHQ9_QUESTIONS[1].text);
    expect(result.pendingResponse).toContain('Yes / No');
  });

  it('does not advance questionIndex on invalid input', () => {
    const result = answerEvaluator(stateWithInput('banana', 2, ['no', 'no']));
    expect(result.questionIndex).toBeUndefined();
  });

  it('does not set tag on invalid input', () => {
    const result = answerEvaluator(stateWithInput('idk', 0));
    expect(result.tag).toBeUndefined();
  });
});
