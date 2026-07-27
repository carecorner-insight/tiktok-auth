import { AIBotsClient } from './aiBotsClient';
import { DifyClient } from './difyClient';
import { FallbackAIClient } from './fallbackAIClient';
import { DirectLLMClient } from './directLLMClient';
import { CAREY_SYSTEM_PROMPT } from '../config/careySystemPrompt';

export interface CareyAIClient {
  chat(
    chatId: string | null,
    text: string,
    primeMessage?: string,
    history?: Array<{ role: 'user' | 'assistant'; content: string }>,
  ): Promise<{ reply: string; chatId: string }>;
}

// DashScope's OpenAI-compatible endpoint. The international host is SG-region.
const DEFAULT_QWEN_BASE_URL = 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1';

/**
 * Builds Carey's AI client.
 *   default            → AIBots (via Directus) with Dify fallback (today's path)
 *   USE_DIRECT_LLM=true → direct Qwen (OpenAI-compatible) client that holds the
 *                         system prompt + context itself, for efficacy testing.
 *
 * The flag is OFF by default, so the working AIBots path is untouched until set.
 * Only Carey's client is switched here; the social coach is unaffected.
 */
export function makeCareyAIClient(): CareyAIClient {
  if (process.env.USE_DIRECT_LLM === 'true') {
    console.log(`[ai] Carey using DIRECT LLM (model=${process.env.QWEN_MODEL ?? 'qwen-plus'})`);
    return new DirectLLMClient({
      apiKey: process.env.QWEN_API_KEY ?? '',
      baseURL: process.env.QWEN_BASE_URL ?? DEFAULT_QWEN_BASE_URL,
      model: process.env.QWEN_MODEL ?? 'qwen-plus',
      systemPrompt: CAREY_SYSTEM_PROMPT,
    });
  }

  return new FallbackAIClient(
    new AIBotsClient(
      process.env.DIRECTUS_CREATE_CHAT_URL ?? '',
      process.env.DIRECTUS_SEND_MESSAGE_URL ?? '',
    ),
    new DifyClient(
      process.env.DIFY_API_URL ?? '',
      process.env.DIFY_API_KEY ?? '',
    ),
  );
}
