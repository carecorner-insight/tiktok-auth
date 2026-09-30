import IoRedis from 'ioredis';
import type { RedisClient } from '../../lib/redis';
import { KpiOutbox, validReceiverUrl } from '../../analytics/outbox';
import { KpiCollector } from '../../analytics/collector';
import { makeEvent, newKpiState } from '../../analytics/contract';
import { makeNormalizedMessage, makeState } from '../mocks';

// Run against an isolated disposable Redis only; never flush a shared database.
const realRedis = process.env.KPI_TEST_REDIS_URL ? describe : describe.skip;
realRedis('real Redis durable outbox', () => {
  let io: IoRedis;
  let redis: RedisClient;
  const originalEnv = { ...process.env };
  const originalFetch = globalThis.fetch;
  const url = 'https://prod-1.southeastasia.logic.azure.com/workflows/synthetic/triggers/manual/paths/invoke';
  const msg = () => makeNormalizedMessage({ userId: 'synthetic-only', messageId: 'synthetic-update', timestamp: Date.now() });
  const event = () => makeEvent(msg(), 'synthetic-key', true, null, 'activity');
  beforeAll(() => {
    if (process.env.KPI_TEST_REDIS_URL !== 'redis://127.0.0.1:16387/15') throw new Error('Tests require the designated disposable Redis endpoint');
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
  beforeEach(async () => { await io.flushdb(); process.env.KPI_USER_KEY_SECRET = 'a'.repeat(64); });
  afterEach(() => { globalThis.fetch = originalFetch; process.env = { ...originalEnv }; });
  afterAll(async () => { await io.quit(); });

  it('atomically deduplicates repeated event IDs and archives one durable copy', async () => {
    const box = new KpiOutbox(redis, url); const item = event();
    await Promise.all([box.record(item), box.record(item), box.record(item)]);
    expect(await box.status()).toMatchObject({ pending: 1, retained: 1 });
    expect(await box.read(0, Date.now())).toEqual([item]);
  });
  it('retains events with no receiver configured instead of dropping them', async () => {
    const box = new KpiOutbox(redis); await box.record(event());
    expect(await box.flush()).toMatchObject({ configured: false, delivered: 0 });
    expect((await box.status()).pending).toBe(1);
  });
  it.each([202, 400, 429, 500])('does not acknowledge HTTP %s; schedules a durable retry', async status => {
    globalThis.fetch = jest.fn(async () => ({ status })) as any;
    const box = new KpiOutbox(redis, url); await box.record(event());
    expect(await box.flush()).toMatchObject({ failed: 1, delivered: 0 });
    expect((await box.status()).pending).toBe(1);
    expect(Number(await io.zscore('kpi:pending', event().eventId))).toBeGreaterThan(Date.now());
  });
  it('only matching accepted:true storage acknowledgement removes pending work, not the archive', async () => {
    const box = new KpiOutbox(redis, url); const item = event(); await box.record(item);
    globalThis.fetch = jest.fn(async () => ({ status: 200, json: async () => ({ accepted: true, eventId: item.eventId }) })) as any;
    expect(await box.flush()).toMatchObject({ delivered: 1 });
    expect(await box.status()).toMatchObject({ pending: 0, retained: 1 });
  });
  it('invalid ack and a network timeout do not discard an event', async () => {
    const box = new KpiOutbox(redis, url); const item = event(); await box.record(item);
    globalThis.fetch = jest.fn(async () => { throw new Error('timeout'); }) as any;
    await box.flush();
    await io.zadd('kpi:pending', 0, item.eventId);
    globalThis.fetch = jest.fn(async () => ({ status: 200, json: async () => ({ accepted: true, eventId: 'wrong' }) })) as any;
    await box.flush(); expect((await box.status()).pending).toBe(1);
  });
  it('recovers after failure with the SAME stable event ID', async () => {
    const box = new KpiOutbox(redis, url); const item = event(); await box.record(item);
    globalThis.fetch = jest.fn(async () => ({ status: 503 })) as any;
    await box.flush(); await io.zadd('kpi:pending', 0, item.eventId);
    const bodies: string[] = [];
    globalThis.fetch = jest.fn(async (_url, init) => {
      bodies.push(JSON.parse(init!.body as string).eventId);
      return { status: 200, json: async () => ({ accepted: true, eventId: item.eventId }) };
    }) as any;
    await box.flush(); expect(bodies).toEqual([item.eventId]); expect((await box.status()).pending).toBe(0);
  });
  it('concurrent workers lease one event rather than sending it twice', async () => {
    const box = new KpiOutbox(redis, url); const item = event(); await box.record(item);
    const fetcher = jest.fn(async () => ({ status: 200, json: async () => ({ accepted: true, eventId: item.eventId }) }));
    globalThis.fetch = fetcher as any;
    await Promise.all([box.flush(), box.flush()]); expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('a crashed worker lease expires and another worker can recover it', async () => {
    const box = new KpiOutbox(redis, url); const item = event(); await box.record(item);
    await io.zadd('kpi:pending', Date.now() + 120000, item.eventId);
    globalThis.fetch = jest.fn(async () => ({ status: 200, json: async () => ({ accepted: true, eventId: item.eventId }) })) as any;
    expect((await box.flush()).delivered).toBe(0);
    await io.zadd('kpi:pending', Date.now() - 1, item.eventId);
    expect((await box.flush()).delivered).toBe(1);
  });
  it('enforces a seven-day per-user cooldown and tester exclusions', async () => {
    const collector = new KpiCollector(redis, msg());
    const first = await collector.claimFeedback(msg().userId);
    expect(['usefulness', 'clarity']).toContain(first);
    expect(await collector.claimFeedback(msg().userId)).toBeNull();
    expect(await io.ttl('kpi:feedback-cooldown:' + collector.key)).toBeGreaterThan(6 * 86400);
    process.env.KPI_TESTER_USER_IDS = msg().userId;
    expect(await new KpiCollector(redis, msg()).claimFeedback(msg().userId)).toBeNull();
  });
  it('two messages during one contact session produce one session start; expiry starts another', async () => {
    const first = await new KpiCollector(redis, msg()).activity(20);
    const secondMsg = { ...msg(), messageId: 'second' };
    const collector = new KpiCollector(redis, secondMsg);
    const second = await collector.activity(20);
    expect(second.sessionId).toBe(first.sessionId);
    const events = await collector.outbox.read(0, Date.now());
    expect(events.filter(e => e.eventType === 'activity')).toHaveLength(2);
    expect(events.filter(e => e.eventType === 'session_started')).toHaveLength(1);
    await io.del('kpi:contact:' + collector.key);
    const third = await new KpiCollector(redis, { ...msg(), messageId: 'third' }).activity(20);
    expect(third.sessionId).not.toBe(first.sessionId);
  });
  it('an existing pre-rollout session is not fabricated as a new observed session', async () => {
    const collector = new KpiCollector(redis, msg());
    await collector.activity(20, makeState({ sessionId: 'existing-session' }));
    const events = await collector.outbox.read(0, Date.now());
    expect(events.filter(e => e.eventType === 'session_started')).toHaveLength(0);
    expect(events[0].sessionStartObserved).toBe(false);
  });
  it('does not emit undelivered check-in or feedback facts', async () => {
    const collector = new KpiCollector(redis, msg());
    await collector.completed(makeState({ kpi: { ...newKpiState(Date.now()), facts: [{ eventType: 'checkin_reached', requiresDelivery: true }, { eventType: 'response_recorded', question: 'readiness', response: '2' }] } }), 'failed');
    const events = await collector.outbox.read(0, Date.now());
    expect(events.some(e => e.eventType === 'checkin_reached')).toBe(false);
    expect(events.some(e => e.eventType === 'response_recorded')).toBe(true);
  });
  it('unknown referral tier history remains unknown, with an opaque owned redirect', async () => {
    process.env.KPI_PUBLIC_BASE_URL = 'https://tiktok-auth-topaz.vercel.app';
    const collector = new KpiCollector(redis, msg());
    const referral = await collector.referral(makeState(), 'https://carecorner-ist.my.site.com/insight/');
    expect(referral?.reply).toMatch(/\/api\/bot-control\?ref=[a-f0-9]{32}&target=insight&sig=[a-f0-9]{64}$/);
    expect(referral?.event.maxTierBeforeReferral).toBe('missing');
    expect((await collector.outbox.status()).pending).toBe(0); // not delivered yet
  });
});

it.each(['http://prod.logic.azure.com/x', 'https://evil.example/x', 'https://logic.azure.com.evil.example/x', 'https://user:password@prod.logic.azure.com/x'])('rejects an unsafe receiver URL %s', url => expect(validReceiverUrl(url)).toBe(false));
it('accepts supported signed Power Automate trigger hosts', () => {
  expect(validReceiverUrl('https://prod.logic.azure.com/x')).toBe(true);
  expect(validReceiverUrl('https://org.environment.api.powerplatform.com/x')).toBe(true);
});
