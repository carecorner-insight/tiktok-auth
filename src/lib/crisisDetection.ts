import { parseReplyTags } from './replyTags';

export interface CrisisResult {
  reply: string;
  isCrisis: boolean;
}

/**
 * @deprecated Use parseReplyTags from './replyTags' — it handles [CRISIS] and
 * [SOCIAL] in one pass. Kept as a thin delegate so existing imports and tests
 * keep working during the migration.
 */
export function parseCrisisReply(raw: string): CrisisResult {
  const { reply, isCrisis } = parseReplyTags(raw);
  return { reply, isCrisis };
}

// ── Deterministic crisis phrase backstop ──────────────────────────────────────
// High-precision phrases for detecting a crisis disclosure in the USER's message
// without any LLM call. Input is expected pre-normalised by getLastUserInput()
// (lowercased, punctuation stripped, so "don't" → "dont"). Broad single words
// like "die" are deliberately excluded to avoid false positives; the LLM /
// [CRISIS] tag catches phrasing this list misses. This exists so a disclosure is
// caught even if every LLM/provider is unreachable, in ANY conversation phase.
const CRISIS_PHRASES = [
  'kill myself', 'killing myself', 'kill me',
  'suicide', 'suicidal',
  'end my life', 'ending my life', 'end it all',
  'want to die', 'wanna die',
  'wish i was dead', 'wish i were dead', 'better off dead',
  'dont want to live', 'do not want to live', 'dont want to be alive',
  'hurt myself', 'hurting myself', 'harm myself', 'harming myself',
  'self harm', 'selfharm',
  'not wake up', 'never wake up',
  'not safe right now',
  'unalive',
];

/** True when the pre-normalised user input contains a known crisis phrase. */
export function containsCrisisPhrase(normalizedInput: string): boolean {
  return CRISIS_PHRASES.some(p => normalizedInput.includes(p));
}
