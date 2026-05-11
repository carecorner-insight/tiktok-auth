import { emergencyHandler } from '@/nodes/emergencyHandler';
import { menuPresenter } from '@/nodes/menuPresenter';
import { optionRouter } from '@/nodes/optionRouter';
import { makeState } from '@/__tests__/mocks';
import { EMERGENCY_MESSAGE, MENU_TEXT } from '@/config/questionnaire';

// ── emergencyHandler ─────────────────────────────────────────────────────────

describe('emergencyHandler', () => {
  it('sets pendingResponse to the emergency message', () => {
    const result = emergencyHandler(makeState({ tag: 'high', crisisDetected: true }));
    expect(result.pendingResponse).toBe(EMERGENCY_MESSAGE);
  });

  it('sets conversationPhase to ended', () => {
    const result = emergencyHandler(makeState());
    expect(result.conversationPhase).toBe('ended');
  });
});

// ── menuPresenter ─────────────────────────────────────────────────────────────

describe('menuPresenter', () => {
  it('sets pendingResponse to the 4-item menu text', () => {
    const result = menuPresenter(makeState({ conversationPhase: 'menu' }));
    expect(result.pendingResponse).toBe(MENU_TEXT);
  });

  it('keeps conversationPhase as menu (awaiting user selection)', () => {
    const result = menuPresenter(makeState());
    expect(result.conversationPhase).toBe('menu');
  });
});

// ── optionRouter ──────────────────────────────────────────────────────────────

describe('optionRouter', () => {
  it.each([
    ['1', 1],
    ['2', 2],
    ['3', 3],
    ['4', 4],
  ])('parses "%s" as option %i', (input, expected) => {
    const state = makeState({
      conversationPhase: 'menu',
      messages: [{ role: 'user', content: input, timestamp: Date.now() }],
    });
    const result = optionRouter(state);
    expect(result.selectedOption).toBe(expected);
    expect(result.conversationPhase).toBe('option');
  });

  it('re-presents the menu on an invalid selection', () => {
    const state = makeState({
      conversationPhase: 'menu',
      messages: [{ role: 'user', content: 'banana', timestamp: Date.now() }],
    });
    const result = optionRouter(state);
    expect(result.selectedOption).toBeNull();
    expect(result.pendingResponse).toBe(MENU_TEXT);
    expect(result.conversationPhase).toBe('menu');
  });

  it('accepts "1." and "  1  " as valid input (trims and strips punctuation)', () => {
    const state = makeState({
      conversationPhase: 'menu',
      messages: [{ role: 'user', content: '  1.  ', timestamp: Date.now() }],
    });
    const result = optionRouter(state);
    expect(result.selectedOption).toBe(1);
  });
});
