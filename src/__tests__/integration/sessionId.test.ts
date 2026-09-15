import { processMessage } from '@/graph/runner';
import { SessionManager } from '@/services/sessionManager';
import { SharePointLogger } from '@/services/sharePointLogger';
import { makeAIBotsClientMock, makeNormalizedMessage, makeState } from '@/__tests__/mocks';
import { memoryRedis } from '@/__tests__/mocks/controlRedis';
import type { NormalizedMessage } from '@/types/platform';
import type { CareyBotState } from '@/types/state';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const originalEnv = { ...process.env };

beforeEach(() => {
  process.env.AUTH_ENABLED = 'false';
  process.env.SCREENER_ENABLED = 'false';
  process.env.SCENARIO_MENU = 'true';
  process.env.CRISIS_STATIC_FIRST = 'true';
  process.env.SESSION_ENCRYPTION_KEY = 'ab'.repeat(32); // Synthetic test key only.
});
afterEach(() => { process.env = { ...originalEnv }; });

function harness() {
  const { client, data } = memoryRedis();
  const expiry = new Map<string, number>();
  let now = 0;
  client.get.mockImplementation(async key => {
    if (now >= (expiry.get(key) ?? Infinity)) data.delete(key);
    return data.get(key) ?? null;
  });
  client.set.mockImplementation(async (key, value, opts) => {
    data.set(key, String(value));
    expiry.set(key, opts?.ex === undefined ? Infinity : now + opts.ex);
    return 'OK';
  });
  const session = new SessionManager(client);
  const socialCoach = makeAIBotsClientMock();
  const services = {
    session, socialCoach,
    aiBots: makeAIBotsClientMock(),
    intentLLM: makeAIBotsClientMock('TALK'),
    whitelist: { isAuthorized: jest.fn().mockResolvedValue(true) },
    typing: { sendTypingIndicator: jest.fn().mockResolvedValue(undefined) },
    menuMode: 'numbered' as const,
  };
  const fetch = jest.fn().mockResolvedValue({ ok: true });
  const logger = new SharePointLogger('https://example.invalid/test-log', fetch);
  const turn = async (text: string, overrides: Partial<NormalizedMessage> = {}) => {
    const result = await processMessage(makeNormalizedMessage({ text, ...overrides }), services);
    await logger.log(result.state, text, result.response);
    return result.state;
  };
  return {
    turn, session, services, socialCoach, data,
    advance: (seconds: number) => { now += seconds; },
    logs: () => fetch.mock.calls.map(([, init]) => JSON.parse(init.body)),
  };
}

describe('app-generated session IDs through the real graph and encrypted session store', () => {
  it('persists one UUID across turns, menu/scenario changes and provider session replacement', async () => {
    const h = harness();
    const first = await h.turn('hello');
    expect(first.sessionId).toMatch(UUID_V4);
    expect(first.conversationId).toBe('');
    for (const text of ['20', '2', 'Tell me more', 'menu', '3']) {
      expect((await h.turn(text)).sessionId).toBe(first.sessionId);
    }
    h.socialCoach.chat.mockResolvedValue({ reply: 'Recovered reply', chatId: 'different-provider-session' });
    const recovered = await h.turn('Continue');
    expect(recovered.aiBotChatId).toBe('different-provider-session');
    expect(recovered.sessionId).toBe(first.sessionId);
    expect((await h.session.load('telegram', 'user-123'))?.sessionId).toBe(first.sessionId);
    expect(h.data.get('session:telegram:user-123')).not.toContain(first.sessionId!);
    expect(h.logs().every(log => log.sessionId === first.sessionId)).toBe(true);
  });

  it('rotates on restart, with the restart log and following turns using the new ID', async () => {
    const h = harness();
    const first = await h.turn('hello');
    const restarted = await h.turn('/restart');
    expect(restarted.sessionId).toMatch(UUID_V4);
    expect(restarted.sessionId).not.toBe(first.sessionId);
    expect(h.logs()[1].sessionId).toBe(restarted.sessionId);
    expect((await h.turn('20')).sessionId).toBe(restarted.sessionId);
  });

  it('uses sliding six-hour inactivity expiry, not six hours since the first turn', async () => {
    const h = harness();
    const first = await h.turn('hello');
    h.advance(21599);
    expect((await h.turn('20')).sessionId).toBe(first.sessionId);
    h.advance(21599);
    expect((await h.turn('2')).sessionId).toBe(first.sessionId);
    h.advance(21600);
    const expired = await h.turn('hello again');
    expect(expired.sessionId).toMatch(UUID_V4);
    expect(expired.sessionId).not.toBe(first.sessionId);
  });

  it('backfills a legacy session without losing its history or transport ID', async () => {
    const h = harness();
    const message = { role: 'assistant' as const, content: 'Earlier context', timestamp: 1 };
    await h.session.save(makeState({
      age: 20, conversationPhase: 'option', selectedOption: 2, messages: [message],
    }));
    const state = await h.turn('Continue');
    expect(state.sessionId).toMatch(UUID_V4);
    expect(state.messages).toContainEqual(message);
    expect(state.conversationId).toBe('conversation-abc');
    expect((await h.turn('Another reply')).sessionId).toBe(state.sessionId);
  });

  it.each([null, '', 42, 'not-a-uuid'])('replaces a malformed saved session ID (%s)', async value => {
    const h = harness();
    await h.session.save(makeState({ sessionId: value as CareyBotState['sessionId'] }));
    expect((await h.turn('hello')).sessionId).toMatch(UUID_V4);
  });

  it('does not reuse IDs across users or platforms and preserves TikTok conversationId', async () => {
    const h = harness();
    const first = await h.turn('hello');
    const other = await h.turn('hello', { userId: 'user-456' });
    const tiktok = await h.turn('hello', { platform: 'tiktok', conversationId: 'tiktok-conversation' });
    expect(new Set([first.sessionId, other.sessionId, tiktok.sessionId]).size).toBe(3);
    expect(tiktok.conversationId).toBe('tiktok-conversation');
  });

  it('generates its own ID even when the incoming message includes one', async () => {
    const h = harness();
    const supplied = '36fce803-c797-45a6-8aa9-f810a5ad395b';
    const state = await h.turn('hello', {
      sessionId: supplied, raw: { sessionId: supplied },
    } as Partial<NormalizedMessage>);
    expect(state.sessionId).toMatch(UUID_V4);
    expect(state.sessionId).not.toBe(supplied);
  });

  it('keeps the ID when entering crisis mode', async () => {
    const h = harness();
    const first = await h.turn('hello');
    const crisis = await h.turn('I want to kill myself');
    expect(crisis.crisisDetected).toBe(true);
    expect(crisis.sessionId).toBe(first.sessionId);
  });

  it('creates a new ID after an explicit session clear', async () => {
    const h = harness();
    const first = await h.turn('hello');
    await h.session.clear('telegram', 'user-123');
    expect((await h.turn('hello')).sessionId).not.toBe(first.sessionId);
  });

  it('does not save a session for an unauthorized turn', async () => {
    process.env.AUTH_ENABLED = 'true';
    const h = harness();
    h.services.whitelist.isAuthorized.mockResolvedValue(false);
    await h.turn('hello');
    expect(await h.session.load('telegram', 'user-123')).toBeNull();
  });
});
