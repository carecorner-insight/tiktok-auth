import { buildGraph } from '@/graph/graph';
import { makeState } from '@/__tests__/mocks';
import type { CareyBotState, MenuOption } from '@/types/state';
import type { MenuMode } from '@/lib/menuMode';
import { EMERGENCY_MESSAGE, INSIGHT_URL, CREST_URL, REFERRAL_AGE_FALLBACK, SCENARIO_MENU_REPEAT_TEXT } from '@/config/questionnaire';

const originalEnv = { ...process.env };
beforeEach(() => {
  process.env.SCENARIO_MENU = 'true';
  process.env.AUTH_ENABLED = 'false';
  process.env.CRISIS_STATIC_FIRST = 'true';
});
afterEach(() => { process.env = { ...originalEnv }; });

function harness(mode: MenuMode = 'intent', label = 'TALK', reply = 'Continue with that choice.') {
  const coach = { chat: jest.fn().mockResolvedValue({ reply, chatId: 'direct:existing' }) };
  const ai = { chat: jest.fn().mockResolvedValue({ reply: 'legacy reply', chatId: 'legacy:1' }) };
  const classifier = { chat: jest.fn().mockResolvedValue({ reply: label, chatId: 'classifier' }) };
  const graph = buildGraph({
    whitelist: { isAuthorized: async () => true },
    session: { save: async () => {}, clear: async () => {} },
    typing: { sendTypingIndicator: async () => {} },
    socialCoach: coach, aiBots: ai, intentLLM: classifier, menuMode: mode,
  });
  const turn = (text: string, overrides: Partial<CareyBotState> = {}) => graph.invoke(makeState({
    age: 20, conversationPhase: 'option', selectedOption: 2, aiBotChatId: 'direct:existing',
    ...overrides,
    messages: [...(overrides.messages ?? [
      { role: 'assistant' as const, content: '1. Draft a reply\n2. Practise\n3. Take a break', timestamp: 1 },
    ]), { role: 'user', content: text, timestamp: 2 }],
  }));
  return { coach, ai, classifier, turn };
}

describe.each<MenuMode>(['intent', 'numbered'])('comment regressions (%s)', mode => {
  it.each<MenuOption>([1, 2, 3, 4, 5, 6])('accepts top-level scenario %s', async option => {
    const h = harness(mode);
    const result = await h.turn(String(option), { conversationPhase: 'menu', selectedOption: null, aiBotChatId: null });
    expect(result.selectedOption).toBe(option);
    expect(h.coach.chat.mock.calls[0][1]).toBe(String(option));
    expect(h.coach.chat.mock.calls[0][2]).toContain('chosen');
    expect(h.classifier.chat).not.toHaveBeenCalled();
  });

  it.each<MenuOption>([1, 2, 3, 4, 5, 6])('keeps local 3 in scenario %s', async option => {
    const h = harness(mode);
    const result = await h.turn('3', { selectedOption: option });
    expect(result.selectedOption).toBe(option);
    expect(h.coach.chat.mock.calls[0].slice(0, 3)).toEqual(['direct:existing', '3', undefined]);
    expect(h.classifier.chat).not.toHaveBeenCalled();
  });

  it('does not turn TALK into the new-start scenario', async () => {
    const h = harness(mode);
    expect((await h.turn('This friendship feels one-sided', { selectedOption: 3 })).selectedOption).toBe(3);
  });

  it('preserves a local answer when the backend ID is missing', async () => {
    const h = harness(mode);
    await h.turn('3', { aiBotChatId: null });
    const [, text, prime, history] = h.coach.chat.mock.calls[0];
    expect(text).toBe('3');
    expect(prime).toMatch(/continu/i);
    expect(prime).not.toMatch(/start of a new|open directly/i);
    expect(history).toEqual([expect.objectContaining({ content: expect.stringContaining('Take a break') })]);
  });

  it('handles explicit menu navigation and resets pending handoff state', async () => {
    const h = harness(mode);
    const result = await h.turn('menu', { pendingHandoff: 'socialCoach', justSwitchedLane: true });
    expect(result.conversationPhase).toBe('menu');
    expect(result.selectedOption).toBeNull();
    expect(result.pendingHandoff).toBeNull();
    expect(h.coach.chat).not.toHaveBeenCalled();
  });

  it('uses the scenario menu for an invalid top-level choice', async () => {
    const h = harness(mode, 'UNCLEAR');
    const result = await h.turn('7', { conversationPhase: 'menu', selectedOption: null });
    expect(result.messages.at(-1)?.content).toBe(SCENARIO_MENU_REPEAT_TEXT);
    expect(h.coach.chat).not.toHaveBeenCalled();
  });

  it('sends the static safety message on a crisis interruption', async () => {
    const h = harness(mode);
    const result = await h.turn('I want to kill myself');
    expect(result.messages.at(-1)?.content).toBe(EMERGENCY_MESSAGE);
    expect(h.ai.chat).not.toHaveBeenCalled();
    expect(h.coach.chat).not.toHaveBeenCalled();
  });
});

