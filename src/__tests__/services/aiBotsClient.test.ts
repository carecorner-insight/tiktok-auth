import { AIBotsClient } from '@/services/aiBotsClient';
import type { Message } from '@/types/state';

const DIRECTUS_URL = 'https://directus.example.com';
const DIRECTUS_TOKEN = 'test-token';

const mockFetch = jest.fn();
const makeClient = () => new AIBotsClient(DIRECTUS_URL, DIRECTUS_TOKEN, mockFetch as any);

const messages: Message[] = [
  { role: 'user', content: 'I feel sad', timestamp: 1000 },
];

beforeEach(() => jest.clearAllMocks());

describe('AIBotsClient.chat', () => {
  it('sends conversation history to Directus and returns the AI response', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ reply: 'I hear you.' }),
    });

    const client = makeClient();
    const reply = await client.chat(messages);

    expect(reply).toBe('I hear you.');
    expect(mockFetch).toHaveBeenCalledWith(
      `${DIRECTUS_URL}/flows/trigger/careybot`,
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Authorization: `Bearer ${DIRECTUS_TOKEN}`,
        }),
        body: expect.stringContaining('I feel sad'),
      }),
    );
  });

  it('retries once with full history on empty reply (AIBots crash recovery)', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: true, json: async () => ({ reply: '' }) })
      .mockResolvedValueOnce({ ok: true, json: async () => ({ reply: 'Recovered reply' }) });

    const client = makeClient();
    const reply = await client.chat(messages);

    expect(reply).toBe('Recovered reply');
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('throws after max retries are exceeded', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ reply: '' }) });

    const client = makeClient();
    await expect(client.chat(messages)).rejects.toThrow('AIBots: max retries exceeded');
  });

  it('throws when Directus returns a non-ok HTTP response', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 502 });

    const client = makeClient();
    await expect(client.chat(messages)).rejects.toThrow('Directus error: 502');
  });
});
