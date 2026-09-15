import { createHash } from 'crypto';
import type { RedisClient } from '../lib/redis';
import { loadLiveCoachPrompt } from '../lib/promptStore';
import { scenarioMenuEnabled } from '../lib/pivotFlags';
import { SOCIAL_COACH_PROMPT } from '../config/socialCoachPrompt';
import { GROWING_WE_COACH_PROMPT, GROWING_WE_PROMPT_VERSION } from '../config/growingWeCoachPrompt';
import type { CoachModelSetting } from '../lib/botControl';

export interface CoachMetadata {
  variant: 'growing-we' | 'triage';
  provider: 'direct' | 'aibots';
  model: string;
  modelSource: 'deployment' | 'dashboard' | 'external';
  promptSource: 'bundled' | 'published' | 'external';
  promptVersion: string | number | null;
  promptHash: string | null;
  deploymentSha: string | null;
}

export interface CoachConfig {
  metadata: CoachMetadata;
  systemPrompt?: string;
}

export function coachProvider(): CoachMetadata['provider'] {
  return process.env.COACH_PROVIDER === 'aibots' ? 'aibots' : 'direct';
}

/** Shared by webhook and simulator. Never log the prompt body or credentials. */
export async function resolveCoachConfig(redis: RedisClient, modelSetting?: CoachModelSetting): Promise<CoachConfig> {
  const pivot = scenarioMenuEnabled();
  const provider = coachProvider();
  const sha = process.env.VERCEL_GIT_COMMIT_SHA ?? '';
  const selectedModel = pivot ? modelSetting?.model : null;
  const metadata: CoachMetadata = {
    variant: pivot ? 'growing-we' : 'triage', provider,
    model: provider === 'direct' ? selectedModel ?? process.env.COACH_MODEL ?? process.env.QWEN_MODEL ?? 'qwen-plus' : 'externally-managed',
    modelSource: provider === 'aibots' ? 'external' : selectedModel ? 'dashboard' : 'deployment',
    promptSource: 'external', promptVersion: null, promptHash: null,
    deploymentSha: /^[a-f\d]{7,40}$/i.test(sha) ? sha : null,
  };
  // External providers have seeded prompts; a local override is not applied.
  if (provider === 'aibots') return { metadata };
  const live = await loadLiveCoachPrompt(redis);
  const systemPrompt = live?.prompt ?? (pivot ? GROWING_WE_COACH_PROMPT : SOCIAL_COACH_PROMPT);
  return {
    systemPrompt,
    metadata: {
      ...metadata, promptSource: live ? 'published' : 'bundled',
      promptVersion: live?.version ?? (pivot ? GROWING_WE_PROMPT_VERSION : 'carey-v9'),
      promptHash: createHash('sha256').update(systemPrompt).digest('hex'),
    },
  };
}
