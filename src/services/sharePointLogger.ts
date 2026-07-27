import type { CareyBotState } from '../types/state';
import { redactPII } from '../lib/pii';

type FetchFn = (url: string, init: RequestInit) => Promise<{ ok: boolean }>;

// Derives which AI provider answered from the prefixed chat id set by
// FallbackAIClient ("aibots:" / "dify:"). Returns 'none' when no AI has
// been engaged yet (e.g. questionnaire / age-check turns).
function providerFromChatId(chatId: string | null): 'aibots' | 'dify' | 'none' {
  if (chatId?.startsWith('aibots:')) return 'aibots';
  if (chatId?.startsWith('dify:'))   return 'dify';
  return 'none';
}

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
      questionIndex: state.questionIndex,
      answers: state.answers,
      aiProvider: providerFromChatId(state.aiBotChatId),
      userMessage: redactPII(userMessage),
      aiResponse: redactPII(aiResponse),
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
