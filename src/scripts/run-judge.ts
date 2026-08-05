/**
 * Batch pre-labeller for the reply-review platform.
 *
 * Pulls eval transcripts from the deployment, splits them into reply-in-context
 * units, has the LLM judge score each one, and ingests the results so the human
 * review UI can show a proposed verdict to confirm or override.
 *
 * Phase 1 deliberately runs over the EVAL corpus only: it is synthetic
 * (roleplayed personas), so reviewers can validate the rubric and the judge
 * with no PDPA exposure. Live conversation logs come in Phase 2.
 *
 * Env:
 *   SIM_BASE_URL   - deployment base URL
 *   SIM_TOKEN      - ingest auth for POST /api/label-queue
 *   UAT_LOG_TOKEN  - read auth for GET /api/eval-results
 *   QWEN_API_KEY   - judge model key (DashScope, Singapore)
 *   QWEN_BASE_URL  - optional; defaults to the Singapore DashScope endpoint
 *   JUDGE_MODEL    - optional; defaults to qwen-max
 *   JUDGE_LIMIT    - optional; max eval records to process (default 20)
 */

import { DirectLLMClient } from '../services/directLLMClient';
import { ReplyJudge } from '../services/replyJudge';
import { unitsFromEvalRecord } from '../lib/replyUnits';
import { JUDGE_VERSION } from '../config/judgeRubric';
import type { StoredUnit } from '../lib/labelStore';

const SIM_BASE_URL = (process.env.SIM_BASE_URL ?? '').replace(/\/$/, '');
const SIM_TOKEN = process.env.SIM_TOKEN ?? '';
const UAT_LOG_TOKEN = process.env.UAT_LOG_TOKEN ?? '';
const QWEN_API_KEY = process.env.QWEN_API_KEY ?? '';
const QWEN_BASE_URL =
  process.env.QWEN_BASE_URL || 'https://dashscope-intl.aliyuncs.com/compatible-mode/v1';
// Default to the strongest DashScope tier: judging is lower-volume than serving
// and accuracy here determines the quality of every downstream label.
const JUDGE_MODEL = process.env.JUDGE_MODEL || 'qwen-max';
const JUDGE_LIMIT = parseInt(process.env.JUDGE_LIMIT || '20', 10);

async function getJson(path: string): Promise<any> {
  const res = await fetch(`${SIM_BASE_URL}${path}`, {
    headers: { 'x-uat-token': UAT_LOG_TOKEN },
  });
  if (!res.ok) throw new Error(`GET ${path} → ${res.status} ${res.statusText}`);
  return res.json();
}

async function main() {
  if (!SIM_BASE_URL || !SIM_TOKEN || !UAT_LOG_TOKEN || !QWEN_API_KEY) {
    console.error('Set SIM_BASE_URL, SIM_TOKEN, UAT_LOG_TOKEN and QWEN_API_KEY.');
    process.exit(1);
  }

  const judge = new ReplyJudge(
    new DirectLLMClient({
      apiKey: QWEN_API_KEY,
      baseURL: QWEN_BASE_URL,
      model: JUDGE_MODEL,
      // The rubric is passed per-call as the prime; no standing system prompt.
      systemPrompt: '',
    }),
    JUDGE_VERSION,
  );

  console.log(`\n=== Judge ${JUDGE_VERSION} (${JUDGE_MODEL}) ===`);

  const { results } = await getJson(`/api/eval-results?token=${encodeURIComponent(UAT_LOG_TOKEN)}`);
  const summaries = (results ?? []).slice(0, JUDGE_LIMIT);
  console.log(`Fetched ${summaries.length} eval record(s) to process.`);

  const stored: StoredUnit[] = [];
  let judged = 0;
  let unparseable = 0;

  for (const s of summaries) {
    let full: any;
    try {
      full = (await getJson(
        `/api/eval-results?token=${encodeURIComponent(UAT_LOG_TOKEN)}&id=${encodeURIComponent(s.id)}`,
      )).result;
    } catch (err) {
      console.error(`  ! could not fetch ${s.id}:`, String(err));
      continue;
    }

    const units = unitsFromEvalRecord(full);
    for (const unit of units) {
      let verdict = null;
      try {
        verdict = await judge.judge(unit);
        if (verdict) judged++;
        else unparseable++;
      } catch (err) {
        // A judge failure must not abort the batch — the unit is still queued
        // for a human, just without a proposal.
        console.error(`  ! judge failed on ${unit.replyKey}:`, String(err));
      }
      stored.push({ ...unit, llm: verdict, judgeVersion: JUDGE_VERSION, ingestedAt: Date.now() });
    }
    console.log(`  ${s.persona} [${s.menuMode || '-'}]: ${units.length} unit(s)`);
  }

  if (!stored.length) {
    console.log('No judgeable replies found — nothing to ingest.');
    return;
  }

  const res = await fetch(`${SIM_BASE_URL}/api/label-queue`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-sim-token': SIM_TOKEN },
    body: JSON.stringify({ units: stored }),
  });
  if (!res.ok) {
    console.error(`Ingest failed: ${res.status} ${await res.text().catch(() => '')}`);
    process.exit(1);
  }
  const { added } = (await res.json()) as { added: number };

  console.log(
    `\n=== done: ${stored.length} unit(s) — ${judged} judged, ` +
      `${unparseable} unparseable, ${added} newly added to the queue ===`,
  );
}

main().catch(err => {
  console.error('Judge run failed:', err);
  process.exit(1);
});
