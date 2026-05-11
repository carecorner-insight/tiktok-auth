import type { Message } from '@/types/state';

type FetchFn = (url: string, init: RequestInit) => Promise<{ ok: boolean; status?: number; json(): Promise<unknown> }>;

const MAX_RETRIES = 2;

export class AIBotsClient {
  constructor(
    private readonly directusUrl: string,
    private readonly directusToken: string,
    private readonly fetch: FetchFn = globalThis.fetch,
  ) {}

  async chat(messages: Message[]): Promise<string> {
    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      const response = await this.fetch(
        `${this.directusUrl}/flows/trigger/careybot`,
        {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${this.directusToken}`,
          },
          body: JSON.stringify({ messages }),
        },
      );

      if (!response.ok) {
        throw new Error(`Directus error: ${response.status}`);
      }

      const data = (await response.json()) as { reply?: string };
      if (data.reply) {
        return data.reply;
      }
      // Empty reply = AIBots crash — retry with same history
    }

    throw new Error('AIBots: max retries exceeded');
  }
}
