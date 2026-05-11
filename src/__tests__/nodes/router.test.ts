import { router } from '@/nodes/router';
import { makeState } from '@/__tests__/mocks';

describe('router', () => {
  it('returns "questionnaire" when phase is questionnaire', () => {
    expect(router(makeState({ conversationPhase: 'questionnaire' }))).toBe('questionnaire');
  });

  it('returns "menu" when phase is menu', () => {
    expect(router(makeState({ conversationPhase: 'menu' }))).toBe('menu');
  });

  it('returns "freeText" when option 1 selected', () => {
    expect(router(makeState({ conversationPhase: 'option', selectedOption: 1 }))).toBe('freeText');
  });

  it('returns "wellbeingCheck" when option 2 selected', () => {
    expect(router(makeState({ conversationPhase: 'option', selectedOption: 2 }))).toBe('wellbeingCheck');
  });

  it('returns "stressManagement" when option 3 selected', () => {
    expect(router(makeState({ conversationPhase: 'option', selectedOption: 3 }))).toBe('stressManagement');
  });

  it('returns "resourceRedirect" when option 4 selected', () => {
    expect(router(makeState({ conversationPhase: 'option', selectedOption: 4 }))).toBe('resourceRedirect');
  });

  it('returns "ended" when phase is ended', () => {
    expect(router(makeState({ conversationPhase: 'ended' }))).toBe('ended');
  });
});
