import { router } from '@/nodes/router';
import { makeState } from '@/__tests__/mocks';

const withLastAssistantMsg = (content: string) =>
  makeState({
    conversationPhase: 'questionnaire',
    messages: [{ role: 'assistant', content, timestamp: Date.now() }],
  });

describe('router — questionnaire phase', () => {
  it('routes to questionnaireNode when no question has been presented yet', () => {
    expect(router(makeState({ conversationPhase: 'questionnaire', messages: [] }))).toBe('questionnaireNode');
  });

  it('routes to answerEvaluator when last assistant message was a Yes/No question', () => {
    expect(router(withLastAssistantMsg('Have you felt sad?\n\nYes / No'))).toBe('answerEvaluator');
  });

  it('routes to questionnaireNode when last assistant message was not a question', () => {
    expect(router(withLastAssistantMsg('Thanks for sharing that.'))).toBe('questionnaireNode');
  });
});

describe('router — menu phase', () => {
  it('routes to optionRouter', () => {
    expect(router(makeState({ conversationPhase: 'menu' }))).toBe('optionRouter');
  });
});

describe('router — option phase', () => {
  it('routes to freeTextNode for option 1', () => {
    expect(router(makeState({ conversationPhase: 'option', selectedOption: 1 }))).toBe('freeTextNode');
  });

  it('routes to wellbeingCheckNode for option 2', () => {
    expect(router(makeState({ conversationPhase: 'option', selectedOption: 2 }))).toBe('wellbeingCheckNode');
  });

  it('routes to stressManagementNode for option 3', () => {
    expect(router(makeState({ conversationPhase: 'option', selectedOption: 3 }))).toBe('stressManagementNode');
  });

  it('routes to resourceRedirectNode for option 4', () => {
    expect(router(makeState({ conversationPhase: 'option', selectedOption: 4 }))).toBe('resourceRedirectNode');
  });
});

describe('router — ended / fallback', () => {
  it('routes to sessionPersister when phase is ended', () => {
    expect(router(makeState({ conversationPhase: 'ended' }))).toBe('sessionPersister');
  });
});
