import { BotTurnControl, controlScope, readBotMode, readCoachModel, setBotMode, setCoachModel } from '@/lib/botControl';
import { memoryRedis } from '@/__tests__/mocks/controlRedis';
import { resolveCoachConfig } from '@/services/resolveCoachConfig';
import { makeState } from '@/__tests__/mocks';
import type { SessionManager } from '@/services/sessionManager';

const env = { ...process.env };
beforeEach(() => { delete process.env.VERCEL; delete process.env.VERCEL_ENV; delete process.env.VERCEL_GIT_COMMIT_REF; });
afterEach(() => { process.env = { ...env }; });

it('preserves ON with no record, and persists OFF without expiry', async () => {
  const { client } = memoryRedis();
  expect((await readBotMode(client)).enabled).toBe(true);
  await setBotMode(client, false);
  expect(await readBotMode(client)).toMatchObject({ enabled: false, revision: expect.any(String) });
  expect(client.set.mock.calls[0]).toHaveLength(2);
});
it('repeated OFF never toggles ON, and model writes cannot undo OFF', async () => {
  const { client } = memoryRedis();
  await setBotMode(client, false); await setBotMode(client, false);
  await setCoachModel(client, 'qwen-flash');
  expect((await readBotMode(client)).enabled).toBe(false);
  expect((await readCoachModel(client)).model).toBe('qwen-flash');
  await setBotMode(client, true);
  expect((await readCoachModel(client)).model).toBe('qwen-flash');
});
it.each(['bad', 'null', '{}', '{"enabled":"false"}', 'x'.repeat(1025)])('rejects corrupt mode %s', async raw => {
  const { client, data } = memoryRedis(); data.set('bot-control:development:main:mode', raw);
  await expect(readBotMode(client)).rejects.toThrow();
  expect(await (await BotTurnControl.start(client)).active()).toBe(false);
});
it('rejects unapproved models and restores the deployment default with null', async () => {
  const { client } = memoryRedis();
  await expect(setCoachModel(client, 'arbitrary-model')).rejects.toThrow();
  await setCoachModel(client, 'qwen-max'); await setCoachModel(client, null);
  expect((await readCoachModel(client)).model).toBeNull();
});
it('fails closed on read rejection and rejects unsuccessful writes', async () => {
  const { client } = memoryRedis(); client.get.mockRejectedValue(new Error('offline'));
  expect(await (await BotTurnControl.start(client)).active()).toBe(false);
  client.set.mockResolvedValue(null);
  await expect(setBotMode(client, false)).rejects.toThrow();
});
it('fences old turns across OFF/ON and keeps new turns working', async () => {
  const { client } = memoryRedis(); const old = await BotTurnControl.start(client);
  await setBotMode(client, false); await setBotMode(client, true);
  expect(await old.active()).toBe(false);
  expect(await (await BotTurnControl.start(client)).active()).toBe(true);
});
it('blocks AI and persistence while OFF, but allows the original current input when ON', async () => {
  const { client } = memoryRedis(); const control = await BotTurnControl.start(client);
  const ai = { chat: jest.fn().mockResolvedValue({ reply: 'ok', chatId: 'direct:old' }) };
  await control.guardClient(ai).chat(null, '3', undefined, [{ role: 'assistant', content: 'Pick one' }]);
  expect(ai.chat.mock.calls[0][1]).toBe('3');
  await setBotMode(client, false);
  await expect(control.guardClient(ai).chat(null, 'new')).rejects.toThrow();
  const session = { load: jest.fn(), save: jest.fn(), clear: jest.fn() };
  await expect(control.guardSession(session as unknown as SessionManager).save(makeState())).rejects.toThrow();
  expect(session.save).not.toHaveBeenCalled(); expect(ai.chat).toHaveBeenCalledTimes(1);
});
it('isolates local, production and each preview branch; redeploy SHA is irrelevant', () => {
  const scope = (e: NodeJS.ProcessEnv) => controlScope(e);
  expect(new Set([scope({}), scope({ VERCEL_ENV: 'production' }),
    scope({ VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'a' }),
    scope({ VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'b' })]).size).toBe(4);
  expect(scope({ VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'a', VERCEL_GIT_COMMIT_SHA: '1' }))
    .toBe(scope({ VERCEL_ENV: 'preview', VERCEL_GIT_COMMIT_REF: 'a', VERCEL_GIT_COMMIT_SHA: '2' }));
  expect(() => scope({ VERCEL: '1', VERCEL_ENV: 'preview' })).toThrow();
});
it('applies dashboard models to direct pivot only, preserving the prompt and study default', async () => {
  const { client } = memoryRedis();
  process.env.SCENARIO_MENU = 'true'; process.env.COACH_PROVIDER = 'direct';
  process.env.DYNAMIC_COACH_PROMPT = 'false'; process.env.COACH_MODEL = 'qwen-plus';
  const base = await resolveCoachConfig(client);
  const changed = await resolveCoachConfig(client, { model: 'qwen-flash', updatedAt: null });
  expect(changed.metadata).toMatchObject({ model: 'qwen-flash', modelSource: 'dashboard' });
  expect(changed.systemPrompt).toBe(base.systemPrompt);
  process.env.SCENARIO_MENU = 'false';
  expect((await resolveCoachConfig(client, { model: 'qwen-flash', updatedAt: null })).metadata.model).toBe('qwen-plus');
  process.env.COACH_PROVIDER = 'aibots';
  expect((await resolveCoachConfig(client, { model: 'qwen-flash', updatedAt: null })).metadata.modelSource).toBe('external');
});
