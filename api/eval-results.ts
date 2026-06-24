import { timingSafeEqual } from 'crypto';
import type { VercelRequest, VercelResponse } from '@vercel/node';

import { getRedis } from '../src/lib/redis';
import { pushEvalSummary, readEvalSummaries, type EvalSummary } from '../src/lib/evalResults';

export const config = { runtime: 'nodejs' };

function tokenMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function readToken(req: VercelRequest, header: string): string {
  const h = req.headers[header];
  if (typeof h === 'string' && h) return h;
  const q = req.query['token'];
  return typeof q === 'string' ? q : '';
}

// Dual-write a posted eval result: compact summary → Redis (for the tab),
// full record → SharePoint via Power Automate (permanent archive).
async function handlePost(req: VercelRequest, res: VercelResponse) {
  // POST is the machine path (the eval runner) — gated by SIM_TOKEN.
  const expected = process.env.SIM_TOKEN;
  if (!expected) return res.status(503).json({ error: 'Eval write is disabled' });
  const provided = readToken(req, 'x-sim-token');
  if (!provided || !tokenMatches(provided, expected)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const r = (req.body ?? {}) as Record<string, unknown>;
  if (!r.runId || !r.persona) {
    return res.status(400).json({ error: 'runId and persona are required' });
  }

  const summary: EvalSummary = {
    runId: String(r.runId),
    ts: typeof r.ts === 'number' ? r.ts : Date.now(),
    persona: String(r.persona),
    userType: String(r.userType ?? ''),
    outcomeLabel: String(r.outcomeLabel ?? ''),
    status: r.status === 'error' ? 'error' : 'completed',
    referralPresentPct:
      typeof r.referralPresentPct === 'number' ? r.referralPresentPct : null,
    referralAbsentCount: typeof r.referralAbsentCount === 'number' ? r.referralAbsentCount : 0,
    wellbeingCheckReached:
      typeof r.wellbeingCheckReached === 'boolean' ? r.wellbeingCheckReached : null,
    passed: r.passed === true,
    finalTag: typeof r.finalTag === 'string' ? r.finalTag : null,
    finalPhase: typeof r.finalPhase === 'string' ? r.finalPhase : null,
    crisisDetected: r.crisisDetected === true,
    selectedOption: typeof r.selectedOption === 'number' ? r.selectedOption : null,
  };

  try {
    await pushEvalSummary(getRedis(), summary);
  } catch (err) {
    console.error('[eval-results] Redis write failed:', err);
    return res.status(500).json({ error: 'Failed to store summary' });
  }

  // Archive the full record (incl. transcript) to SharePoint. Best-effort.
  const url = process.env.EVAL_RESULTS_WEBHOOK_URL;
  if (url) {
    try {
      await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(r),
      });
    } catch (err) {
      console.error('[eval-results] SharePoint archive failed (non-fatal):', err);
    }
  }

  return res.status(200).json({ ok: true });
}

// GET is the human read path (the results tab) — gated by UAT_LOG_TOKEN.
async function handleGet(req: VercelRequest, res: VercelResponse) {
  const expected = process.env.UAT_LOG_TOKEN;
  if (!expected) return res.status(503).json({ error: 'Eval results are disabled' });
  const provided = readToken(req, 'x-uat-token');
  if (!provided || !tokenMatches(provided, expected)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const results = await readEvalSummaries(getRedis());
    res.setHeader('Cache-Control', 'no-store');
    return res.status(200).json({ serverTime: Date.now(), results });
  } catch (err) {
    console.error('[eval-results] read failed:', err);
    return res.status(500).json({ error: 'Failed to read results' });
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'POST') return handlePost(req, res);
  if (req.method === 'GET') return handleGet(req, res);
  return res.status(405).json({ error: 'Method not allowed' });
}
