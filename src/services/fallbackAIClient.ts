import type { HistoryMessage } from '../lib/buildPrime';

// Prefixes stored in aiBotChatId so the fallback client knows which
// provider owns the current session and can stay on that provider.
const AIBOTS_PREFIX = 'aibots:';
const DIFY_PREFIX   = 'dify:';

interface IAIClient {
  chat(
    chatId: string | null,
    text: string,
    primeMessage?: string,
    history?: HistoryMessage[],
  ): Promise<{ reply: string; chatId: string }>;
}

export class FallbackAIClient {
  constructor(
    private readonly primary: IAIClient,
    private readonly fallback: IAIClient,
  ) {}

  async chat(
    chatId: string | null,
    text: string,
    primeMessage?: string,
    history?: HistoryMessage[],
  ): Promise<{ reply: string; chatId: string }> {
    const isDifySession   = chatId?.startsWith(DIFY_PREFIX)   ?? false;
    const rawId           = chatId
      ? chatId.replace(AIBOTS_PREFIX, '').replace(DIFY_PREFIX, '')
      : null;

    // ── Currently on Dify — probe AIBots to see if it has recovered ──
    if (isDifySession) {
      try {
        // Always start a fresh AIBots session (no usable chatId) and replay
        // history so it has full context if the switch-back succeeds.
        const result = await this.primary.chat(null, text, primeMessage, history);
        console.log('[ai] AIBots recovered — switching back from Dify');
        return { reply: result.reply, chatId: `${AIBOTS_PREFIX}${result.chatId}` };
      } catch {
        // Still down — continue on the existing Dify session
        const result = await this.fallback.chat(rawId, text, primeMessage, history);
        return { reply: result.reply, chatId: `${DIFY_PREFIX}${result.chatId}` };
      }
    }

    // ── Try primary (AIBots) ──
    try {
      const result = await this.primary.chat(rawId, text, primeMessage, history);
      return { reply: result.reply, chatId: `${AIBOTS_PREFIX}${result.chatId}` };
    } catch (primaryErr) {
      console.warn('[ai] primary AIBots failed, switching to Dify fallback:', primaryErr);

      // Reset to null so Dify creates a fresh session — prime + history give
      // it full context of everything discussed before the failover.
      const result = await this.fallback.chat(null, text, primeMessage, history);
      return { reply: result.reply, chatId: `${DIFY_PREFIX}${result.chatId}` };
    }
  }
}
