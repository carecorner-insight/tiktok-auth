import { buildPrimeWithHistory } from '../lib/buildPrime';
import type { HistoryMessage } from '../lib/buildPrime';

type FetchFn = (url: string, init: RequestInit) => Promise<{ ok: boolean; status?: number; json(): Promise<unknown> }>;

export interface ChatResult {
  reply: string;
  chatId: string;
}

export class DifyClient {
  constructor(
    private readonly apiUrl: string,   // e.g. https://api.dify.ai/v1
    private readonly apiKey: string,
    private readonly fetch: FetchFn = globalThis.fetch,
  ) {}

  private async sendMessage(
    conversationId: string | null,
    text: string,
  ): Promise<{ answer: string; conversationId: string }> {
    const t = Date.now();
    const response = await this.fetch(`${this.apiUrl}/chat-messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        inputs: {},
        query: text,
        response_mode: 'blocking',
        conversation_id: conversationId ?? '',
        user: 'careybot',
      }),
      signal: AbortSignal.timeout(50000),
    } as RequestInit);
    console.log(`[perf] Dify sendMessage: ${Date.now() - t}ms, status: ${response.status}`);

    if (!response.ok) {
      throw new Error(`Dify sendMessage failed: ${response.status}`);
    }

    const data = (await response.json()) as { answer?: string; conversation_id?: string };
    if (!data.answer) throw new Error('Dify: no answer in response');
    if (!data.conversation_id) throw new Error('Dify: no conversation_id in response');
    return { answer: data.answer, conversationId: data.conversation_id };
  }

  async chat(
    chatId: string | null,
    text: string,
    primeMessage?: string,
    history?: HistoryMessage[],
  ): Promise<ChatResult> {
    const hasPriorContext = history?.some(m => m.role === 'assistant') ?? false;

    if (chatId === null && (primeMessage || hasPriorContext)) {
      // Prime new session with history appended so Dify has full context.
      // Works for both fresh sessions (explicit prime) and recovery/fallover
      // (history-only, prime may be undefined).
      const effectivePrime = primeMessage ?? (
        '[SYSTEM CONTEXT] You are Carey, a mental health support assistant. ' +
        'Continue naturally from the conversation history below.'
      );
      const fullPrime = buildPrimeWithHistory(effectivePrime, history);
      const primed = await this.sendMessage(null, fullPrime);
      const result = await this.sendMessage(primed.conversationId, text);
      return { reply: result.answer, chatId: result.conversationId };
    }

    const result = await this.sendMessage(chatId, text);
    return { reply: result.answer, chatId: result.conversationId };
  }
}
