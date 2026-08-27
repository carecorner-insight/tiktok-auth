import type { RedisClient } from './redis';
import { REPLY_TAG_CONTRACT, baseDefinesTagContract } from '../config/socialCoachPrompt';

/**
 * Runtime store for the social coach's system prompt, so the team can publish
 * prompt changes from the admin page (public/prompt-editor.html) without a
 * deploy or a developer.
 *
 * Guardrails live HERE, in code, out of editing reach:
 *  - the [CRISIS]/[REFERRAL] tag contract is appended at LOAD time whenever the
 *    stored text doesn't define one, so no edit can disable crisis signalling;
 *  - length validation runs on save AND on load (a row corrupted after save
 *    still can't reach the model);
 *  - any failure — nothing stored, corrupt JSON, Redis down — returns null and
 *    the caller falls back to the bundled SOCIAL_COACH_PROMPT. The worst a bad
 *    edit can do is make the coach sound worse, never break it.
 *  - the study endpoint forces DYNAMIC_COACH_PROMPT=false (see studyMode.ts),
 *    so the frozen NUS-study bot never sees a dynamic prompt.
 *
 * The stored record is intentionally extensible: later iterations add model
 * "dials" (temperature, style knobs) and A/B variants as sibling fields of
 * `text`, and the version number becomes the instrument version stamped into
 * outcome rows.
 */

const LIVE_KEY = 'prompt:coach:live';
const HISTORY_KEY = 'prompt:coach:history';
const HISTORY_MAX = 20;

export const PROMPT_MIN_CHARS = 500;
export const PROMPT_MAX_CHARS = 60000;

export interface StoredPrompt {
  text: string;
  version: number;
  label: string;
  editor: string;
  savedAt: string;
}

/** Error message when the text is unusable, null when it's fine. */
export function validatePromptText(text: unknown): string | null {
  if (typeof text !== 'string' || !text.trim()) return 'Prompt text is empty.';
  const len = text.trim().length;
  if (len < PROMPT_MIN_CHARS) {
    return `Prompt is too short — at least ${PROMPT_MIN_CHARS} characters (got ${len}). ` +
      'A near-empty prompt would strip the coach of all its instructions.';
  }
  if (len > PROMPT_MAX_CHARS) {
    return `Prompt is too long — at most ${PROMPT_MAX_CHARS} characters (got ${len}).`;
  }
  return null;
}

/** What the model actually receives: the text plus the non-negotiable tags. */
export function assembleCoachPrompt(text: string): string {
  const trimmed = text.trim();
  return baseDefinesTagContract(trimmed) ? trimmed : `${trimmed}\n\n${REPLY_TAG_CONTRACT}`;
}

function dynamicEnabled(): boolean {
  return process.env.DYNAMIC_COACH_PROMPT !== 'false';
}

function parseStored(raw: string | null): StoredPrompt | null {
  if (!raw) return null;
  try {
    const obj = JSON.parse(raw) as Partial<StoredPrompt>;
    if (validatePromptText(obj.text) !== null) return null;
    return {
      text: obj.text as string,
      version: typeof obj.version === 'number' ? obj.version : 0,
      label: typeof obj.label === 'string' ? obj.label : '',
      editor: typeof obj.editor === 'string' ? obj.editor : '',
      savedAt: typeof obj.savedAt === 'string' ? obj.savedAt : '',
    };
  } catch {
    return null;
  }
}

/** The raw stored record, for the admin page. Null when none/invalid. */
export async function getStoredPrompt(redis: RedisClient): Promise<StoredPrompt | null> {
  try {
    return parseStored(await redis.get(LIVE_KEY));
  } catch {
    return null;
  }
}

/**
 * The prompt the webhook should hand the model, fully assembled — or null,
 * meaning "use the bundled default". Never throws.
 */
export async function loadLiveCoachPrompt(
  redis: RedisClient,
): Promise<{ prompt: string; version: number; label: string } | null> {
  if (!dynamicEnabled()) return null;
  const stored = await getStoredPrompt(redis);
  if (!stored) return null;
  return { prompt: assembleCoachPrompt(stored.text), version: stored.version, label: stored.label };
}

/** Saves a new live prompt. Throws Error with a user-facing message on bad input. */
export async function saveCoachPrompt(
  redis: RedisClient,
  input: { text: string; label: string; editor: string },
): Promise<StoredPrompt> {
  const problem = validatePromptText(input.text);
  if (problem) throw new Error(problem);

  const prev = await getStoredPrompt(redis);
  const record: StoredPrompt = {
    text: input.text.trim(),
    version: (prev?.version ?? 0) + 1,
    label: (input.label ?? '').trim().slice(0, 120),
    editor: (input.editor ?? '').trim().slice(0, 80),
    savedAt: new Date().toISOString(),
  };

  await redis.set(LIVE_KEY, JSON.stringify(record));
  await redis.lpush(HISTORY_KEY, JSON.stringify(record));
  await redis.ltrim(HISTORY_KEY, 0, HISTORY_MAX - 1);
  return record;
}

/** Newest-first history (full records, capped at HISTORY_MAX). */
export async function listPromptHistory(redis: RedisClient): Promise<StoredPrompt[]> {
  try {
    const raw = await redis.lrange(HISTORY_KEY, 0, HISTORY_MAX - 1);
    return raw.map(r => parseStored(r)).filter((p): p is StoredPrompt => p !== null);
  } catch {
    return [];
  }
}
