import { router, makeRouter } from '@/nodes/router';
import { makeState } from '@/__tests__/mocks';
import { TOTAL_QUESTIONS } from '@/config/questionnaire';

const numberedRouter = makeRouter('numbered');
const intentRouter = makeRouter('intent');

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

// ── universal crisis backstop (checked before phase routing) ──────────────────

describe('router — universal crisis backstop', () => {
  it('routes to emergencyHandler on a crisis phrase from the menu phase', () => {
    const state = withUserMsg('honestly I just want to die', { conversationPhase: 'menu' });
    expect(router(state)).toBe('emergencyHandler');
  });

  it('routes to emergencyHandler on a crisis phrase mid-questionnaire', () => {
    const state = withUserMsg('I keep thinking about ending my life', {
      conversationPhase: 'questionnaire',
    });
    expect(router(state)).toBe('emergencyHandler');
  });

  it('routes to emergencyHandler on a crisis phrase from an active option', () => {
    const state = withUserMsg('I want to kill myself', {
      conversationPhase: 'option',
      selectedOption: 1,
    });
    expect(router(state)).toBe('emergencyHandler');
  });

  it('does not trigger on screener Yes/No answers or menu digits', () => {
    expect(router(withUserMsg('no', { conversationPhase: 'menu' }))).not.toBe('emergencyHandler');
    expect(router(withUserMsg('1', { conversationPhase: 'menu' }))).not.toBe('emergencyHandler');
  });
});

// ── ageCheck phase ────────────────────────────────────────────────────────────

describe('router — ageCheck phase', () => {
  it('routes to ageCheckNode when no assistant message exists yet', () => {
    const state = makeState({ conversationPhase: 'ageCheck', messages: [] });
    expect(router(state)).toBe('ageCheckNode');
  });

  it('routes to ageGateNode when last assistant message asked "how old are you"', () => {
    const state = makeState({
      conversationPhase: 'ageCheck',
      messages: [
        { role: 'assistant', content: 'Before we start — how old are you?', timestamp: 0 },
        { role: 'user', content: '15', timestamp: 1 },
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
  it('routes to intentClassifierNode', () => {
    expect(router(makeState({ conversationPhase: 'menu' }))).toBe('intentClassifierNode');
  });
});

// ── option phase ──────────────────────────────────────────────────────────────

describe('router — option phase', () => {
  // NUMBERED mode: option phase goes straight to the selected lane (no re-classify).
  it('routes to freeTextNode for option 1 (numbered mode)', () => {
    expect(numberedRouter(makeState({ conversationPhase: 'option', selectedOption: 1 }))).toBe('freeTextNode');
  });

  it('routes to socialCoachNode for option 2 (numbered mode)', () => {
    expect(numberedRouter(makeState({ conversationPhase: 'option', selectedOption: 2 }))).toBe('socialCoachNode');
  });

  it('routes to resourceRedirectNode for option 3 (numbered mode)', () => {
    expect(numberedRouter(makeState({ conversationPhase: 'option', selectedOption: 3 }))).toBe('resourceRedirectNode');
  });

  // INTENT mode: every in-lane turn is re-classified so the bot can switch lanes.
  it('re-routes in-lane turns to intentClassifierNode (intent mode)', () => {
    expect(intentRouter(makeState({ conversationPhase: 'option', selectedOption: 1 }))).toBe('intentClassifierNode');
    expect(intentRouter(makeState({ conversationPhase: 'option', selectedOption: 2 }))).toBe('intentClassifierNode');
  });

  it('still honours "menu"/"back" before re-classifying (intent mode)', () => {
    const state = withUserMsg('menu', { conversationPhase: 'option', selectedOption: 1 });
    expect(intentRouter(state)).toBe('menuPresenter');
  });

  it('still fires the crisis backstop before re-classifying (intent mode)', () => {
    const state = withUserMsg('i want to kill myself', { conversationPhase: 'option', selectedOption: 1 });
    expect(intentRouter(state)).toBe('emergencyHandler');
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
    // numbered mode stays in the lane; intent mode re-classifies — neither dumps to menu.
    expect(numberedRouter(state)).toBe('freeTextNode');
    expect(intentRouter(state)).toBe('intentClassifierNode');
  });
});

// ── ended / fallback ──────────────────────────────────────────────────────────

describe('router — ended / fallback', () => {
  it('routes to sessionPersister when phase is ended', () => {
    expect(router(makeState({ conversationPhase: 'ended' }))).toBe('sessionPersister');
  });
});
