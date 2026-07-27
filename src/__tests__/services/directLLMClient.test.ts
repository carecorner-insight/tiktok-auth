import { DirectLLMClient } from '@/services/directLLMClient';

const OPTS = { apiKey: 'k', baseURL: 'http://x', model: 'qwen-plus', systemPrompt: 'SYSTEM_PROMPT' };

function mockClient(reply: string | null) {
  const create = jest.fn().mockResolvedValue({ choices: [{ message: { content: reply } }] });
  return { client: { chat: { completions: { create } } }, create };
}

describe('DirectLLMClient', () => {
  it('sends system prompt + history + user text and returns the reply', async () => {
    const { client, create } = mockClient('hello there');
    const c = new DirectLLMClient(OPTS, client as any);
    const res = await c.chat(null, 'hi', undefined, [
      { role: 'user', content: 'earlier' },
      { role: 'assistant', content: 'prev reply' },
    ]);

    expect(res.reply).toBe('hello there');
    expect(typeof res.chatId).toBe('string');

    const body = create.mock.calls[0][0];
    expect(body.model).toBe('qwen-plus');
    expect(body.messages[0]).toEqual({ role: 'system', content: 'SYSTEM_PROMPT' });
    expect(body.messages[1]).toEqual({ role: 'user', content: 'earlier' });
    expect(body.messages[2]).toEqual({ role: 'assistant', content: 'prev reply' });
    expect(body.messages[3]).toEqual({ role: 'user', content: 'hi' });
  });

  it('appends the prime to the system message when provided', async () => {
    const { client, create } = mockClient('ok');
    const c = new DirectLLMClient(OPTS, client as any);
    await c.chat(null, 'hi', 'ENTER STATE 4');
    const sys = create.mock.calls[0][0].messages[0].content;
    expect(sys).toContain('SYSTEM_PROMPT');
    expect(sys).toContain('ENTER STATE 4');
  });

  it('preserves an existing chatId (marker only)', async () => {
    const { client } = mockClient('ok');
    const c = new DirectLLMClient(OPTS, client as any);
    const res = await c.chat('existing-id', 'hi');
    expect(res.chatId).toBe('existing-id');
  });

  it('returns an empty string when the model gives no content', async () => {
    const { client } = mockClient(null);
    const c = new DirectLLMClient(OPTS, client as any);
    const res = await c.chat(null, 'hi');
    expect(res.reply).toBe('');
  });
});
