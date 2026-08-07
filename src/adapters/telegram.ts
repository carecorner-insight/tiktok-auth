import type { IPlatformAdapter, NormalizedMessage } from '../types/platform';

type FetchFn = (url: string, init: RequestInit) => Promise<{ ok: boolean; status?: number; json(): Promise<unknown> }>;

export class TelegramAdapter implements IPlatformAdapter {
  readonly platform = 'telegram' as const;

  constructor(
    private readonly botToken: string,
    private readonly fetch: FetchFn = globalThis.fetch,
  ) {}

  private get apiBase(): string {
    return `https://api.telegram.org/bot${this.botToken}`;
  }

  normalizeMessage(raw: unknown): NormalizedMessage {
    const update = raw as Record<string, unknown>;
    const message = update['message'] as Record<string, unknown> | undefined;

    if (!message) throw new Error('TelegramAdapter: no message field in update');
    if (typeof message['text'] !== 'string') throw new Error('TelegramAdapter: non-text message type not supported');

    const from = message['from'] as Record<string, unknown>;
    // Username only — first_name / last_name are deliberately NOT captured, to
    // keep the personal-data footprint on the permanent log to a minimum.
    const username = typeof from['username'] === 'string' ? from['username'] : undefined;
    return {
      platform: 'telegram',
      userId: String(from['id']),
      messageId: String(update['update_id'] ?? ''),
      text: message['text'],
      timestamp: (message['date'] as number) * 1000,
      username,
      raw,
    };
  }

  async sendMessage(userId: string, text: string): Promise<void> {
    const response = await this.fetch(`${this.apiBase}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: userId, text }),
    });

    if (!response.ok) {
      throw new Error(`TelegramAdapter.sendMessage failed: ${response.status}`);
    }
  }

  async sendTypingIndicator(userId: string): Promise<void> {
    await this.fetch(`${this.apiBase}/sendChatAction`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: userId, action: 'typing' }),
    });
  }
}
