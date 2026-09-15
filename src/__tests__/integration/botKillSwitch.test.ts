import { handleMessage } from '../../../api/webhook';
import sim from '../../../api/sim';
import { getControlRedis, getRedis } from '@/lib/redis';
import { processMessage } from '@/graph/runner';
import { SessionManager } from '@/services/sessionManager';
import { memoryRedis } from '@/__tests__/mocks/controlRedis';
import { makeState, makeNormalizedMessage } from '@/__tests__/mocks';
import { MAINTENANCE_NOTICE, setBotMode, setCoachModel } from '@/lib/botControl';
import type { IPlatformAdapter } from '@/types/platform';
import type { VercelRequest, VercelResponse } from '@vercel/node';

jest.mock('@/lib/redis', () => ({ getRedis: jest.fn(), getControlRedis: jest.fn() }));
jest.mock('@/graph/runner', () => ({ processMessage: jest.fn() }));
jest.mock('@/services/sessionManager', () => ({ SessionManager: jest.fn().mockImplementation(() => ({ load: jest.fn(async () => null), save: jest.fn(), clear: jest.fn() })) }));
jest.mock('@/services/makeCareyAIClient', () => ({ makeCareyAIClient: jest.fn(() => ({ chat: jest.fn() })) }));
jest.mock('@/services/makeSocialCoachClient', () => ({ makeSocialCoachClient: jest.fn(() => ({ chat: jest.fn() })) }));
jest.mock('@/services/directLLMClient', () => ({ DirectLLMClient: jest.fn(() => ({ chat: jest.fn() })) }));
const env = { ...process.env };
let store: ReturnType<typeof memoryRedis>;
let adapter: IPlatformAdapter;
beforeEach(() => {
  jest.clearAllMocks(); store = memoryRedis();
  (getControlRedis as jest.Mock).mockReturnValue(store.client); (getRedis as jest.Mock).mockReturnValue(store.client);
  delete process.env.VERCEL; delete process.env.VERCEL_ENV;
  delete process.env.POWER_AUTOMATE_WEBHOOK_URL; delete process.env.DEMOGRAPHICS_WEBHOOK_URL;
  process.env.SCENARIO_MENU = 'true'; process.env.COACH_PROVIDER = 'direct'; process.env.DYNAMIC_COACH_PROMPT = 'false';
  adapter = { platform: 'telegram', normalizeMessage: () => makeNormalizedMessage({ messageId: 'synthetic-update' }), sendMessage: jest.fn(async () => {}), sendTypingIndicator: jest.fn(async () => {}) };
  (processMessage as jest.Mock).mockResolvedValue({ response: 'Generated reply', state: makeState() });
});
afterEach(() => { process.env = { ...env }; });
it.each(['telegram', 'tiktok'] as const)('OFF sends only the fixed notice for %s, without graph, session or typing', async platform => {
  adapter.normalizeMessage = () => makeNormalizedMessage({ platform, conversationId: 'synthetic-conversation', messageId: 'synthetic-update', text: 'Synthetic crisis statement' });
  await setBotMode(store.client, false);
  await handleMessage(adapter, {}, store.client);
  await handleMessage(adapter, {}, store.client); // duplicate platform update
  expect(adapter.sendMessage).toHaveBeenCalledTimes(1);
  expect(adapter.sendMessage).toHaveBeenCalledWith('user-123', MAINTENANCE_NOTICE, 'synthetic-conversation');
  expect(processMessage).not.toHaveBeenCalled(); expect(SessionManager).not.toHaveBeenCalled();
  expect(adapter.sendTypingIndicator).not.toHaveBeenCalled();
});
it('continues normally when ON', async () => {
  await handleMessage(adapter, {}, store.client);
  expect(adapter.sendMessage).toHaveBeenCalledWith('user-123', 'Generated reply', undefined);
});
it.each([false, true])('suppresses a generated reply after OFF, even if turned ON again (%s)', async resume => {
  (processMessage as jest.Mock).mockImplementation(async () => {
    await setBotMode(store.client, false); if (resume) await setBotMode(store.client, true);
    return { response: 'Stale generated reply', state: makeState() };
  });
  await handleMessage(adapter, {}, store.client);
  expect(adapter.sendMessage).toHaveBeenCalledTimes(1);
  expect(adapter.sendMessage).toHaveBeenCalledWith('user-123', MAINTENANCE_NOTICE, undefined);
});
it('suppresses typing, further model calls, persistence and fallback errors after OFF', async () => {
  (processMessage as jest.Mock).mockImplementation(async (_msg, services) => {
    await setBotMode(store.client, false);
    await services.typing.sendTypingIndicator('user-123');
    await expect(services.socialCoach.chat(null, 'new')).rejects.toThrow();
    await expect(services.session.save(makeState())).rejects.toThrow();
    throw new Error('Provider failed');
  });
  await handleMessage(adapter, {}, store.client);
  expect(adapter.sendTypingIndicator).not.toHaveBeenCalled();
  expect(adapter.sendMessage).toHaveBeenCalledWith('user-123', MAINTENANCE_NOTICE, undefined);
});
it('leaves the explicitly separate study path unaffected', async () => {
  await setBotMode(store.client, false);
  await handleMessage(adapter, {}, store.client, { study: true });
  expect(processMessage).toHaveBeenCalled();
  expect(adapter.sendMessage).toHaveBeenCalledWith('user-123', 'Generated reply', undefined);
});
it('uses the maintenance notice on unavailable control reads', async () => {
  const unavailable = memoryRedis(); unavailable.client.get.mockRejectedValue(new Error('offline'));
  (getControlRedis as jest.Mock).mockReturnValue(unavailable.client);
  await handleMessage(adapter, {}, store.client);
  expect(processMessage).not.toHaveBeenCalled();
  expect(adapter.sendMessage).toHaveBeenCalledWith('user-123', MAINTENANCE_NOTICE, undefined);
});
it('the simulator also skips graph/session reset while OFF', async () => {
  await setBotMode(store.client, false); process.env.SIM_TOKEN = 'synthetic-sim';
  const res = { status: jest.fn().mockReturnThis(), json: jest.fn().mockReturnThis() };
  await sim({ method: 'POST', headers: { 'x-sim-token': 'synthetic-sim' }, body: { userId: 'synthetic', text: 'hello', reset: true } } as unknown as VercelRequest, res as unknown as VercelResponse);
  expect(res.status).toHaveBeenCalledWith(503);
  expect(res.json).toHaveBeenCalledWith({ response: MAINTENANCE_NOTICE, maintenance: true });
  expect(processMessage).not.toHaveBeenCalled(); expect(SessionManager).not.toHaveBeenCalled();
});
it('passes the selected model through the real resolver into the coach factory', async () => {
  await setCoachModel(store.client, 'qwen-flash');
  await handleMessage(adapter, {}, store.client);
  const { makeSocialCoachClient } = jest.requireMock('@/services/makeSocialCoachClient');
  expect(makeSocialCoachClient).toHaveBeenCalledWith(expect.objectContaining({ metadata: expect.objectContaining({ model: 'qwen-flash', modelSource: 'dashboard' }) }));
});
