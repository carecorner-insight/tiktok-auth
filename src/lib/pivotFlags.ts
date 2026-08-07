/**
 * Feature flags for the Growing We pivot.
 *
 * Both default to ON (the current CareyBot behaviour) so the NUS study build is
 * identical to today when the vars are unset. The pivot deployment turns them
 * off explicitly. Only the exact string "false" disables a flag — a typo
 * ("no", "0", "off") leaves the safer setting in place rather than silently
 * removing the screener or opening access.
 */

const isOff = (v: string | undefined): boolean => v === 'false';

/** C-SSRS screener + safety check. Off on the pivot bot (F1). */
export function screenerEnabled(): boolean {
  return !isOff(process.env.SCREENER_ENABLED);
}

/** SharePoint whitelist / registration gate. Off on the pivot bot — open access (F2). */
export function authEnabled(): boolean {
  return !isOff(process.env.AUTH_ENABLED);
}

/**
 * F6 — the 6-option scenario menu, where every option routes to the social
 * coach, replacing the 3-option triage menu (talk / coach / resources).
 *
 * Defaults to "whatever the screener flag implies": turning the screener off is
 * the pivot configuration, and the scenario menu is part of the same product
 * decision. Set SCENARIO_MENU explicitly to decouple them.
 */
export function scenarioMenuEnabled(): boolean {
  const explicit = process.env.SCENARIO_MENU;
  if (explicit === 'true') return true;
  if (explicit === 'false') return false;
  return !screenerEnabled();
}

/**
 * F3 — the FIRST crisis turn is the exact clinically-approved wording, with no
 * generative model involved. Follow-up turns inside the crisis phase may be AI
 * so the bot can stay with the user.
 *
 * Defaults to ON deliberately. The pivot exists partly because sector leaders
 * objected to a generative model being the primary handler of self-harm
 * disclosures, so the unsafe direction to fail in is "accidentally AI". Failing
 * the other way merely produces a slightly less warm but approved message.
 * A build that wants today's AI-generated crisis reply must opt out explicitly.
 */
export function staticFirstCrisis(): boolean {
  return !isOff(process.env.CRISIS_STATIC_FIRST);
}
