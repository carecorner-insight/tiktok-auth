import { AIBotsClient } from '@/services/aiBotsClient';

const CREATE_URL = 'https://directus.example.com/flows/trigger/create-chat';
const SEND_URL = 'https://directus.example.com/flows/trigger/send-message';

const mockFetch = jest.fn();
const makeClient = () => new AIBotsClient(CREATE_URL, SEND_URL, mockFetch as any);

const mockCreate = (id = 'chat-abc') =>
  ({ ok: true, json: async () => ({ id }) });

const mockSend = (content = 'I hear you.') =>
  ({ ok: true, json: async () => ({ response: { content } }) });

beforeEach(() => jest.clearAllMocks());

describe('AIBotsClient.createChat', () => {
  it('POSTs to createChatUrl and returns the chat id', async () => {
    mockFetch.mockResolvedValue(mockCreate('chat-123'));
    const client = makeClient();
    const id = await client.createChat();
    expect(id).toBe('chat-123');
    expect(mockFetch).toHaveBeenCalledWith(CREATE_URL, expect.objectContaining({ method: 'POST' }));
  });

  it('throws when response is not ok', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500 });
    await expect(makeClient().createChat()).rejects.toThrow('createChat failed: 500');
  });

  it('throws when response has no id', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) });
    await expect(makeClient().createChat()).rejects.toThrow('no id in response');
  });
});

describe('AIBotsClient.sendMessage', () => {
  it('POSTs text and chatId, returns reply content', async () => {
    mockFetch.mockResolvedValue(mockSend('That sounds hard.'));
    const reply = await makeClient().sendMessage('chat-abc', 'I feel sad');
    expect(reply).toBe('That sounds hard.');
    expect(mockFetch).toHaveBeenCalledWith(
      SEND_URL,
      expect.objectContaining({ body: expect.stringContaining('"chat_id":"chat-abc"') }),
    );
  });

  it('accepts flat string response format', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ response: 'Flat reply' }) });
    const reply = await makeClient().sendMessage('chat-abc', 'hi');
    expect(reply).toBe('Flat reply');
  });

  it('throws when response is not ok', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 502 });
    await expect(makeClient().sendMessage('chat-abc', 'hi')).rejects.toThrow('sendMessage failed: 502');
  });

  it('throws on unexpected response format', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({ something: 'else' }) });
    await expect(makeClient().sendMessage('chat-abc', 'hi')).rejects.toThrow('unexpected response format');
  });
});

describe('AIBotsClient.chat', () => {
  it('creates a new chat when chatId is null', async () => {
    mockFetch
      .mockResolvedValueOnce(mockCreate('new-chat'))
      .mockResolvedValueOnce(mockSend('Hello'));

    const result = await makeClient().chat(null, 'hi');
    expect(result.chatId).toBe('new-chat');
    expect(result.reply).toBe('Hello');
    expect(mockFetch).toHaveBeenCalledTimes(2);
  });

  it('reuses existing chatId without creating a new chat', async () => {
    mockFetch.mockResolvedValueOnce(mockSend('Hello'));

    const result = await makeClient().chat('existing-chat', 'hi');
    expect(result.chatId).toBe('existing-chat');
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch).toHaveBeenCalledWith(SEND_URL, expect.anything());
  });

  it('retries with a fresh chat session when sendMessage fails (crash recovery)', async () => {
    mockFetch
      .mockResolvedValueOnce({ ok: false, status: 503 }) // sendMessage fails
      .mockResolvedValueOnce(mockCreate('fresh-chat'))   // createChat on retry
      .mockResolvedValueOnce(mockSend('Recovered'));     // sendMessage succeeds

    const result = await makeClient().chat('stale-chat', 'hi');
    expect(result.chatId).toBe('fresh-chat');
    expect(result.reply).toBe('Recovered');
  });
});
