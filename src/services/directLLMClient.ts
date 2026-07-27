import OpenAI from 'openai';

export interface HistoryMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface DirectLLMOptions {
  apiKey: string;
  baseURL: string;
  model: string;
  systemPrompt: string;
}

// Minimal shape of the OpenAI-compatible client we depend on. Declaring it lets
// tests inject a fake without constructing the real SDK.
interface ChatCompleter {
  chat: {
    completions: {
      create(body: {
        model: string;
        messages: Array<{ role: 'system' | 'user' | 'assistant'; content: string }>;
      }): Promise<{ choices: Array<{ message?: { content?: string | null } }> }>;
    };
  };
}

/**
 * Drop-in replacement for AIBotsClient that calls an OpenAI-compatible LLM
 * (e.g. Alibaba Qwen via DashScope) DIRECTLY — we hold the system prompt and
 * send the conversation context ourselves, instead of relying on a
 * server-seeded agent + server-side session.
 *
 * Same `chat()` signature, so it swaps in wherever AIBotsClient is used.
 * Memory is the caller's session transcript (passed as `history`); the returned
 * chatId is just a marker so nodes stop re-sending the prime.
 */
export class DirectLLMClient {
  private readonly client: ChatCompleter;

  constructor(private readonly opts: DirectLLMOptions, client?: ChatCompleter) {
    this.client =
      client ??
      (new OpenAI({ apiKey: opts.apiKey, baseURL: opts.baseURL }) as unknown as ChatCompleter);
  }

  async chat(
    chatId: string | null,
    text: string,
    primeMessage?: string,
    history?: HistoryMessage[],
  ): Promise<{ reply: string; chatId: string }> {
    const systemContent = primeMessage
      ? `${this.opts.systemPrompt}\n\n${primeMessage}`
      : this.opts.systemPrompt;

    const messages = [
      { role: 'system' as const, content: systemContent },
      ...(history ?? []).map(m => ({ role: m.role, content: m.content })),
      { role: 'user' as const, content: text },
    ];

    const completion = await this.client.chat.completions.create({
      model: this.opts.model,
      messages,
    });

    const reply = completion.choices[0]?.message?.content ?? '';
    return { reply, chatId: chatId ?? `direct:${Date.now().toString(36)}` };
  }
}
