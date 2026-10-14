import { handleMessage } from '../../../api/webhook';
import { getControlRedis } from '../../lib/redis';
import { processMessage } from '../../graph/runner';
import { SessionManager } from '../../services/sessionManager';
import { memoryRedis } from '../mocks/controlRedis';
import { makeState, makeNormalizedMessage } from '../mocks';
import { MAINTENANCE_NOTICE, setBotMode } from '../../lib/botControl';
import type { IPlatformAdapter } from '../../types/platform';

jest.mock('../../lib/redis', () => ({ getControlRedis: jest.fn() }));
jest.mock('../../graph/runner', () => ({ processMessage: jest.fn() }));
jest.mock('../../services/sessionManager', () => ({ SessionManager: jest.fn() }));
jest.mock('../../services/makeCareyAIClient', () => ({ makeCareyAIClient: jest.fn(() => ({ chat: jest.fn() })) }));
jest.mock('../../services/makeSocialCoachClient', () => ({ makeSocialCoachClient: jest.fn(() => ({ chat: jest.fn() })) }));
jest.mock('../../services/directLLMClient', () => ({ DirectLLMClient: jest.fn(() => ({ chat: jest.fn() })) }));

/** Hold an external operation until the test explicitly releases it. */
function deferred() {
  let resolve!: () => void;
  const promise = new Promise<void>(done => { resolve = done; });
  return { promise, resolve };
}

const originalEnv = { ...process.env };
let store: ReturnType<typeof memoryRedis>;
let adapter: IPlatformAdapter;
let fetch: jest.SpyInstance;
const lockKey = 'lock:telegram:user-123';

beforeEach(() => {
  jest.clearAllMocks();
  store = memoryRedis();
  (getControlRedis as jest.Mock).mockReturnValue(store.client);
  (SessionManager as jest.Mock).mockImplementation(() => ({ load: async () => makeState(), save: async () => {}, clear: async () => {} }));
  delete process.env.VERCEL;
  delete process.env.VERCEL_ENV;
  delete process.env.POWER_AUTOMATE_WEBHOOK_URL;
  delete process.env.DEMOGRAPHICS_WEBHOOK_URL;
  process.env.KPI_COLLECTION_ENABLED = 'false';
  process.env.SCENARIO_MENU = 'true';
  process.env.COACH_PROVIDER = 'direct';
  process.env.DYNAMIC_COACH_PROMPT = 'false';
  adapter = {
    platform: 'telegram',
    normalizeMessage: body => makeNormalizedMessage(body as Parameters<typeof makeNormalizedMessage>[0]),
    sendMessage: jest.fn(async () => {}), sendTypingIndicator: jest.fn(async () => {}),
  };
  (processMessage as jest.Mock).mockImplementation(async msg => ({ response: `Reply to ${msg.text}`, state: makeState() }));
  fetch = jest.spyOn(globalThis, 'fetch').mockResolvedValue(new Response('{}', { status: 200 }));
});

afterEach(() => {
  fetch.mockRestore();
  jest.useRealTimers();
  process.env = { ...originalEnv };
});

const turn = (text: string, messageId = text) => handleMessage(adapter, { text, messageId }, store.client, { menuMode: 'numbered' });

it.each(['success', 'model failure', 'demographics'] as const)('accepts the next reply while %s logging is still waiting', async kind => {
  const loggingStarted = deferred();
  const finishLogging = deferred();
  if (kind === 'demographics') {
    process.env.DEMOGRAPHICS_WEBHOOK_URL = 'https://synthetic.invalid/demographics';
    (processMessage as jest.Mock).mockResolvedValue({ response: 'Reply', state: makeState({ age: 20 }) });
  } else {
    process.env.POWER_AUTOMATE_WEBHOOK_URL = 'https://synthetic.invalid/log';
    if (kind === 'model failure') (processMessage as jest.Mock).mockRejectedValueOnce(new Error('Synthetic provider failure'));
  }
  fetch.mockImplementationOnce(async () => {
    loggingStarted.resolve();
    await finishLogging.promise;
    return new Response('{}', { status: 200 });
  });

  const first = turn('1');
  await loggingStarted.promise;
  try {
    expect(adapter.sendMessage).toHaveBeenCalledTimes(1);
    expect(store.data.has(lockKey)).toBe(false);
    await turn('yeah');
    expect(processMessage).toHaveBeenCalledTimes(2);
    expect(adapter.sendMessage).toHaveBeenCalledTimes(2);
  } finally {
    finishLogging.resolve();
    await first;
  }
});

it.each(['yeah', '/restart'])('waits for an active turn and then processes %s', async text => {
  jest.useFakeTimers();
  await store.client.set(lockKey, 'earlier-request');
  const request = turn(text);
  // The previous turn takes longer than the old two-second drop window.
  await jest.advanceTimersByTimeAsync(2500);
  expect(processMessage).not.toHaveBeenCalled();
  await store.client.del(lockKey);
  await jest.advanceTimersByTimeAsync(500);
  await request;
  expect(processMessage).toHaveBeenCalledTimes(1);
  expect(adapter.sendMessage).toHaveBeenCalledWith('user-123', `Reply to ${text}`, undefined);
});

it('gives a retry notice when busy, then accepts the unprocessed update when retried', async () => {
  jest.useFakeTimers();
  await store.client.set(lockKey, 'earlier-request');
  const request = turn('yeah', 'retryable-update');
  await jest.advanceTimersByTimeAsync(10_500);
  await request;
  expect(processMessage).not.toHaveBeenCalled();
  expect(adapter.sendMessage).toHaveBeenCalledWith('user-123', expect.stringContaining('send this message again'), undefined);
  expect(store.data.has('dedup:telegram:retryable-update')).toBe(false);
  expect(store.data.get(lockKey)).toBe('earlier-request');

  await store.client.del(lockKey);
  await turn('yeah', 'retryable-update');
  await turn('yeah', 'retryable-update');
  expect(processMessage).toHaveBeenCalledTimes(1);
  expect(adapter.sendMessage).toHaveBeenCalledTimes(2);
});

it('honours OFF while a reply is waiting for the conversation lock', async () => {
  jest.useFakeTimers();
  await store.client.set(lockKey, 'earlier-request');
  const request = turn('/restart');
  await jest.advanceTimersByTimeAsync(500);
  await setBotMode(store.client, false);
  await store.client.del(lockKey);
  await jest.advanceTimersByTimeAsync(500);
  await request;
  expect(processMessage).not.toHaveBeenCalled();
  expect(adapter.sendMessage).toHaveBeenCalledWith('user-123', MAINTENANCE_NOTICE, undefined);
});

it('does not release a replacement lock owned by another request', async () => {
  (processMessage as jest.Mock).mockImplementationOnce(async () => {
    await store.client.set(lockKey, 'replacement-owner');
    return { response: 'Reply', state: makeState() };
  });
  await turn('yeah');
  expect(store.data.get(lockKey)).toBe('replacement-owner');
});

it('keeps simultaneous duplicate updates from producing two replies', async () => {
  const graphStarted = deferred();
  const finishGraph = deferred();
  (processMessage as jest.Mock).mockImplementationOnce(async () => {
    graphStarted.resolve();
    await finishGraph.promise;
    return { response: 'Reply', state: makeState() };
  });
  const first = turn('yeah', 'same-update');
  await graphStarted.promise;
  await turn('yeah', 'same-update');
  finishGraph.resolve();
  await first;
  expect(processMessage).toHaveBeenCalledTimes(1);
  expect(adapter.sendMessage).toHaveBeenCalledTimes(1);
});
