import handler from '../../../api/bot-control';
import { getControlRedis } from '@/lib/redis';
import { memoryRedis } from '@/__tests__/mocks/controlRedis';
import type { VercelRequest, VercelResponse } from '@vercel/node';

jest.mock('@/lib/redis', () => ({ getControlRedis: jest.fn() }));
const env = { ...process.env };
let store: ReturnType<typeof memoryRedis>;
beforeEach(() => {
  store = memoryRedis(); (getControlRedis as jest.Mock).mockReturnValue(store.client);
  process.env.BOT_CONTROL_TOKEN = 'synthetic-control'; process.env.SCENARIO_MENU = 'true';
  process.env.COACH_PROVIDER = 'direct'; delete process.env.VERCEL; delete process.env.VERCEL_ENV;
});
afterEach(() => { process.env = { ...env }; });
async function request(method = 'GET', body?: unknown, headers: Record<string, string> = { 'x-bot-control-token': 'synthetic-control', 'content-type': 'application/json' }) {
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis(), setHeader: jest.fn() };
  await handler({ method, body, headers, query: { token: 'synthetic-control' } } as unknown as VercelRequest, res as unknown as VercelResponse);
  return { status: res.status.mock.calls[0][0], body: res.json.mock.calls[0][0], res };
}
it('requires the dedicated header token, not a query token', async () => {
  expect((await request('GET', undefined, {})).status).toBe(401);
  expect((await request('GET', undefined, { 'x-bot-control-token': 'wrong' })).status).toBe(401);
  delete process.env.BOT_CONTROL_TOKEN; expect((await request()).status).toBe(503);
});
it.each([{ enabled: 'false' }, { enabled: false, model: 'qwen-plus' }, { model: 'unapproved' }, [], {}, null])('rejects invalid input %j', async body => {
  expect((await request('POST', body)).status).toBe(400);
  expect(store.client.set).not.toHaveBeenCalled();
});
it('confirms OFF and model persistence independently, with no credentials in output', async () => {
  expect((await request('POST', { enabled: false })).body.mode.enabled).toBe(false);
  const saved = await request('POST', { model: 'qwen-flash' });
  expect(saved.body.mode.enabled).toBe(false); expect(saved.body.effectiveModel).toBe('qwen-flash');
  expect(JSON.stringify(saved.body)).not.toContain('synthetic-control');
  expect(saved.res.setHeader).toHaveBeenCalledWith('Cache-Control', 'no-store');
});
it('blocks provider-inapplicable model changes while allowing OFF', async () => {
  process.env.COACH_PROVIDER = 'aibots';
  expect((await request('POST', { model: 'qwen-plus' })).status).toBe(409);
  expect((await request('POST', { enabled: false })).status).toBe(200);
});
it('reports unknown reads and unconfirmed writes without leaking exception details', async () => {
  store.client.get.mockRejectedValue(new Error('sensitive connection string'));
  expect((await request()).body.mode).toBeNull();
  store.client.set.mockRejectedValue(new Error('sensitive connection string'));
  const result = await request('POST', { enabled: false });
  expect(result.status).toBe(503); expect(JSON.stringify(result.body)).not.toContain('sensitive');
});
it('rejects oversized JSON, wrong content type, and unsupported methods', async () => {
  expect((await request('POST', { model: 'x'.repeat(1025) })).status).toBe(400);
  expect((await request('POST', { enabled: false }, { 'x-bot-control-token': 'synthetic-control' })).status).toBe(400);
  expect((await request('DELETE')).status).toBe(405);
});
