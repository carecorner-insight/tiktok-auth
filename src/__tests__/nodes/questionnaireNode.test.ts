import { questionnaireNode } from '@/nodes/questionnaireNode';
import { makeState } from '@/__tests__/mocks';
import { PHQ9_QUESTIONS, TOTAL_QUESTIONS } from '@/config/questionnaire';

describe('questionnaireNode', () => {
  it('presents the question at questionIndex 0 (Q1 — suicidal ideation)', () => {
    const state = makeState({ questionIndex: 0, conversationPhase: 'questionnaire' });
    const result = questionnaireNode(state);
    expect(result.pendingResponse).toContain(PHQ9_QUESTIONS[0].text);
  });

  it('presents suicidal ideation (Q1) as the very first question', () => {
    const state = makeState({ questionIndex: 0 });
    expect(PHQ9_QUESTIONS[0].isHighRiskTrigger).toBe(true);
    const result = questionnaireNode(state);
    expect(result.pendingResponse).toContain(PHQ9_QUESTIONS[0].text);
  });

  it('presents the last question (Q4) at the correct index', () => {
    const lastIndex = TOTAL_QUESTIONS - 1;
    const state = makeState({ questionIndex: lastIndex, conversationPhase: 'questionnaire' });
    const result = questionnaireNode(state);
    expect(result.pendingResponse).toContain(PHQ9_QUESTIONS[lastIndex].text);
  });

  it('appends Yes/No prompt to every question', () => {
    const state = makeState({ questionIndex: 2 });
    const result = questionnaireNode(state);
    expect(result.pendingResponse).toMatch(/yes.*no|no.*yes/i);
  });

  it('throws when questionIndex equals TOTAL_QUESTIONS (out of bounds)', () => {
    const state = makeState({ questionIndex: TOTAL_QUESTIONS });
    expect(() => questionnaireNode(state)).toThrow();
  });

  it('throws when questionIndex exceeds TOTAL_QUESTIONS', () => {
    const state = makeState({ questionIndex: TOTAL_QUESTIONS + 5 });
    expect(() => questionnaireNode(state)).toThrow();
  });
});
