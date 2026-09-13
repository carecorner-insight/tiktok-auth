import type { IPlatformAdapter, NormalizedMessage } from '../types/platform';

type FetchFn = (url: string, init: RequestInit) => Promise<{ ok: boolean; status?: number; json(): Promise<unknown> }>;

interface BoldEntity { type: 'bold'; offset: number; length: number }

/** Only balanced, standalone *bold* / **bold**. No HTML/Markdown parser.
 * Telegram entity offsets and JavaScript string lengths both use UTF-16 units.
 */
function formatBold(raw: string): { text: string; entities: BoldEntity[] } {
  const entities: BoldEntity[] = [];
  let text = ''; let cursor = 0;
  const pattern = /(?<!\*)(\*\*|\*)(?!\*)(\S(?:[^*\n]*?\S)?)\1(?!\*)/g;
  for (const match of raw.matchAll(pattern)) {
    const start = match.index!;
    const end = start + match[0].length;
    // Do not reinterpret arithmetic, URL path segments, or partial words.
    if (start > 0 && !/[\s([{“"']/.test(raw[start - 1])) continue;
    if (end < raw.length && !/[\s.,!?;:)\]}”"']/.test(raw[end])) continue;
    text += raw.slice(cursor, start);
    entities.push({ type: 'bold', offset: text.length, length: match[2].length });
    text += match[2];
    cursor = end;
  }
  return { text: text + raw.slice(cursor), entities };
}

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
    const formatted = formatBold(text);
    const send = (entities?: BoldEntity[]) => this.fetch(`${this.apiBase}/sendMessage`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: userId, text: formatted.text, ...(entities?.length ? { entities } : {}) }),
    });
    let response = await send(formatted.entities);
    if (!response.ok && response.status === 400 && formatted.entities.length) {
      const error = await response.json().catch(() => null) as { description?: unknown } | null;
      if (typeof error?.description === 'string' && /can't parse entities/i.test(error.description)) {
        // Explicit rejection means it was not delivered. Never retry an
        // ambiguous network failure or another API error at this layer.
        response = await send();
      }
    }
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
