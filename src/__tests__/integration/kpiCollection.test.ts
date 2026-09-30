import IoRedis from 'ioredis';
import { handleMessage } from '../../../api/webhook';
import { getControlRedis } from '../../lib/redis';
import type { RedisClient } from '../../lib/redis';
import { KpiOutbox } from '../../analytics/outbox';
import { SessionManager } from '../../services/sessionManager';
import { makeSocialCoachClient } from '../../services/makeSocialCoachClient';
import { withKeyPrefix } from '../../lib/prefixedRedis';
import { setBotMode, MAINTENANCE_NOTICE } from '../../lib/botControl';
import { makeNormalizedMessage } from '../mocks';
import type { IPlatformAdapter } from '../../types/platform';
import { computeMonthlyReport } from '../../analytics/report';

jest.mock('../../lib/redis', () => ({ getControlRedis: jest.fn(), getRedis: jest.fn() }));
jest.mock('../../services/makeSocialCoachClient', () => ({ makeSocialCoachClient: jest.fn() }));
jest.mock('../../services/makeCareyAIClient', () => ({ makeCareyAIClient: jest.fn(() => ({ chat: jest.fn() })) }));
jest.mock('../../services/directLLMClient', () => ({ DirectLLMClient: jest.fn(() => ({ chat: jest.fn(async () => ({ reply: 'TALK', chatId: 'test' })) })) }));

