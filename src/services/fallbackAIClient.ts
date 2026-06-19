import type { HistoryMessage } from '../lib/buildPrime';

function recoveryPrimeFromHistory(history?: HistoryMessage[]): string | undefined {
  const hasPriorAITurns = history?.some(m => m.role === 'assistant') ?? false;
  if (!hasPriorAITurns) return undefined;
  return (
    '[SYSTEM CONTEXT] This conversation is resuming after a provider failover. ' +
    'You are Carey, a mental health support assistant. ' +
    'Continue naturally from the conversation history below.'
  );
}

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

    // Nodes set primeMessage ONLY for a genuinely fresh AI session (aiBotChatId
    // was null). A mid-session turn leaves it undefined. So:
    //   primeMessage defined   → fresh start: prime alone, DO NOT replay history
    //                            (avoids dumping the screener transcript into a
    //                             brand-new conversation)
    //   primeMessage undefined → mid-session: a switch to a fresh session on the
    //                            other provider must replay history for continuity
    const isMidSession = primeMessage === undefined;
    const switchPrime  = primeMessage ?? recoveryPrimeFromHistory(history);
    const ctxHistory   = isMidSession ? history : undefined;

    // ── Currently on Dify — probe AIBots to see if it has recovered ──
    if (isDifySession) {
      try {
        // Fresh AIBots session — replay history so context carries over.
        const result = await this.primary.chat(null, text, switchPrime, ctxHistory);
        console.log('[ai] AIBots recovered — switching back from Dify');
        return { reply: result.reply, chatId: `${AIBOTS_PREFIX}${result.chatId}` };
      } catch {
        // Still down — continue the existing Dify session (context preserved
        // server-side, so no history injection needed here).
        const result = await this.fallback.chat(rawId, text, primeMessage, ctxHistory);
        return { reply: result.reply, chatId: `${DIFY_PREFIX}${result.chatId}` };
      }
    }

    // ── Try primary (AIBots) ──
    try {
      // Fresh session → ctxHistory is undefined (clean start). Mid-session →
      // ctxHistory carries context for AIBots' internal crash-recovery path.
      const result = await this.primary.chat(rawId, text, primeMessage, ctxHistory);
      return { reply: result.reply, chatId: `${AIBOTS_PREFIX}${result.chatId}` };
    } catch (primaryErr) {
      console.warn('[ai] primary AIBots failed, switching to Dify fallback:', primaryErr);

      // Fresh Dify session — replay history only if this was a mid-session turn.
      const result = await this.fallback.chat(null, text, switchPrime, ctxHistory);
      return { reply: result.reply, chatId: `${DIFY_PREFIX}${result.chatId}` };
    }
  }
}
