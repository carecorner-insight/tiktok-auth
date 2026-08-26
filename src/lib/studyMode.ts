/**
 * Environment configuration for the NUS-study webhook (api/webhook-study.ts).
 *
 * Both bots run from ONE deployment whose env vars are set to the pivot
 * configuration, so the study endpoint forces the study values onto its own
 * function instance instead. This is safe on Vercel because each api/ file is
 * bundled and run as a separate function — mutating process.env here never
 * touches the pivot webhook — and every pivot flag is read per-request (see
 * pivotFlags.ts / makeCareyAIClient.ts), never at module load.
 *
 * Each value can be overridden per-key with a STUDY_-prefixed var, e.g.
 * STUDY_USE_DIRECT_LLM=true, without affecting the pivot's own setting.
 */
export const STUDY_ENV_DEFAULTS: Record<string, string> = {
  // C-SSRS screener + safety check on — the study flow.
  SCREENER_ENABLED: 'true',
  // SharePoint whitelist / registration gate on. Requires
  // SHAREPOINT_WHITELIST_WEBHOOK_URL to be set, or every user is denied.
  AUTH_ENABLED: 'true',
  // 3-option triage menu, not the 6-scenario coach menu.
  SCENARIO_MENU: 'false',
  // First crisis turn is the static approved wording.
  CRISIS_STATIC_FIRST: 'true',
  // Carey answers via AIBots (Directus) with Dify fallback — the study's
  // PDPA-cleared provider — not the direct Qwen client.
  USE_DIRECT_LLM: 'false',
};

export function applyStudyEnv(env: NodeJS.ProcessEnv = process.env): void {
  for (const [key, studyValue] of Object.entries(STUDY_ENV_DEFAULTS)) {
    env[key] = env[`STUDY_${key}`] ?? studyValue;
  }
}