it('routes HUMAN directly to referral without changing the scenario', async () => {
  const h = harness('intent', 'HUMAN');
  const result = await h.turn('Can I speak with a counsellor?', { selectedOption: 5 });
  expect(result.selectedOption).toBe(5);
  expect(result.messages.at(-1)?.content).toContain(INSIGHT_URL);
  expect(h.coach.chat).not.toHaveBeenCalled();
});

it('can request HUMAN from the initial menu without choosing scenario 3', async () => {
  const h = harness('intent', 'HUMAN');
  const result = await h.turn('I want to speak with a real person', { conversationPhase: 'menu', selectedOption: null });
  expect(result.selectedOption).toBeNull();
  expect(result.messages.at(-1)?.content).toContain(INSIGHT_URL);
});

it('does not bypass static-first safety after a classifier CRISIS label', async () => {
  const h = harness('intent', 'CRISIS');
  const result = await h.turn('A synthetic classifier-triggering statement');
  expect(result.messages.at(-1)?.content).toBe(EMERGENCY_MESSAGE);
  expect(h.ai.chat).not.toHaveBeenCalled();
});

it.each(['intent', 'numbered'] as const)('consumes a referral age answer without changing scenario (%s)', async mode => {
  const h = harness(mode, 'HUMAN');
  const first = await h.turn('I need a real person', { age: null, awaitingReferralAge: true });
  expect(first.messages.at(-1)?.content).toBe(REFERRAL_AGE_FALLBACK);
  const answered = await h.turn('2', { ...first, age: null });
  expect(answered.messages.at(-1)?.content).toContain(CREST_URL);
  expect(answered.age).toBeNull(); // an age band is not an exact age
  expect(answered.selectedOption).toBe(2);
  expect(answered.awaitingReferralAge).toBe(false);
  expect(h.coach.chat).not.toHaveBeenCalled();
});

it.each(['1', 'yes', 'y'])('accepts the younger referral age band: %s', async text => {
  const h = harness();
  const result = await h.turn(text, { age: null, awaitingReferralAge: true, selectedOption: 5 });
  expect(result.messages.at(-1)?.content).toContain(INSIGHT_URL);
  expect(result.selectedOption).toBe(5);
});

it('a coach CRISIS tag overrides REFERRAL and sends static safety copy', async () => {
  const h = harness('numbered', 'TALK', '[CRISIS][REFERRAL] Synthetic warning');
  const result = await h.turn('A synthetic distress response');
  expect(result.messages.at(-1)?.content).toBe(EMERGENCY_MESSAGE);
  expect(result.conversationPhase).toBe('crisis');
  expect(h.ai.chat).not.toHaveBeenCalled();
});

it.each(['1/2', '-1', '1 and 2'])('does not normalise malformed text into a top-level scenario: %s', async text => {
  const h = harness('numbered');
  const result = await h.turn(text, { conversationPhase: 'menu', selectedOption: null });
  expect(result.selectedOption).toBeNull();
  expect(result.messages.at(-1)?.content).toBe(SCENARIO_MENU_REPEAT_TEXT);
});

it('still escalates from the study safety question using static copy', async () => {
  process.env.SCENARIO_MENU = 'false';
  const h = harness('numbered');
  const result = await h.turn('no', { conversationPhase: 'safetyCheck', selectedOption: null,
    messages: [{ role: 'assistant', content: 'Do you feel safe? Yes / No', timestamp: 1 }] });
  expect(result.messages.at(-1)?.content).toBe(EMERGENCY_MESSAGE);
  expect(h.ai.chat).not.toHaveBeenCalled();
});

it('deliberately returning to the menu permits a new scenario selection', async () => {
  const h = harness();
  const menu = await h.turn('menu', { selectedOption: 5 });
  const next = await h.turn('3', { ...menu });
  expect(next.selectedOption).toBe(3);
  expect(h.coach.chat.mock.calls[0][2]).toContain('Making or keeping friends');
  expect(h.coach.chat.mock.calls[0][3].length).toBeGreaterThan(1);
});

it.each([1, 3] as const)('does not persist an unhandled CRISIS tag in legacy lane %s', async option => {
  process.env.SCENARIO_MENU = 'false';
  const h = harness('numbered');
  h.ai.chat.mockResolvedValue({ reply: '[CRISIS] Synthetic signal', chatId: 'legacy:1' });
  const result = await h.turn('Synthetic response without phrase match', { selectedOption: option });
  expect(result.messages.at(-1)?.content).toBe(EMERGENCY_MESSAGE);
  expect(result.conversationPhase).toBe('crisis');
  expect(h.ai.chat).toHaveBeenCalledTimes(1);
});

it('keeps the latest answer when a crisis follow-up needs a new provider session', async () => {
  const h = harness('numbered');
  const first = await h.turn('I want to kill myself');
  expect(first.aiBotChatId).toBeNull();
  await h.turn('I can call my sister', { ...first });
  expect(h.ai.chat.mock.calls[0][1]).toBe('I can call my sister');
  expect(h.ai.chat.mock.calls[0][3].at(-1).content).toBe(EMERGENCY_MESSAGE);
});
