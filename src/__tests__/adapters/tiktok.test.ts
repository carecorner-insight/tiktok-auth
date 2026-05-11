import { TikTokAdapter } from '@/adapters/tiktok';

const mockFetch = jest.fn();
const mockGetToken = jest.fn().mockResolvedValue('tiktok-access-token');
const makeAdapter = () => new TikTokAdapter(mockGetToken, mockFetch as any);

beforeEach(() => jest.clearAllMocks());

const makeTikTokWebhook = (textBody = 'hello', overrides: Record<string, unknown> = {}) => ({
  event: 'im_receive_msg',
  user_openid: 'tiktok-user-abc',
  content: JSON.stringify({
    message_id: 'msg-1',
    conversation_id: 'conv-1',
    type: 'text',
    text: { body: textBody },
    from_user: { role: 'user' },
  }),
  ...overrides,
});

describe('TikTokAdapter.normalizeMessage', () => {
  it('extracts userId, conversationId, text and platform', () => {
    const adapter = makeAdapter();
    const result = adapter.normalizeMessage(makeTikTokWebhook('hi there'));
    expect(result).toMatchObject({
      platform: 'tiktok',
      userId: 'tiktok-user-abc',
      conversationId: 'conv-1',
      text: 'hi there',
    });
  });

  it('throws when event is not im_receive_msg', () => {
    const adapter = makeAdapter();
    expect(() =>
      adapter.normalizeMessage({ event: 'other_event', user_openid: 'x', content: '{}' }),
    ).toThrow();
  });

  it('throws when message type is not text', () => {
    const adapter = makeAdapter();
    const payload = makeTikTokWebhook();
    payload.content = JSON.stringify({
      message_id: 'msg-1',
      conversation_id: 'conv-1',
      type: 'image',
      from_user: { role: 'user' },
    });
    expect(() => adapter.normalizeMessage(payload)).toThrow();
  });

  it('ignores messages sent by the bot itself', () => {
    const adapter = makeAdapter();
    const payload = makeTikTokWebhook('bot reply');
    payload.content = JSON.stringify({
      message_id: 'msg-1',
      conversation_id: 'conv-1',
      type: 'text',
      text: { body: 'bot reply' },
      from_user: { role: 'business_account' },
    });
    expect(() => adapter.normalizeMessage(payload)).toThrow('bot message');
  });
});

describe('TikTokAdapter.sendMessage', () => {
  it('fetches the access token and POSTs to TikTok API', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ code: 0, message: 'OK' }),
    });
    const adapter = makeAdapter();
    await adapter.sendMessage('tiktok-user-abc', 'Hello!', 'conv-1');

    expect(mockGetToken).toHaveBeenCalled();
    expect(mockFetch).toHaveBeenCalledWith(
      'https://business-api.tiktok.com/open_api/v1.3/business/message/send/',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'Access-Token': 'tiktok-access-token' }),
        body: expect.stringContaining('conv-1'),
      }),
    );
  });

  it('throws when TikTok API returns a non-zero code', async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: async () => ({ code: 400, message: 'Invalid token' }),
    });
    const adapter = makeAdapter();
    await expect(adapter.sendMessage('user', 'hi', 'conv-1')).rejects.toThrow('TikTok API Error');
  });

  it('throws when conversationId is missing', async () => {
    const adapter = makeAdapter();
    await expect(adapter.sendMessage('user', 'hi')).rejects.toThrow('conversationId');
  });
});

describe('TikTokAdapter.sendTypingIndicator', () => {
  it('resolves without throwing (TikTok has no typing indicator API)', async () => {
    const adapter = makeAdapter();
    await expect(adapter.sendTypingIndicator('user-abc')).resolves.not.toThrow();
  });
});
