// Prefixes stored in aiBotChatId so the fallback client knows which
// provider owns the current session and can stay on that provider.
const AIBOTS_PREFIX = 'aibots:';
const DIFY_PREFIX   = 'dify:';

interface IAIClient {
  chat(chatId: string | null, text: string, primeMessage?: string): Promise<{ reply: string; chatId: string }>;
}

export class FallbackAIClient {
  constructor(
    private readonly primary: IAIClient,
    private readonly fallback: IAIClient,
  ) {}

  async chat(chatId: string | null, text: string, primeMessage?: string): Promise<{ reply: string; chatId: string }> {
    const isDifySession  = chatId?.startsWith(DIFY_PREFIX)   ?? false;
    const isAiBotsSession = chatId?.startsWith(AIBOTS_PREFIX) ?? false;

    // Strip prefix before passing raw ID to the underlying client
    const rawId = chatId
      ? chatId.replace(AIBOTS_PREFIX, '').replace(DIFY_PREFIX, '')
      : null;

    // ── Already on Dify (previous turn failed over) — stay on Dify ──
    if (isDifySession) {
      const result = await this.fallback.chat(rawId, text, primeMessage);
      return { reply: result.reply, chatId: `${DIFY_PREFIX}${result.chatId}` };
    }

    // ── Try primary (AIBots) ──
    try {
      const result = await this.primary.chat(rawId, text, primeMessage);
      return { reply: result.reply, chatId: `${AIBOTS_PREFIX}${result.chatId}` };
    } catch (primaryErr) {
      console.warn('[ai] primary AIBots failed, switching to Dify fallback:', primaryErr);

      // When falling back mid-session (existing AIBots chatId), we lose the
      // AIBots thread but we still send the prime so Dify gets full context.
      // Passing null starts a fresh Dify conversation.
      const fallbackChatId = isDifySession ? rawId : null;
      const result = await this.fallback.chat(fallbackChatId, text, primeMessage);
      return { reply: result.reply, chatId: `${DIFY_PREFIX}${result.chatId}` };
    }
  }
}
