import { router } from '@/nodes/router';
import { makeState } from '@/__tests__/mocks';
import { TOTAL_QUESTIONS } from '@/config/questionnaire';

// ── Helper factories ──────────────────────────────────────────────────────────

const withLastAssistantMsg = (content: string) =>
  makeState({
    conversationPhase: 'questionnaire',
    messages: [{ role: 'assistant', content, timestamp: Date.now() }],
  });

const withUserMsg = (text: string, overrides = {}) =>
  makeState({
    messages: [{ role: 'user', content: text, timestamp: Date.now() }],
    ...overrides,
  });

// ── /restart detection (checked before all other routing) ─────────────────────

describe('router — /restart command', () => {
  it('routes to restartNode from questionnaire phase', () => {
    const state = withUserMsg('/restart', { conversationPhase: 'questionnaire' });
    expect(router(state)).toBe('restartNode');
  });

  it('routes to restartNode from menu phase', () => {
    const state = withUserMsg('/restart', { conversationPhase: 'menu' });
    expect(router(state)).toBe('restartNode');
  });

  it('routes to restartNode from option phase', () => {
    const state = withUserMsg('/restart', { conversationPhase: 'option', selectedOption: 1 });
    expect(router(state)).toBe('restartNode');
  });

  it('routes to restartNode from ageCheck phase', () => {
    const state = withUserMsg('/restart', { conversationPhase: 'ageCheck' });
    expect(router(state)).toBe('restartNode');
  });
});

// ── ageCheck phase ────────────────────────────────────────────────────────────

describe('router — ageCheck phase', () => {
  it('routes to ageCheckNode when no assistant message exists yet', () => {
    const state = makeState({ conversationPhase: 'ageCheck', messages: [] });
    expect(router(state)).toBe('ageCheckNode');
  });

  it('routes to ageGateNode when last assistant message contains "Yes / No"', () => {
    const state = makeState({
      conversationPhase: 'ageCheck',
      messages: [
        { role: 'assistant', content: 'Are you between 13 and 25 years old?\n\nYes / No', timestamp: 0 },
        { role: 'user', content: 'yes', timestamp: 1 },
      ],
    });
    expect(router(state)).toBe('ageGateNode');
  });

  it('routes to ageCheckNode when last assistant message does not have "Yes / No"', () => {
    const state = makeState({
      conversationPhase: 'ageCheck',
      messages: [{ role: 'assistant', content: 'Something else', timestamp: 0 }],
    });
    expect(router(state)).toBe('ageCheckNode');
  });
});

// ── questionnaire phase ───────────────────────────────────────────────────────

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

  it('routes to menuPresenter when questionIndex >= TOTAL_QUESTIONS (stale session guard)', () => {
    const state = makeState({
      conversationPhase: 'questionnaire',
      questionIndex: TOTAL_QUESTIONS,
    });
    expect(router(state)).toBe('menuPresenter');
  });

  it('stale guard also fires for questionIndex > TOTAL_QUESTIONS', () => {
    const state = makeState({
      conversationPhase: 'questionnaire',
      questionIndex: TOTAL_QUESTIONS + 2,
    });
    expect(router(state)).toBe('menuPresenter');
  });
});

// ── menu phase ────────────────────────────────────────────────────────────────

describe('router — menu phase', () => {
  it('routes to optionRouter', () => {
    expect(router(makeState({ conversationPhase: 'menu' }))).toBe('optionRouter');
  });
});

// ── option phase ──────────────────────────────────────────────────────────────

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

  it('routes to menuPresenter when user types "menu"', () => {
    const state = withUserMsg('menu', { conversationPhase: 'option', selectedOption: 1 });
    expect(router(state)).toBe('menuPresenter');
  });

  it('routes to menuPresenter when user types "back"', () => {
    const state = withUserMsg('back', { conversationPhase: 'option', selectedOption: 2 });
    expect(router(state)).toBe('menuPresenter');
  });

  it('routes to menuPresenter when user types "back to menu"', () => {
    const state = withUserMsg('back to menu', { conversationPhase: 'option', selectedOption: 3 });
    expect(router(state)).toBe('menuPresenter');
  });

  it('routes to menuPresenter when user types "options"', () => {
    const state = withUserMsg('options', { conversationPhase: 'option', selectedOption: 1 });
    expect(router(state)).toBe('menuPresenter');
  });

  it('routes to menuPresenter when user types "change"', () => {
    const state = withUserMsg('change', { conversationPhase: 'option', selectedOption: 4 });
    expect(router(state)).toBe('menuPresenter');
  });

  it('does NOT route to menuPresenter for regular conversation in option phase', () => {
    const state = withUserMsg('I feel anxious', { conversationPhase: 'option', selectedOption: 1 });
    expect(router(state)).toBe('freeTextNode');
  });
});

// ── ended / fallback ──────────────────────────────────────────────────────────

describe('router — ended / fallback', () => {
  it('routes to sessionPersister when phase is ended', () => {
    expect(router(makeState({ conversationPhase: 'ended' }))).toBe('sessionPersister');
  });
});
