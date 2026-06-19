import { buildPrimeWithHistory } from '../lib/buildPrime';
import type { HistoryMessage } from '../lib/buildPrime';

type FetchFn = (url: string, init: RequestInit) => Promise<{ ok: boolean; status?: number; json(): Promise<unknown> }>;

// Returns a minimal recovery prime when the original prime is unavailable
// (mid-session turns don't carry a primeMessage). Only used when history
// contains prior AI turns — otherwise there's nothing to recover.
function recoveryPrimeFromHistory(history?: HistoryMessage[]): string | undefined {
  const hasPriorAITurns = history?.some(m => m.role === 'assistant') ?? false;
  if (!hasPriorAITurns) return undefined;
  return (
    '[SYSTEM CONTEXT] This conversation is resuming after a session restart. ' +
    'You are Carey, a mental health support assistant. ' +
    'Continue naturally from the conversation history below.'
  );
}


export interface ChatResult {
  reply: string;
  chatId: string;
}

export class AIBotsClient {
  constructor(
    private readonly createChatUrl: string,
    private readonly sendMessageUrl: string,
    private readonly fetch: FetchFn = globalThis.fetch,
  ) {}

  async createChat(): Promise<string> {
    const t = Date.now();
    const response = await this.fetch(this.createChatUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'azure~openai.gpt-5-2-chat' }),
      signal: AbortSignal.timeout(10000),
    } as RequestInit);
    console.log(`[perf] AIBots createChat: ${Date.now() - t}ms, status: ${response.status}`);

    if (!response.ok) {
      throw new Error(`AIBots createChat failed: ${response.status}`);
    }

    const data = (await response.json()) as { id?: string };
    if (!data.id) throw new Error('AIBots createChat: no id in response');
    return data.id;
  }

  async sendMessage(chatId: string, text: string): Promise<string> {
    const t = Date.now();
    const response = await this.fetch(this.sendMessageUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: text, chat_id: chatId }),
      signal: AbortSignal.timeout(50000),
    } as RequestInit);
    console.log(`[perf] AIBots sendMessage: ${Date.now() - t}ms, status: ${response.status}`);

    if (!response.ok) {
      throw new Error(`AIBots sendMessage failed: ${response.status}`);
    }

    const data = (await response.json()) as { response?: { content?: string } | string };
    if (data.response && typeof data.response === 'object' && data.response.content) return data.response.content;
    if (data.response && typeof data.response === 'string') return data.response;
    throw new Error('AIBots sendMessage: unexpected response format');
  }

  async chat(
    chatId: string | null,
    text: string,
    primeMessage?: string,
    history?: HistoryMessage[],
  ): Promise<ChatResult> {
    const isNewSession = chatId === null;
    let activeChatId = chatId ?? await this.createChat();

    // Prime new sessions — history appended to prime so AIBots has full context
    // on recovery (when a stale chatId forces a new session below).
    if (isNewSession && primeMessage) {
      const fullPrime = buildPrimeWithHistory(primeMessage, history);
      await this.sendMessage(activeChatId, fullPrime);
    }

    try {
      const reply = await this.sendMessage(activeChatId, text);
      return { reply, chatId: activeChatId };
    } catch {
      // Stale chatId (AIBots restarted) — create fresh session and replay context.
      // primeMessage is undefined for mid-session turns, so fall back to a
      // generic recovery prime so history is still injected.
      activeChatId = await this.createChat();
      const recoveryPrime = primeMessage ?? recoveryPrimeFromHistory(history);
      if (recoveryPrime) {
        const fullPrime = buildPrimeWithHistory(recoveryPrime, history);
        await this.sendMessage(activeChatId, fullPrime);
      }
      const reply = await this.sendMessage(activeChatId, text);
      return { reply, chatId: activeChatId };
    }
  }
}
