import type { IPlatformAdapter, NormalizedMessage } from '../types/platform';

type FetchFn = (url: string, init: RequestInit) => Promise<{ ok: boolean; json(): Promise<unknown> }>;
type GetTokenFn = () => Promise<string>;

const SEND_URL = 'https://business-api.tiktok.com/open_api/v1.3/business/message/send/';

export class TikTokAdapter implements IPlatformAdapter {
  readonly platform = 'tiktok' as const;

  constructor(
    private readonly getAccessToken: GetTokenFn,
    private readonly fetch: FetchFn = globalThis.fetch,
  ) {}

  normalizeMessage(raw: unknown): NormalizedMessage {
    const body = raw as Record<string, unknown>;

    if (body['event'] !== 'im_receive_msg') {
      throw new Error(`TikTokAdapter: unexpected event type "${body['event']}"`);
    }

    let content: Record<string, unknown> = {};
    try {
      content = JSON.parse(body['content'] as string);
    } catch {
      throw new Error('TikTokAdapter: failed to parse content JSON');
    }

    const fromUser = content['from_user'] as Record<string, unknown> | undefined;
    if (fromUser?.['role'] === 'business_account') {
      throw new Error('TikTokAdapter: bot message — skip processing');
    }

    if (content['type'] !== 'text') {
      throw new Error(`TikTokAdapter: non-text message type "${content['type']}" not supported`);
    }

    const textObj = content['text'] as Record<string, unknown>;
    return {
      platform: 'tiktok',
      userId: body['user_openid'] as string,
      conversationId: content['conversation_id'] as string,
      messageId: content['message_id'] as string | undefined,
      text: textObj['body'] as string,
      timestamp: Date.now(),
      raw,
    };
  }

  async sendMessage(userId: string, text: string, conversationId?: string): Promise<void> {
    if (!conversationId) {
      throw new Error('TikTokAdapter.sendMessage: conversationId is required for TikTok');
    }

    const token = await this.getAccessToken();
    const response = await this.fetch(SEND_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Access-Token': token,
      },
      body: JSON.stringify({
        business_id: userId,
        recipient_type: 'CONVERSATION',
        recipient: conversationId,
        message_type: 'TEXT',
        text: { body: text },
      }),
    });

    const data = (await response.json()) as { code: number; message: string };
    if (data.code !== 0) {
      throw new Error(`TikTok API Error: ${data.message}`);
    }
  }

  // TikTok Business API has no typing indicator — resolves silently
  async sendTypingIndicator(_userId: string): Promise<void> {}
}
