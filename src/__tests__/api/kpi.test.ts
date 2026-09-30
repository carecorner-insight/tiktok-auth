import handler from '../../../api/bot-control';
import webhook from '../../../api/webhook';
import { getControlRedis } from '../../lib/redis';
import { signReferral, makeEvent } from '../../analytics/contract';
import { makeNormalizedMessage } from '../mocks';
import type { VercelRequest, VercelResponse } from '@vercel/node';

jest.mock('../../lib/redis', () => ({ getControlRedis: jest.fn(), getRedis: jest.fn() }));
jest.mock('@vercel/functions', () => ({ waitUntil: jest.fn() }));
const original = { ...process.env };
let store: { get: jest.Mock; eval: jest.Mock; set: jest.Mock };
const response = () => ({ status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis(), end: jest.fn().mockReturnThis(), setHeader: jest.fn() });
const request = (overrides: unknown = {}) => ({ method: 'GET', query: { kpi: 'true' }, headers: {}, ...overrides as object }) as unknown as VercelRequest;
beforeEach(() => {
  jest.clearAllMocks(); process.env.BOT_CONTROL_TOKEN = 'synthetic-admin-only'; process.env.KPI_USER_KEY_SECRET = 'a'.repeat(64);
  delete process.env.CRON_SECRET; delete process.env.KPI_COLLECTION_ENABLED; delete process.env.TELEGRAM_WEBHOOK_SECRET;
  store = { get: jest.fn(async () => null), eval: jest.fn(async () => [0, 0, '']), set: jest.fn(async () => 'OK') };
  (getControlRedis as jest.Mock).mockReturnValue(store);
});
afterEach(() => { process.env = { ...original }; });

it.each([undefined, 'wrong', ['synthetic-admin-only']])('rejects invalid admin authentication %j before touching Redis', async token => {
  const res = response();
  await handler(request({ headers: { 'x-bot-control-token': token } }), res as unknown as VercelResponse);
  expect(res.status).toHaveBeenCalledWith(401); expect(getControlRedis).not.toHaveBeenCalled();
});
it('reports configuration without returning credentials, receiver URL or source records', async () => {
  const res = response();
  await handler(request({ headers: { 'x-bot-control-token': 'synthetic-admin-only' } }), res as unknown as VercelResponse);
  expect(res.status).toHaveBeenCalledWith(200);
  expect(res.json).toHaveBeenCalledWith(expect.objectContaining({ enabled: false, pending: 0, identitySecretConfigured: true }));
  expect(JSON.stringify(res.json.mock.calls)).not.toContain('synthetic-admin-only');
  expect(JSON.stringify(res.json.mock.calls)).not.toContain('a'.repeat(64));
});
it('the daily sweep rejects missing/invalid cron authentication', async () => {
  process.env.CRON_SECRET = 'synthetic-cron-only'; const res = response();
  await handler(request({ headers: { authorization: 'Bearer wrong' } }), res as unknown as VercelResponse);
  expect(res.status).toHaveBeenCalledWith(401);
});
it('a valid signed human-support link still redirects when Redis is down', async () => {
  (getControlRedis as jest.Mock).mockImplementation(() => { throw new Error('offline'); });
  const id = 'a'.repeat(32); const res = response();
  await handler(request({ query: { ref: id, target: 'insight', sig: signReferral(id, 'insight', process.env.KPI_USER_KEY_SECRET!) }, headers: { 'user-agent': 'Mozilla/5.0' } }), res as unknown as VercelResponse);
  expect(res.status).toHaveBeenCalledWith(302);
  expect(res.setHeader).toHaveBeenCalledWith('Location', 'https://carecorner-ist.my.site.com/insight/');
});
it.each(['https://evil.example', 'wrong', ''])('does not redirect to arbitrary or unsigned targets %s', async target => {
  const res = response();
  await handler(request({ query: { ref: 'a'.repeat(32), target, sig: 'b'.repeat(64) } }), res as unknown as VercelResponse);
  expect(res.status).toHaveBeenCalledWith(404); expect(getControlRedis).not.toHaveBeenCalled();
});
it.each(['TelegramBot (preview)', 'ExampleCrawler'])('excludes known automated previews %s', async agent => {
  const id = 'a'.repeat(32); const res = response();
  await handler(request({ query: { ref: id, target: 'crest', sig: signReferral(id, 'crest', process.env.KPI_USER_KEY_SECRET!) }, headers: { 'user-agent': agent } }), res as unknown as VercelResponse);
  expect(res.status).toHaveBeenCalledWith(302); expect(store.eval).not.toHaveBeenCalled();
});
it('HEAD requests never count as clicks', async () => {
  const id = 'a'.repeat(32); const res = response();
  await handler(request({ method: 'HEAD', query: { ref: id, target: 'crest', sig: signReferral(id, 'crest', process.env.KPI_USER_KEY_SECRET!) } }), res as unknown as VercelResponse);
  expect(res.status).toHaveBeenCalledWith(302); expect(store.eval).not.toHaveBeenCalled();
});
it('logs an observed click using only the saved content-free event context', async () => {
  const id = 'a'.repeat(32); const res = response();
  const event = makeEvent(makeNormalizedMessage(), 'synthetic-key', true, null, 'referral_delivered');
  store.get.mockResolvedValue(JSON.stringify({ event })); store.eval.mockResolvedValue(1);
  await handler(request({ query: { ref: id, target: 'insight', sig: signReferral(id, 'insight', process.env.KPI_USER_KEY_SECRET!) }, headers: { 'user-agent': 'Mozilla/5.0' } }), res as unknown as VercelResponse);
  const recorded = JSON.parse(store.eval.mock.calls[0][2][0]);
  expect(recorded).toMatchObject({ eventType: 'referral_clicked', isTester: true, userKey: 'synthetic-key' });
  expect(res.status).toHaveBeenCalledWith(302);
});
it('main Telegram refuses collection without configured sender verification', async () => {
  process.env.KPI_COLLECTION_ENABLED = 'true'; const res = response();
  await webhook(request({ method: 'POST', query: { platform: 'telegram' } }), res as unknown as VercelResponse);
  expect(res.status).toHaveBeenCalledWith(503);
});
it.each([undefined, 'wrong', ['synthetic-telegram-secret']])('main Telegram refuses a forged sender header %j', async value => {
  process.env.TELEGRAM_WEBHOOK_SECRET = 'synthetic-telegram-secret'; const res = response();
  await webhook(request({ method: 'POST', query: { platform: 'telegram' }, headers: { 'x-telegram-bot-api-secret-token': value } }), res as unknown as VercelResponse);
  expect(res.status).toHaveBeenCalledWith(401);
});
