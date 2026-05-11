import type { CareyBotState } from '@/types/state';

type FetchFn = (url: string, init: RequestInit) => Promise<{ ok: boolean }>;

export class SharePointLogger {
  constructor(
    private readonly webhookUrl: string,
    private readonly fetch: FetchFn = globalThis.fetch,
  ) {}

  async log(
    state: CareyBotState,
    userMessage: string,
    aiResponse: string,
  ): Promise<void> {
    const payload = {
      platform: state.platform,
      userId: state.userId,
      conversationId: state.conversationId,
      tag: state.tag,
      conversationPhase: state.conversationPhase,
      userMessage,
      aiResponse,
      timestamp: new Date().toISOString(),
    };

    try {
      await this.fetch(this.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
    } catch {
      // Fire-and-forget: logging must never block or crash the message flow
    }
  }
}
