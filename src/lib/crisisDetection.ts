export interface CrisisResult {
  reply: string;
  isCrisis: boolean;
}

// Detects a [CRISIS] tag anywhere in the reply, case-insensitively, tolerating
// internal whitespace (e.g. "[ Crisis ]"). Used for the boolean check.
const CRISIS_DETECT = /\[\s*crisis\s*\]/i;

// Removal pattern: same tag plus any wrapping markdown emphasis (*, _, ~, `)
// and trailing whitespace, matched globally so a tag anywhere is stripped.
const CRISIS_STRIP = /[*_~`]*\[\s*crisis\s*\][*_~`]*\s*/gi;

/**
 * Strips the [CRISIS] tag that the LLM emits when it enters State 8 (crisis
 * routing). Robust to case, markdown emphasis, internal spaces, and the tag
 * appearing anywhere in the message rather than only as a prefix.
 *
 * Returns the cleaned reply and whether a crisis tag was present.
 */
export function parseCrisisReply(raw: string): CrisisResult {
  const isCrisis = CRISIS_DETECT.test(raw);
  if (!isCrisis) return { reply: raw, isCrisis: false };

  const reply = raw.replace(CRISIS_STRIP, '').trim();
  return { reply, isCrisis: true };
}
