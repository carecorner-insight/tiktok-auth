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
