const CRISIS_PREFIX = '[CRISIS]';

export interface CrisisResult {
  reply: string;
  isCrisis: boolean;
}

/**
 * Strips the [CRISIS] prefix that AIBots appends when it enters State 8.
 * Returns the cleaned reply and whether a crisis was detected.
 */
export function parseCrisisReply(raw: string): CrisisResult {
  const trimmed = raw.trimStart();
  const isCrisis = trimmed.startsWith(CRISIS_PREFIX);
  const reply = isCrisis
    ? trimmed.slice(CRISIS_PREFIX.length).trimStart()
    : raw;
  return { reply, isCrisis };
}