const realRedis = process.env.KPI_TEST_REDIS_URL ? describe : describe.skip;
realRedis('social-coach webhook through graph and real durable storage', () => {
  let io: IoRedis;
  let redis: RedisClient;
  let coach: { chat: jest.Mock };
  let adapter: IPlatformAdapter;
  let update = 0;
  const original = { ...process.env };
  const block = (checkin: boolean) => `A short coaching reply. <carey-kpi>{"mode":"prepare","tier":"1","checkin":${checkin},"scriptChosen":"missing"}</carey-kpi>`;
  beforeAll(() => {
    if (process.env.KPI_TEST_REDIS_URL !== 'redis://127.0.0.1:16387/15') throw new Error('Use the designated disposable test database');
    io = new IoRedis(process.env.KPI_TEST_REDIS_URL!, { maxRetriesPerRequest: 0 });
    redis = {
      get: key => io.get(key), set: async (key, value, opts) => {
        const raw = typeof value === 'string' ? value : JSON.stringify(value);
        if (opts?.nx && opts.ex) return io.set(key, raw, 'EX', opts.ex, 'NX');
        if (opts?.ex) return io.set(key, raw, 'EX', opts.ex);
        return io.set(key, raw);
      }, del: key => io.del(key), lpush: (key, ...values) => io.lpush(key, ...values),
      ltrim: (key, a, b) => io.ltrim(key, a, b), lrange: (key, a, b) => io.lrange(key, a, b), expire: (key, value) => io.expire(key, value),
      eval: (script, keys, args) => io.eval(script, keys.length, ...keys, ...args),
    };
  });
  beforeEach(async () => {
    await io.flushdb(); jest.clearAllMocks(); update = 0;
    delete process.env.VERCEL; delete process.env.VERCEL_ENV;
    delete process.env.KPI_POWER_AUTOMATE_WEBHOOK_URL; delete process.env.POWER_AUTOMATE_WEBHOOK_URL; delete process.env.DEMOGRAPHICS_WEBHOOK_URL;
    process.env.SESSION_ENCRYPTION_KEY = 'a'.repeat(64); process.env.KPI_USER_KEY_SECRET = 'b'.repeat(64);
    process.env.KPI_COLLECTION_ENABLED = 'true'; process.env.KPI_TESTER_USER_IDS = '123456789';
    process.env.SCENARIO_MENU = 'true'; process.env.SCREENER_ENABLED = 'false'; process.env.AUTH_ENABLED = 'false';
    process.env.COACH_PROVIDER = 'direct'; process.env.DYNAMIC_COACH_PROMPT = 'false';
    coach = { chat: jest.fn(async () => ({ reply: block(false), chatId: 'direct:synthetic' })) };
    (makeSocialCoachClient as jest.Mock).mockReturnValue(coach);
    (getControlRedis as jest.Mock).mockReturnValue(redis);
    adapter = { platform: 'telegram', normalizeMessage: body => makeNormalizedMessage({ userId: '123456789', messageId: String(update), text: String(body) }), sendMessage: jest.fn(async () => {}), sendTypingIndicator: jest.fn(async () => {}) };
  });
  afterEach(() => { process.env = { ...original }; });
  afterAll(async () => { await io.quit(); });
  const turn = async (text: string) => { update++; await handleMessage(adapter, text, redis, { menuMode: 'numbered' }); };
  const events = () => new KpiOutbox(redis).read(0, Date.now());

  it('collects welcome→age→scenario→check-in→readiness with no real Telegram/model/flow calls', async () => {
    await turn('/start'); await turn('20'); await turn('2');
    coach.chat.mockResolvedValueOnce({ reply: block(true), chatId: 'direct:synthetic' });
    await turn('I want to practise saying hello'); await turn('2');
    expect(coach.chat).toHaveBeenCalledTimes(2);
    const rows = await events();
    expect(rows.filter(row => row.eventType === 'activity')).toHaveLength(5);
    expect(rows.filter(row => row.eventType === 'session_started')).toHaveLength(1);
    expect(new Set(rows.map(row => row.sessionId)).size).toBe(1);
    expect(rows.filter(row => row.eventType === 'scenario_started')).toHaveLength(1);
    expect(rows.filter(row => row.eventType === 'checkin_reached')).toHaveLength(1);
    expect(rows.find(row => row.eventType === 'response_recorded')).toMatchObject({ question: 'readiness', response: '2' });
    expect(rows.every(row => row.isTester)).toBe(true);
    expect(JSON.stringify(rows)).not.toContain('123456789');
    expect(JSON.stringify(rows)).not.toContain('practise saying hello');
    expect((await new SessionManager(redis).load('telegram', '123456789'))?.kpi?.readiness).toBe('2');
    expect(computeMonthlyReport(rows, rows[0].monthSGT).K4_monthlyActiveUsers).toBe(0);
    expect((makeSocialCoachClient as jest.Mock).mock.calls[0][0].systemPrompt).toContain('INTERNAL MEASUREMENT');
  });
  it('replaying the same Telegram update cannot create another activity or call AI', async () => {
    await turn('/start'); await handleMessage(adapter, '/start', redis, { menuMode: 'numbered' });
    expect((await events()).filter(row => row.eventType === 'activity')).toHaveLength(1);
    expect(adapter.sendMessage).toHaveBeenCalledTimes(1);
  });
  it('turning collection off stops feedback left over in an existing session', async () => {
    await turn('/start'); await turn('20');
    coach.chat.mockResolvedValueOnce({ reply: block(true), chatId: 'direct:synthetic' });
    await turn('2');
    expect((await new SessionManager(redis).load('telegram', '123456789'))?.kpi?.pendingQuestion).toBe('readiness');
    const before = await events();
    process.env.KPI_COLLECTION_ENABLED = 'false';
    coach.chat.mockResolvedValueOnce({ reply: 'Normal coaching continues.', chatId: 'direct:synthetic' });
    await turn('2');
    expect(coach.chat).toHaveBeenCalledTimes(2);
    expect((await new SessionManager(redis).load('telegram', '123456789'))?.kpi).toBeUndefined();
    expect(await events()).toEqual(before);
    expect(adapter.sendMessage).toHaveBeenLastCalledWith('123456789', 'Normal coaching continues.', undefined);
  });
  it('maintenance records a genuine contact and static notice, without any AI', async () => {
    await io.set('age:telegram:123456789', '20'); await setBotMode(redis, false);
    await turn('Hello');
    expect(coach.chat).not.toHaveBeenCalled(); expect(adapter.sendTypingIndicator).not.toHaveBeenCalled();
    expect(adapter.sendMessage).toHaveBeenCalledWith('123456789', MAINTENANCE_NOTICE, undefined);
    expect((await events()).find(row => row.eventType === 'turn_completed')).toMatchObject({ deliveryStatus: 'maintenance', eligibility: 'eligible' });
  });
  it('the separately namespaced study path receives no KPI changes even with global collection enabled', async () => {
    const before = await events(); const study = withKeyPrefix(redis, 'study:');
    process.env.SCENARIO_MENU = 'false'; process.env.SCREENER_ENABLED = 'true';
    update++;
    await handleMessage(adapter, '/start', study, { study: true, menuMode: 'numbered', logUrl: null });
    expect(await events()).toEqual(before);
    expect((await new SessionManager(study).load('telegram', '123456789'))?.kpi).toBeUndefined();
    expect((makeSocialCoachClient as jest.Mock).mock.calls[0][0].systemPrompt).not.toContain('INTERNAL MEASUREMENT');
  });
  it('a failed Telegram send does not record completion or retain an unsent question binding', async () => {
    await turn('/start'); await turn('20');
    coach.chat.mockResolvedValueOnce({ reply: block(true), chatId: 'direct:synthetic' });
    (adapter.sendMessage as jest.Mock).mockRejectedValueOnce(new Error('synthetic transport failure'));
    await expect(turn('2')).rejects.toThrow('synthetic transport failure');
    const state = await new SessionManager(redis).load('telegram', '123456789');
    expect(state?.kpi?.checkinReached).toBe(false); expect(state?.kpi?.pendingQuestion).toBeNull();
    expect((await events()).filter(row => row.eventType === 'checkin_reached')).toHaveLength(0);
  });
  it('a later model failure cannot re-emit the previous turn\'s rating', async () => {
    await turn('/start'); await turn('20');
    coach.chat.mockResolvedValueOnce({ reply: block(true), chatId: 'direct:synthetic' });
    await turn('2'); await turn('2');
    coach.chat.mockRejectedValueOnce(new Error('synthetic provider outage'));
    await turn('Could we keep practising?');
    const rows = await events();
    expect(rows.filter(row => row.eventType === 'response_recorded')).toHaveLength(1);
    expect(rows.filter(row => row.eventType === 'turn_completed' && row.deliveryStatus === 'failed')).toHaveLength(1);
  });
  it('a scenario menu selection is recorded even if its first model call fails', async () => {
    await turn('/start'); await turn('20');
    coach.chat.mockRejectedValueOnce(new Error('synthetic provider outage'));
    await turn('2');
    expect((await events()).filter(row => row.eventType === 'scenario_started')).toHaveLength(1);
    expect((await events()).filter(row => row.eventType === 'checkin_reached')).toHaveLength(0);
  });
  it('an analytics storage error does not prevent the ordinary bot response', async () => {
    const broken: RedisClient = { ...redis, eval: async () => { throw new Error('synthetic analytics outage'); } };
    (getControlRedis as jest.Mock).mockReturnValue(broken);
    await turn('/start');
    expect(adapter.sendMessage).toHaveBeenCalledTimes(1);
    expect((makeSocialCoachClient as jest.Mock).mock.calls[0][0].systemPrompt).not.toContain('INTERNAL MEASUREMENT');
  });
});
