type FetchFn = (url: string, init: RequestInit) => Promise<{ ok: boolean; status?: number; json(): Promise<unknown> }>;

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
    const response = await this.fetch(this.createChatUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: 'azure~openai.gpt-4o-chat' }),
    });

    if (!response.ok) {
      throw new Error(`AIBots createChat failed: ${response.status}`);
    }

    const data = (await response.json()) as { id?: string };
    if (!data.id) throw new Error('AIBots createChat: no id in response');
    return data.id;
  }

  async sendMessage(chatId: string, text: string): Promise<string> {
    const response = await this.fetch(this.sendMessageUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ content: text, chat_id: chatId }),
    });

    if (!response.ok) {
      throw new Error(`AIBots sendMessage failed: ${response.status}`);
    }

    const data = (await response.json()) as { response?: { content?: string } | string };
    if (typeof data.response === 'object' && data.response?.content) return data.response.content;
    if (typeof data.response === 'string' && data.response) return data.response;
    throw new Error('AIBots sendMessage: unexpected response format');
  }

  async chat(chatId: string | null, text: string): Promise<ChatResult> {
    let activeChatId = chatId ?? await this.createChat();

    try {
      const reply = await this.sendMessage(activeChatId, text);
      return { reply, chatId: activeChatId };
    } catch {
      // Stale chatId (AIBots restarted) — create a fresh session and retry once
      activeChatId = await this.createChat();
      const reply = await this.sendMessage(activeChatId, text);
      return { reply, chatId: activeChatId };
    }
  }
}
