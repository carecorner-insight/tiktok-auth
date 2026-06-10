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

describe('AIBotsClient.chat — session priming', () => {
  it('sends primeMessage before user message when chatId is null', async () => {
    mockFetch
      .mockResolvedValueOnce(mockCreate('new-chat'))   // createChat
      .mockResolvedValueOnce(mockSend('OK noted'))     // primeMessage reply (discarded)
      .mockResolvedValueOnce(mockSend('Real reply'));  // actual user message

    const result = await makeClient().chat(null, 'hello', 'You are primed.');
    expect(result.reply).toBe('Real reply');
    expect(result.chatId).toBe('new-chat');
    // createChat + primeMessage + userMessage = 3 fetch calls
    expect(mockFetch).toHaveBeenCalledTimes(3);
  });

  it('sends primeMessage body to SEND_URL as the first message', async () => {
    mockFetch
      .mockResolvedValueOnce(mockCreate('chat-xyz'))
      .mockResolvedValueOnce(mockSend('OK'))
      .mockResolvedValueOnce(mockSend('Hi'));

    await makeClient().chat(null, 'hello', 'PRIME_TEXT');

    const primeFetchCall = mockFetch.mock.calls[1]; // 0=createChat, 1=primeMessage
    expect(primeFetchCall[0]).toBe(SEND_URL);
    expect(primeFetchCall[1].body).toContain('PRIME_TEXT');
  });

  it('does NOT send primeMessage when chatId already exists', async () => {
    mockFetch.mockResolvedValueOnce(mockSend('Reply'));

    await makeClient().chat('existing-id', 'hello', 'PRIME_TEXT');

    // Only 1 call: the user message — no createChat, no prime
    expect(mockFetch).toHaveBeenCalledTimes(1);
    expect(mockFetch.mock.calls[0][1].body).toContain('hello');
  });

  it('re-primes on retry when a primeMessage was provided', async () => {
    mockFetch
      .mockResolvedValueOnce(mockCreate('chat-1'))      // createChat (new session)
      .mockResolvedValueOnce(mockSend('OK'))             // primeMessage
      .mockResolvedValueOnce({ ok: false, status: 503 }) // first sendMessage fails
      .mockResolvedValueOnce(mockCreate('chat-2'))       // createChat (retry)
      .mockResolvedValueOnce(mockSend('OK again'))       // re-prime on retry
      .mockResolvedValueOnce(mockSend('Recovered'));     // retry sendMessage

    const result = await makeClient().chat(null, 'hi', 'PRIME');
    expect(result.reply).toBe('Recovered');
    expect(result.chatId).toBe('chat-2');
    expect(mockFetch).toHaveBeenCalledTimes(6);
  });
});
