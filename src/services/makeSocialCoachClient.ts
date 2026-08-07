import { AIBotsClient } from './aiBotsClient';
import { DifyClient } from './difyClient';
import { FallbackAIClient } from './fallbackAIClient';
import { DirectLLMClient } from './directLLMClient';
import { SOCIAL_COACH_PROMPT } from '../config/socialCoachPrompt';
import type { CareyAIClient } from './makeCareyAIClient';

// DashScope's OpenAI-compatible endpoint. The international host is SG-region,
// which is what keeps the direct path PDPA-viable.
const DEFAULT_QWEN_BASE_URL = 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1';

export type CoachProvider = 'direct' | 'aibots';

/** `direct` (default) unless COACH_PROVIDER explicitly asks for `aibots`. */
export function coachProvider(): CoachProvider {
  return process.env.COACH_PROVIDER === 'aibots' ? 'aibots' : 'direct';
}

/**
 * Builds the social coach's AI client.
 *
 *   default (direct)        → Qwen via DashScope, holding SOCIAL_COACH_PROMPT
 *                             (incl. the [CRISIS]/[REFERRAL] tag contract) and
 *                             the conversation transcript ourselves.
 *   COACH_PROVIDER=aibots   → the seeded Growing We bot on AIBots via Directus,
 *                             with the Dify fallback.
 *
 * Note the memory difference: the direct client has no server-side session, so
 * context comes from the transcript the node passes as `history`. socialCoachNode
 * already does that, so both providers behave the same from the graph's side.
 *
 * ⚠️ On the aibots path the tag contract lives in the SEEDED prompt on the
 * Directus platform — it is not sent from here. Keep the two in sync or the
 * crisis/referral handoffs silently stop working on that provider.
 */
export function makeSocialCoachClient(): CareyAIClient {
  if (coachProvider() === 'aibots') {
    console.log('[ai] social coach using AIBots (Directus) with Dify fallback');
    return new FallbackAIClient(
      new AIBotsClient(
        process.env.DIRECTUS_SOCIALCOACH_CREATE_CHAT_URL ?? '',
        process.env.DIRECTUS_SEND_MESSAGE_URL ?? '',
      ),
      new DifyClient(
        process.env.DIFY_API_URL ?? '',
        process.env.DIFY_SOCIALCOACH_API_KEY ?? '',
      ),
    );
  }

  const model = process.env.COACH_MODEL ?? process.env.QWEN_MODEL ?? 'qwen-plus';
  console.log(`[ai] social coach using DIRECT LLM (model=${model})`);
  return new DirectLLMClient({
    apiKey: process.env.QWEN_API_KEY ?? '',
    baseURL: process.env.QWEN_BASE_URL ?? DEFAULT_QWEN_BASE_URL,
    model,
    systemPrompt: SOCIAL_COACH_PROMPT,
  });
}
