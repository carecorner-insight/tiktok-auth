import { makeRouter } from '@/nodes/router';
import { makeMenuPresenter } from '@/nodes/menuPresenter';
import { makeSocialCoachNode } from '@/nodes/socialCoachNode';
import { makeResourceRedirectNode } from '@/nodes/resourceRedirectNode';
import { makeState } from '@/__tests__/mocks';
import {
  SCENARIO_MENU_TEXT,
  SCENARIO_MENU_REPEAT_TEXT,
  REFERRAL_AGE_FALLBACK,
  INSIGHT_URL,
  CREST_URL,
  SCENARIOS,
} from '@/config/questionnaire';

const typing = { sendTypingIndicator: jest.fn().mockResolvedValue(undefined) };

// The Growing We build: SCREENER_ENABLED=false implies the scenario menu.
beforeEach(() => {
  jest.clearAllMocks();
  process.env.SCREENER_ENABLED = 'false';
});
afterEach(() => {
  delete process.env.SCREENER_ENABLED;
  delete process.env.SCENARIO_MENU;
});

const withUserMsg = (text: string, overrides = {}) =>
  makeState({ messages: [{ role: 'user', content: text, timestamp: Date.now() }], ...overrides });

describe('F6 — every scenario option feeds the social coach', () => {
  it('routes all six options to socialCoachNode', () => {
    const router = makeRouter('numbered');
    for (const opt of [1, 2, 3, 4, 5, 6] as const) {
      expect(router(makeState({ conversationPhase: 'option', selectedOption: opt })))
        .toBe('socialCoachNode');
    }
  });

  it('keeps the triage lanes when the scenario menu is off', () => {
    process.env.SCREENER_ENABLED = 'true';
    const router = makeRouter('numbered');
    expect(router(makeState({ conversationPhase: 'option', selectedOption: 1 }))).toBe('freeTextNode');
    expect(router(makeState({ conversationPhase: 'option', selectedOption: 3 }))).toBe('resourceRedirectNode');
  });

  it('still honours the crisis backstop and the menu keyword first', () => {
    const router = makeRouter('numbered');
    expect(router(withUserMsg('i want to kill myself', { conversationPhase: 'option', selectedOption: 4 })))
      .toBe('emergencyHandler');
    expect(router(withUserMsg('menu', { conversationPhase: 'option', selectedOption: 4 })))
      .toBe('menuPresenter');
  });
});

describe('F6 — menu presenter', () => {
  it('shows the 6-option scenario menu with the leading "Thanks!" first time', () => {
    const res = makeMenuPresenter('numbered')(makeState({ conversationPhase: 'ageCheck' }));
    expect(res.pendingResponse).toBe(SCENARIO_MENU_TEXT);
    expect(res.conversationPhase).toBe('menu');
  });

  it('drops the "Thanks!" when re-displayed via the menu keyword', () => {
    const res = makeMenuPresenter('numbered')(
      makeState({ conversationPhase: 'option', selectedOption: 2 }),
    );
    expect(res.pendingResponse).toBe(SCENARIO_MENU_REPEAT_TEXT);
    expect(res.pendingResponse).not.toMatch(/^Thanks!/);
  });

  it('clears the previous scenario so the next pick starts clean', () => {
    const res = makeMenuPresenter('numbered')(
      makeState({ conversationPhase: 'option', selectedOption: 5 }),
    );
    expect(res.selectedOption).toBeNull();
    expect(res.aiBotChatId).toBeNull();
  });
});

describe('F6 — coach opens on the chosen scenario', () => {
  it('primes the coach with the scenario instead of asking which situation', async () => {
    const coach = { chat: jest.fn().mockResolvedValue({ reply: 'ok', chatId: 'c1' }) };
    await makeSocialCoachNode(coach as never, typing as never)(
      withUserMsg('4', { conversationPhase: 'option', selectedOption: 4, aiBotChatId: null }),
    );
    const prime = coach.chat.mock.calls[0][2] as string;
    expect(prime).toContain(SCENARIOS[4].label);
    expect(prime).toMatch(/do not ask.*which/i);
  });

  it('preserves the chosen scenario in state', async () => {
    const coach = { chat: jest.fn().mockResolvedValue({ reply: 'ok', chatId: 'c1' }) };
    const res = await makeSocialCoachNode(coach as never, typing as never)(
      withUserMsg('6', { conversationPhase: 'option', selectedOption: 6, aiBotChatId: null }),
    );
    expect(res.selectedOption).toBe(6);
  });

  it('does not re-prime once the coach session exists', async () => {
    const coach = { chat: jest.fn().mockResolvedValue({ reply: 'ok', chatId: 'c1' }) };
    await makeSocialCoachNode(coach as never, typing as never)(
      withUserMsg('tell me more', { conversationPhase: 'option', selectedOption: 4, aiBotChatId: 'c1' }),
    );
    expect(coach.chat.mock.calls[0][2]).toBeUndefined();
  });

  it('flags a referral when the coach emits [REFERRAL]', async () => {
    const coach = {
      chat: jest.fn().mockResolvedValue({ reply: '[REFERRAL] our team can help', chatId: 'c1' }),
    };
    const res = await makeSocialCoachNode(coach as never, typing as never)(
      withUserMsg('i need real help', { conversationPhase: 'option', selectedOption: 3, aiBotChatId: 'c1' }),
    );
    expect(res.referralRequested).toBe(true);
    expect(res.pendingResponse).not.toMatch(/referral/i);
  });

  it('suppresses referral on a crisis turn', async () => {
    const coach = {
      chat: jest.fn().mockResolvedValue({ reply: '[CRISIS][REFERRAL] hi', chatId: 'c1' }),
    };
    const res = await makeSocialCoachNode(coach as never, typing as never)(
      withUserMsg('...', { conversationPhase: 'option', selectedOption: 3, aiBotChatId: 'c1' }),
    );
    expect(res.crisisDetected).toBe(true);
    expect(res.referralRequested).toBe(false);
  });
});

describe('F2/F6 — age-triaged referral, no question when age is known', () => {
  const ai = { chat: jest.fn() };
  const node = () => makeResourceRedirectNode(ai as never, typing as never);

  it('gives INSIGHT for 25 and under with no question asked', async () => {
    const res = await node()(makeState({ age: 19, conversationPhase: 'option' }));
    expect(res.pendingResponse).toContain(INSIGHT_URL);
    expect(res.pendingResponse).not.toMatch(/25 or under/i);
    expect(res.awaitingReferralAge).toBe(false);
  });

  it('gives CREST for 26 and over with no question asked', async () => {
    const res = await node()(makeState({ age: 28, conversationPhase: 'option' }));
    expect(res.pendingResponse).toContain(CREST_URL);
    expect(res.pendingResponse).not.toMatch(/25 or under/i);
  });

  it('asks the fallback only when age is unknown', async () => {
    const res = await node()(makeState({ age: null, conversationPhase: 'option' }));
    expect(res.pendingResponse).toBe(REFERRAL_AGE_FALLBACK);
    expect(res.awaitingReferralAge).toBe(true);
  });

  it('clears the referral flag so it fires once, not every turn', async () => {
    const res = await node()(makeState({ age: 19, referralRequested: true }));
    expect(res.referralRequested).toBe(false);
  });

  it('never calls the AI on the referral path — the links must be exact', async () => {
    await node()(makeState({ age: 19 }));
    await node()(makeState({ age: null }));
    expect(ai.chat).not.toHaveBeenCalled();
  });
});
