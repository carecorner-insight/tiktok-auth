// ── Reply tag parsing ─────────────────────────────────────────────────────────
//
// The LLM bots (Carey free-text bot, social coach) signal routing decisions by
// embedding bracket tags anywhere in their reply:
//
//   [CRISIS]   — the user is in distress; route this turn to emergencyHandler.
//   [SOCIAL]   — the user is describing a social-situation struggle; offer the
//                Growing We social coach.
//   [REFERRAL] — the user would be better served by a real person; route to the
//                age-triaged referral (INSIGHT / CREST). This is the pivot's
//                ONLY route to a human, since the 6-option scenario menu has no
//                "connect with our team" entry.
//
// This module generalises the original parseCrisisReply so new tags can be
// added in one place. Detection is case-insensitive and tolerant of internal
// whitespace ("[ Crisis ]") and wrapping markdown emphasis ("*[CRISIS]*").
//
// Precedence: CRISIS always wins. If a reply carries both tags, the social
// coach suggestion is suppressed — never offer a coaching module in the same
// breath as a crisis response.

export interface ParsedReply {
  /** Reply text with all known tags stripped. */
  reply: string;
  /** True when a [CRISIS] tag was present anywhere in the reply. */
  isCrisis: boolean;
  /** True when a [SOCIAL] tag was present AND no crisis tag was present. */
  suggestsSocialCoach: boolean;
  /** True when a [REFERRAL] tag was present AND no crisis tag was present. */
  suggestsReferral: boolean;
}

const KNOWN_TAGS = ['crisis', 'social', 'referral'] as const;
type KnownTag = (typeof KNOWN_TAGS)[number];

// Detection: the tag anywhere, case-insensitive, internal whitespace allowed.
const detectPattern = (tag: KnownTag): RegExp => new RegExp(`\\[\\s*${tag}\\s*\\]`, 'i');

// Removal: same tag plus any wrapping markdown emphasis (*, _, ~, `) and
// trailing whitespace, matched globally so the tag is stripped wherever it is.
const stripPattern = (tag: KnownTag): RegExp =>
  new RegExp(`[*_~\`]*\\[\\s*${tag}\\s*\\][*_~\`]*\\s*`, 'gi');

/**
 * Parses routing tags out of an LLM reply.
 *
 * All known tags are stripped from the returned text regardless of which ones
 * are semantically honoured, so a stray tag never leaks to the user.
 */
export function parseReplyTags(raw: string): ParsedReply {
  const isCrisis = detectPattern('crisis').test(raw);
  const hasSocial = detectPattern('social').test(raw);
  const hasReferral = detectPattern('referral').test(raw);

  let reply = raw;
  for (const tag of KNOWN_TAGS) {
    reply = reply.replace(stripPattern(tag), '');
  }

  return {
    reply: reply.trim(),
    isCrisis,
    // Crisis takes precedence — never offer a coaching module or a support link
    // in the same breath as a crisis response.
    suggestsSocialCoach: hasSocial && !isCrisis,
    suggestsReferral: hasReferral && !isCrisis,
  };
}
