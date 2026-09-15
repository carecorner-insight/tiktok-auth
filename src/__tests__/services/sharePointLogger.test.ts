import { SharePointLogger } from '@/services/sharePointLogger';
import { makeState } from '@/__tests__/mocks';

const mockFetch = jest.fn();

const makeService = () =>
  new SharePointLogger('https://power-automate.example.com/webhook', mockFetch as any);

beforeEach(() => jest.clearAllMocks());

describe('SharePointLogger', () => {
  it('posts a log entry to the Power Automate webhook', async () => {
    mockFetch.mockResolvedValue({ ok: true });
    const svc = makeService();
    const state = makeState();

    await svc.log(state, 'user-msg', 'bot-reply');

    expect(mockFetch).toHaveBeenCalledWith(
      'https://power-automate.example.com/webhook',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({ 'Content-Type': 'application/json' }),
        body: expect.stringContaining('user-msg'),
      }),
    );
  });

  it('includes platform, userId, tag in the payload', async () => {
    mockFetch.mockResolvedValue({ ok: true });
    const svc = makeService();
    const state = makeState({ platform: 'tiktok', userId: 'tiktok-user-99', tag: 'high' });

    await svc.log(state, 'help', 'emergency response');

    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body).toMatchObject({
      platform: 'tiktok',
      userId: 'tiktok-user-99',
      tag: 'high',
      userMessage: 'help',
      aiResponse: 'emergency response',
    });
  });

  it('does not throw if the webhook is unreachable', async () => {
    mockFetch.mockRejectedValue(new Error('Network error'));
    const svc = makeService();
    await expect(svc.log(makeState(), 'msg', 'reply')).resolves.not.toThrow();
  });

  it('reuses the persisted session ID across log entries without replacing transport IDs', async () => {
    mockFetch.mockResolvedValue({ ok: true });
    const svc = makeService();
    const state = makeState({ sessionId: '36fce803-c797-45a6-8aa9-f810a5ad395b' });
    await svc.log(state, 'first', 'reply');
    await svc.log(state, 'second', 'reply');
    for (const [, init] of mockFetch.mock.calls) {
      expect(JSON.parse(init.body)).toMatchObject({
        sessionId: state.sessionId,
        conversationId: state.conversationId,
      });
    }
  });

  it('omits sessionId for legacy or error-path states instead of inventing a per-log ID', async () => {
    mockFetch.mockResolvedValue({ ok: true });
    await makeService().log(makeState(), 'message', 'reply');
    expect(JSON.parse(mockFetch.mock.calls[0][1].body)).not.toHaveProperty('sessionId');
  });

  it('does not throw if the webhook returns a non-ok response', async () => {
    mockFetch.mockResolvedValue({ ok: false, status: 500 });
    const svc = makeService();
    await expect(svc.log(makeState(), 'msg', 'reply')).resolves.not.toThrow();
  });
});
