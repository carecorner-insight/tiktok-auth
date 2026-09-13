import { createHash } from 'crypto';
import { readFileSync } from 'fs';
import { resolveCoachConfig } from '@/services/resolveCoachConfig';
import { makeSocialCoachClient } from '@/services/makeSocialCoachClient';
import { DirectLLMClient } from '@/services/directLLMClient';
import { GROWING_WE_COACH_PROMPT } from '@/config/growingWeCoachPrompt';
import { SOCIAL_COACH_PROMPT } from '@/config/socialCoachPrompt';
import { applyStudyEnv } from '@/lib/studyMode';
import type { RedisClient } from '@/lib/redis';

jest.mock('@/services/directLLMClient', () => ({ DirectLLMClient: jest.fn() }));
const env = { ...process.env };
const redis = (value: string | null = null) => ({ get: jest.fn().mockResolvedValue(value) }) as unknown as RedisClient;
beforeEach(() => {
  process.env.SCENARIO_MENU = 'true';
  process.env.COACH_PROVIDER = 'direct';
  process.env.DYNAMIC_COACH_PROMPT = 'true';
  jest.clearAllMocks();
});
afterEach(() => { process.env = { ...env }; });

it('selects the pivot bundle and records its exact hash', async () => {
  const config = await resolveCoachConfig(redis());
  expect(config.systemPrompt).toBe(GROWING_WE_COACH_PROMPT);
  expect(config.metadata).toMatchObject({ variant: 'growing-we', promptSource: 'bundled',
    promptVersion: 'growing-we-v2', promptHash: createHash('sha256').update(GROWING_WE_COACH_PROMPT).digest('hex') });
  makeSocialCoachClient(config);
  expect(DirectLLMClient).toHaveBeenCalledWith(expect.objectContaining({ systemPrompt: config.systemPrompt, model: config.metadata.model }));
});

it('honours the published prompt and gives equivalent callers identical configuration', async () => {
  const r = redis(JSON.stringify({ text: 'A synthetic coaching instruction. '.repeat(30), version: 7 }));
  const webhook = await resolveCoachConfig(r);
  const simulator = await resolveCoachConfig(r);
  expect(simulator).toEqual(webhook);
  expect(webhook.metadata).toMatchObject({ promptSource: 'published', promptVersion: 7 });
  expect(webhook.systemPrompt).toContain('[REFERRAL]');
  expect(JSON.stringify(webhook.metadata)).not.toContain('synthetic coaching');
});

it.each([null, '{bad json', JSON.stringify({ text: 'too short' })])('falls back safely for absent/corrupt data (%s)', async value => {
  expect((await resolveCoachConfig(redis(value))).systemPrompt).toBe(GROWING_WE_COACH_PROMPT);
});

it('falls back to the bundle when Redis is unavailable', async () => {
  const r = redis();
  (r.get as jest.Mock).mockRejectedValue(new Error('offline'));
  expect((await resolveCoachConfig(r)).metadata.promptSource).toBe('bundled');
});

it('preserves the study bundle and ignores live prompts under study defaults', async () => {
  applyStudyEnv();
  const r = redis(JSON.stringify({ text: 'Live prompt. '.repeat(60), version: 99 }));
  const config = await resolveCoachConfig(r);
  expect(config.systemPrompt).toBe(SOCIAL_COACH_PROMPT);
  expect(config.metadata).toMatchObject({ variant: 'triage', promptVersion: 'carey-v9', promptSource: 'bundled' });
  expect(r.get).not.toHaveBeenCalled();
});

it('labels seeded providers honestly and does not read an ignored override', async () => {
  process.env.COACH_PROVIDER = 'aibots';
  const r = redis(); const config = await resolveCoachConfig(r);
  expect(config.systemPrompt).toBeUndefined();
  expect(config.metadata).toMatchObject({ provider: 'aibots', promptSource: 'external', promptHash: null, promptVersion: null });
  expect(r.get).not.toHaveBeenCalled();
});

it('keeps the pre-change study prompt byte-for-byte unchanged', () => {
  const file = readFileSync('src/config/socialCoachPrompt.ts');
  expect(createHash('sha256').update(file).digest('hex')).toBe('24570a455f171fcfebac21d47daf8d436e049bb5fb788babcb12536ae3e9e547');
});

it('keeps safety tags and ownership explicit in the pivot prompt', () => {
  expect(GROWING_WE_COACH_PROMPT).toContain('[CRISIS]');
  expect(GROWING_WE_COACH_PROMPT).toContain('[REFERRAL]');
  expect(GROWING_WE_COACH_PROMPT).toContain('A new backend session is not a new conversation');
  expect(GROWING_WE_COACH_PROMPT).toContain('platform handles the welcome');
  expect(readFileSync('SYS_PROMPT.md', 'utf8')).toContain('src/config/growingWeCoachPrompt.ts');
});
