import { questionnaireNode } from '@/nodes/questionnaireNode';
import { makeState } from '@/__tests__/mocks';
import { PHQ9_QUESTIONS } from '@/config/questionnaire';

describe('questionnaireNode', () => {
  it('presents the question at the current questionIndex', () => {
    const state = makeState({ questionIndex: 0, conversationPhase: 'questionnaire' });
    const result = questionnaireNode(state);
    expect(result.pendingResponse).toContain(PHQ9_QUESTIONS[0].text);
  });

  it('presents suicidal ideation (Q1) as the very first question', () => {
    const state = makeState({ questionIndex: 0 });
    const result = questionnaireNode(state);
    expect(PHQ9_QUESTIONS[0].isHighRiskTrigger).toBe(true);
    expect(result.pendingResponse).toContain(PHQ9_QUESTIONS[0].text);
  });

  it('presents Q5 when questionIndex is 4', () => {
    const state = makeState({ questionIndex: 4 });
    const result = questionnaireNode(state);
    expect(result.pendingResponse).toContain(PHQ9_QUESTIONS[4].text);
  });

  it('appends Yes/No prompt to every question', () => {
    const state = makeState({ questionIndex: 2 });
    const result = questionnaireNode(state);
    expect(result.pendingResponse).toMatch(/yes.*no|no.*yes/i);
  });

  it('throws when questionIndex is out of bounds', () => {
    const state = makeState({ questionIndex: 9 });
    expect(() => questionnaireNode(state)).toThrow();
  });
});
