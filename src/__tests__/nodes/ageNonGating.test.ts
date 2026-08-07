import { ageCheckNode } from '@/nodes/ageCheckNode';
import { ageGateNode } from '@/nodes/ageGateNode';
import { makeState } from '@/__tests__/mocks';
import { WELCOME_TEXT, AGE_REPROMPT_TEXT, SCENARIO_MENU_TEXT } from '@/config/questionnaire';

// F1/F2 — on the Growing We build the age question is a QUESTION, never a GATE.
// No answer excludes anyone, and the screener is gone entirely.

const withUserMsg = (text: string, overrides = {}) =>
  makeState({
    conversationPhase: 'ageCheck',
    messages: [{ role: 'user', content: text, timestamp: Date.now() }],
    ...overrides,
  });

beforeEach(() => { process.env.SCREENER_ENABLED = 'false'; });
afterEach(() => {
  delete process.env.SCREENER_ENABLED;
  delete process.env.SCENARIO_MENU;
});

describe('ageCheckNode — welcome', () => {
  it('sends the pivot welcome with disclosures and the age question', () => {
    expect(ageCheckNode(makeState({}))).toEqual({ pendingResponse: WELCOME_TEXT });
  });

  it('greets a returning known-age user without re-asking or re-disclosing', () => {
    const res = ageCheckNode(makeState({ age: 19 }));
    expect(res.pendingResponse).not.toMatch(/how old are you/i);
    expect(res.conversationPhase).toBe('menu');
  });

  it('keeps the original triage welcome when the screener is on', () => {
    process.env.SCREENER_ENABLED = 'true';
    const res = ageCheckNode(makeState({}));
    expect(res.pendingResponse).toMatch(/13–25/);
  });
});

describe('ageGateNode — every outcome reaches the menu', () => {
  it('stores a plausible age and shows the scenario menu', () => {
    const res = ageGateNode(withUserMsg('19'));
    expect(res.age).toBe(19);
    expect(res.conversationPhase).toBe('menu');
    expect(res.pendingResponse).toBe(SCENARIO_MENU_TEXT);
  });

  it('does NOT exclude an out-of-scope age — no gate', () => {
    for (const age of [11, 30, 67]) {
      const res = ageGateNode(withUserMsg(String(age)));
      expect(res.age).toBe(age);
      expect(res.conversationPhase).toBe('menu');
      expect(res.pendingResponse).not.toMatch(/mainly designed for young people/i);
    }
  });

  it('re-prompts once on a non-answer', () => {
    const res = ageGateNode(withUserMsg('abc'));
    expect(res.pendingResponse).toBe(AGE_REPROMPT_TEXT);
    expect(res.conversationPhase).toBeUndefined(); // stays in ageCheck
    expect(res.ageAsked).toBe(true);
  });

  it('proceeds to the menu with age unknown after a SECOND non-answer', () => {
    const res = ageGateNode(withUserMsg('still not telling', { ageAsked: true }));
    expect(res.age).toBeNull();
    expect(res.conversationPhase).toBe('menu');
    expect(res.pendingResponse).toBe(SCENARIO_MENU_TEXT);
  });

  it('never routes to the screener when it is disabled', () => {
    for (const input of ['19', '11', 'abc']) {
      expect(ageGateNode(withUserMsg(input)).conversationPhase).not.toBe('questionnaire');
    }
  });

  it('still runs the screener path when the screener is enabled', () => {
    process.env.SCREENER_ENABLED = 'true';
    const res = ageGateNode(withUserMsg('19'));
    expect(res.conversationPhase).toBe('questionnaire');
  });

  it('still routes out-of-scope users to support in the triage build', () => {
    process.env.SCREENER_ENABLED = 'true';
    const res = ageGateNode(withUserMsg('30'));
    expect(res.conversationPhase).toBe('option');
  });
});
