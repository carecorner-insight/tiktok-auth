import type { CareyBotState } from '../types/state';
import { redactPII } from '../lib/pii';

type FetchFn = (url: string, init: RequestInit) => Promise<{ ok: boolean; status?: number }>;

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
    username?: string,
  ): Promise<void> {
    const payload = {
      platform: state.platform,
      userId: state.userId,
      // Telegram @handle when available; '' otherwise. Kept as a stable field so
      // the Power Automate column mapping never breaks (F4).
      username: username ?? '',
      conversationId: state.conversationId,
      sessionId: state.sessionId,
      tag: state.tag,
      // Explicit safety flag the daily staff-report flow filters on. Do NOT
      // infer this from conversationPhase — with the screener disabled, `tag`
      // is never set, so this is the only reliable crisis signal.
      crisisDetected: state.crisisDetected === true,
      // Which detector first raised the flag (phrase | classifier | coach), so
      // staff can see why a conversation was flagged. null when none.
      crisisSource: state.crisisSource ?? null,
      conversationPhase: state.conversationPhase,
      questionIndex: state.questionIndex,
      answers: state.answers,
      aiProvider: providerFromChatId(state.aiBotChatId),
      userMessage: redactPII(userMessage),
      aiResponse: redactPII(aiResponse),
      timestamp: new Date().toISOString(),
    };

    try {
      const response = await this.fetch(this.webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(8000),
      });
      if (!response.ok) console.error('[conversation-log] receiver rejected the request:', response.status);
    } catch {
      // The caller awaits delivery after releasing the conversation lock.
      // Never expose the signed webhook URL or transcript in an error log.
      console.error('[conversation-log] delivery failed or timed out');
    }
  }
}
