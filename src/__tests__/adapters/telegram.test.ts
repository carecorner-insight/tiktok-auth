import { TelegramAdapter } from '@/adapters/telegram';

const BOT_TOKEN = 'test-bot-token';
const mockFetch = jest.fn();
const makeAdapter = () => new TelegramAdapter(BOT_TOKEN, mockFetch as any);

beforeEach(() => jest.clearAllMocks());

// Minimal Telegram update payload for a text message
const makeTelegramUpdate = (text: string, userId = 123456) => ({
  update_id: 1,
  message: {
    message_id: 1,
    from: { id: userId, is_bot: false, first_name: 'Test' },
    chat: { id: userId, type: 'private' },
    date: 1700000000,
    text,
  },
});

describe('TelegramAdapter.normalizeMessage', () => {
  it('extracts userId, text and platform from a Telegram update', () => {
    const adapter = makeAdapter();
    const result = adapter.normalizeMessage(makeTelegramUpdate('hello', 999));
    expect(result).toMatchObject({
      platform: 'telegram',
      userId: '999',
      text: 'hello',
    });
    expect(result.timestamp).toBeGreaterThan(0);
  });

  it('throws on a payload with no message field', () => {
    const adapter = makeAdapter();
    expect(() => adapter.normalizeMessage({ update_id: 1 })).toThrow();
  });

  it('throws on a non-text message (e.g. sticker)', () => {
    const adapter = makeAdapter();
    const stickerUpdate = {
      update_id: 1,
      message: {
        message_id: 1,
        from: { id: 1, is_bot: false, first_name: 'T' },
        chat: { id: 1, type: 'private' },
        date: 1700000000,
        sticker: {},
      },
    };
    expect(() => adapter.normalizeMessage(stickerUpdate)).toThrow();
  });
});

describe('TelegramAdapter.sendMessage', () => {
  it('POSTs to the Telegram sendMessage endpoint with correct payload', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) });
    const adapter = makeAdapter();
    await adapter.sendMessage('999', 'Hello there');

    expect(mockFetch).toHaveBeenCalledWith(
      `https://api.telegram.org/bot${BOT_TOKEN}/sendMessage`,
      expect.objectContaining({
        method: 'POST',
        body: expect.stringContaining('"chat_id":"999"'),
      }),
    );
    expect(mockFetch).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        body: expect.stringContaining('"text":"Hello there"'),
      }),
    );
  });

  it('throws when Telegram API returns a non-ok response', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 400, json: async () => ({ description: 'Bad Request' }) });
    const adapter = makeAdapter();
    await expect(adapter.sendMessage('999', 'hi')).rejects.toThrow();
  });
});

describe('TelegramAdapter.sendTypingIndicator', () => {
  it('sends a sendChatAction typing action', async () => {
    mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) });
    const adapter = makeAdapter();
    await adapter.sendTypingIndicator('999');

    expect(mockFetch).toHaveBeenCalledWith(
      `https://api.telegram.org/bot${BOT_TOKEN}/sendChatAction`,
      expect.objectContaining({
        body: expect.stringContaining('"action":"typing"'),
      }),
    );
  });
});

describe('TelegramAdapter safe bold', () => {
  const payload = (n = 0) => JSON.parse(mockFetch.mock.calls[n][1].body);
  beforeEach(() => mockFetch.mockResolvedValue({ ok: true, json: async () => ({}) }));

  it('renders both bold marker styles without enabling a markup parser', async () => {
    await makeAdapter().sendMessage('999', 'A *bold* choice and **another**.');
    expect(payload()).toEqual({ chat_id: '999', text: 'A bold choice and another.', entities: [
      { type: 'bold', offset: 2, length: 4 }, { type: 'bold', offset: 18, length: 7 },
    ] });
    expect(payload().parse_mode).toBeUndefined();
  });

  it('uses UTF-16 offsets for emoji before and inside emphasis', async () => {
    await makeAdapter().sendMessage('999', '🙂 **Go 💪** then *yes*.');
    expect(payload()).toMatchObject({ text: '🙂 Go 💪 then yes.', entities: [
      { type: 'bold', offset: 3, length: 5 }, { type: 'bold', offset: 14, length: 3 },
    ] });
  });

  it.each(['Unmatched **bold', '2 * 3 * 4', '2*3*4', '***nested***',
    'https://example.com/*path*/x?a=1&b=2', '<b>literal</b> & <script>text</script>',
    'A * spaced * phrase', 'word*middle*word', '***'])('preserves unsupported/literal text: %s', async text => {
    await makeAdapter().sendMessage('999', text);
    expect(payload()).toEqual({ chat_id: '999', text });
  });

  it('preserves HTML-looking content and links alongside supported bold', async () => {
    const text = '<b>literal</b> & https://example.com/?a=1&b=2 **safe**';
    await makeAdapter().sendMessage('999', text);
    expect(payload().text).toBe(text.replace('**safe**', 'safe'));
    expect(payload().entities).toEqual([{ type: 'bold', offset: text.indexOf('**safe**'), length: 4 }]);
    expect(payload().parse_mode).toBeUndefined();
  });

  it('retries plain text only after an explicit entity rejection', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 400,
      json: async () => ({ description: "Bad Request: can't parse entities" }) });
    await makeAdapter().sendMessage('999', '**Hello**');
    expect(mockFetch).toHaveBeenCalledTimes(2);
    expect(payload(1)).toEqual({ chat_id: '999', text: 'Hello' });
  });

  it.each([400, 401, 429, 500])('does not retry unrelated API rejection %s', async status => {
    mockFetch.mockResolvedValue({ ok: false, status, json: async () => ({ description: 'Other error' }) });
    await expect(makeAdapter().sendMessage('999', '**Hello**')).rejects.toThrow();
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it('does not retry an ambiguous transport failure', async () => {
    mockFetch.mockRejectedValue(new Error('socket closed'));
    await expect(makeAdapter().sendMessage('999', '**Hello**')).rejects.toThrow('socket closed');
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });
});
