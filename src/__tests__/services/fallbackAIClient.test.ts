import { FallbackAIClient } from '@/services/fallbackAIClient';
import { AIBotsClient } from '@/services/aiBotsClient';
import { DifyClient } from '@/services/difyClient';

const history = [{ role: 'assistant' as const, content: 'Which approach fits you?' }];
const primary = () => ({ chat: jest.fn().mockResolvedValue({ reply: 'ok', chatId: 'p1' }) });
const fallback = () => ({ chat: jest.fn().mockResolvedValue({ reply: 'ok', chatId: 'f1' }) });

it('preserves prime AND supplied history on an initial handoff', async () => {
  const p = primary();
  await new FallbackAIClient(p, fallback()).chat(null, '3', 'Continue this handoff', history);
  expect(p.chat).toHaveBeenCalledWith(null, '3', 'Continue this handoff', history);
});

it('preserves both on failover to a new Dify session', async () => {
  const p = primary(); const f = fallback();
  p.chat.mockRejectedValue(new Error('offline'));
  expect(await new FallbackAIClient(p, f).chat(null, '3', 'Continue this handoff', history))
    .toEqual({ reply: 'ok', chatId: 'dify:f1' });
  expect(f.chat).toHaveBeenCalledWith(null, '3', 'Continue this handoff', history);
});

it('retains the existing provider ID for normal continuation', async () => {
  const p = primary(); const f = fallback();
  await new FallbackAIClient(p, f).chat('aibots:old', '3', undefined, history);
  expect(p.chat).toHaveBeenCalledWith('old', '3', undefined, history);
  expect(f.chat).not.toHaveBeenCalled();
});

it('supplies recovery context when primary recovers from a Dify session', async () => {
  const p = primary(); const f = fallback();
  await new FallbackAIClient(p, f).chat('dify:old', '3', undefined, history);
  expect(p.chat).toHaveBeenCalledWith(null, '3', expect.stringContaining('resuming'), history);
  expect(f.chat).not.toHaveBeenCalled();
});

it('continues the existing Dify conversation if primary is still down', async () => {
  const p = primary(); const f = fallback();
  p.chat.mockRejectedValue(new Error('offline'));
  await new FallbackAIClient(p, f).chat('dify:old', '3', undefined, history);
  expect(f.chat).toHaveBeenCalledWith('old', '3', undefined, history);
});

it('the real AIBots client primes with history and sends the latest answer once', async () => {
  const fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ response: 'ok' }) });
  fetch.mockResolvedValueOnce({ ok: true, json: async () => ({ id: 'p1' }) });
  const p = new AIBotsClient('https://example.invalid/create', 'https://example.invalid/send', fetch);
  await new FallbackAIClient(p, fallback()).chat(null, '3', 'Continue this handoff', history);
  const contents = fetch.mock.calls.map(([, request]) => JSON.parse(request.body).content).filter(Boolean);
  expect(contents).toEqual([expect.stringContaining('Which approach fits you?'), '3']);
});

it('the real Dify client replays history only on a new server conversation', async () => {
  const fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ answer: 'ok', conversation_id: 'f1' }) });
  const client = new DifyClient('https://example.invalid', 'synthetic', fetch);
  await client.chat(null, '3', 'Continue this handoff', history);
  await client.chat('f1', 'yes', undefined, history);
  const queries = fetch.mock.calls.map(([, request]) => JSON.parse(request.body).query);
  expect(queries).toEqual([expect.stringContaining('Which approach fits you?'), '3', 'yes']);
});
