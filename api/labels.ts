import { timingSafeEqual } from 'crypto';
import type { VercelRequest, VercelResponse } from '@vercel/node';

import { getRedis } from '../src/lib/redis';
import { makeLabelerService } from '../src/services/labelerService';
import {
  readUnits,
  readHumanLabels,
  pushHumanLabel,
  verdictsAgree,
  type HumanLabel,
} from '../src/lib/labelStore';
import {
  RUBRIC_DIMENSIONS,
  JUDGE_VERSION,
  type DimensionVerdict,
  type OverallVerdict,
} from '../src/config/judgeRubric';

export const config = { runtime: 'nodejs', maxDuration: 30 };

const DIMS: DimensionVerdict[] = ['pass', 'fail', 'na'];
const OVERALLS: OverallVerdict[] = ['good', 'borderline', 'bad'];

function readHeader(req: VercelRequest, name: string): string {
  const h = req.headers[name];
  if (typeof h === 'string' && h) return h;
  const q = req.query['token'];
  return typeof q === 'string' ? q : '';
}

function tokenMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/** POST — a human label. Mirrored to Redis and archived to SharePoint. */
async function handlePost(req: VercelRequest, res: VercelResponse) {
  let redis;
  let labeler;
  try {
    redis = getRedis();
    labeler = await makeLabelerService(redis).resolve(readHeader(req, 'x-labeler-token'));
  } catch (err) {
    console.error('[labels] auth lookup failed:', err);
    return res.status(500).json({ error: 'Failed to verify reviewer' });
  }
  if (!labeler) return res.status(401).json({ error: 'Unauthorized' });

  const b = (req.body ?? {}) as Record<string, unknown>;
  const replyKey = typeof b.replyKey === 'string' ? b.replyKey : '';
  if (!replyKey) return res.status(400).json({ error: 'replyKey is required' });

  // Validate every rubric dimension — a malformed label would silently corrupt
  // the gold set the judge is later measured against.
  const dims: Record<string, DimensionVerdict> = {};
  for (const d of RUBRIC_DIMENSIONS) {
    const v = typeof b[d.key] === 'string' ? (b[d.key] as string).toLowerCase() : '';
    if (!DIMS.includes(v as DimensionVerdict)) {
      return res.status(400).json({ error: `Invalid or missing verdict for "${d.key}"` });
    }
    dims[d.key] = v as DimensionVerdict;
  }
  const overall = typeof b.overall === 'string' ? (b.overall.toLowerCase() as OverallVerdict) : null;
  if (!overall || !OVERALLS.includes(overall)) {
    return res.status(400).json({ error: 'Invalid or missing overall verdict' });
  }

  try {
    const unit = (await readUnits(redis)).find(u => u.replyKey === replyKey);
    if (!unit) return res.status(404).json({ error: 'Unknown replyKey' });

    const verdicts = {
      safety: dims.safety, shape: dims.shape, tone: dims.tone,
      referral: dims.referral, boundaries: dims.boundaries, overall,
    };

    // null = there was no judge proposal to compare against. Stored as two
    // plain booleans so SharePoint/Power BI never see a three-state field.
    const agreement = verdictsAgree(verdicts, unit.llm);

    const label: HumanLabel = {
      ...verdicts,
      replyKey,
      labelerId: labeler.id,
      labelerName: labeler.name,
      rationale: typeof b.rationale === 'string' ? b.rationale.trim().slice(0, 1000) : '',
      judgeVersion: unit.judgeVersion || JUDGE_VERSION,
      hasJudgeProposal: agreement !== null,
      agreedWithLlm: agreement === true,
      ts: Date.now(),
    };

    await pushHumanLabel(redis, label);

    // Permanent archive + the table Power BI reads. Best-effort: a SharePoint
    // outage must not lose the reviewer's work, which is already in Redis.
    const url = process.env.LABELS_WEBHOOK_URL;
    if (url) {
      try {
        await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ...label,
            source: unit.source,
            persona: unit.persona ?? '',
            menuMode: unit.menuMode ?? '',
            userType: unit.userType ?? '',
            phase: unit.phase ?? '',
            replyText: unit.reply,
            llmSafety: unit.llm?.safety ?? '',
            llmShape: unit.llm?.shape ?? '',
            llmTone: unit.llm?.tone ?? '',
            llmReferral: unit.llm?.referral ?? '',
            llmBoundaries: unit.llm?.boundaries ?? '',
            llmOverall: unit.llm?.overall ?? '',
            llmRationale: unit.llm?.rationale ?? '',
          }),
        });
      } catch (err) {
        console.error('[labels] SharePoint archive failed (non-fatal):', err);
      }
    }

    return res.status(200).json({
      ok: true,
      hasJudgeProposal: label.hasJudgeProposal,
      agreedWithLlm: label.agreedWithLlm,
    });
  } catch (err) {
    console.error('[labels] write failed:', err);
    return res.status(500).json({ error: 'Failed to store label' });
  }
}

/**
 * GET — export every label joined to its reply + the judge's proposal.
 * Gated by UAT_LOG_TOKEN (human read). `?format=csv` for spreadsheet/Power BI.
 */
async function handleGet(req: VercelRequest, res: VercelResponse) {
  const expected = process.env.UAT_LOG_TOKEN;
  if (!expected) return res.status(503).json({ error: 'Label export is disabled' });
  const provided = readHeader(req, 'x-uat-token');
  if (!provided || !tokenMatches(provided, expected)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const redis = getRedis();
    res.setHeader('Cache-Control', 'no-store');
    const [units, labels] = await Promise.all([readUnits(redis), readHumanLabels(redis)]);
    const byKey = new Map(units.map(u => [u.replyKey, u]));

    const rows = labels.map(l => {
      const u = byKey.get(l.replyKey);
      return {
        ...l,
        persona: u?.persona ?? '',
        menuMode: u?.menuMode ?? '',
        userType: u?.userType ?? '',
        phase: u?.phase ?? '',
        replyText: u?.reply ?? '',
        llmOverall: u?.llm?.overall ?? '',
        llmSafety: u?.llm?.safety ?? '',
        llmShape: u?.llm?.shape ?? '',
        llmTone: u?.llm?.tone ?? '',
        llmReferral: u?.llm?.referral ?? '',
        llmBoundaries: u?.llm?.boundaries ?? '',
      };
    });

    if (req.query['format'] === 'csv') {
      const cols = Object.keys(rows[0] ?? { replyKey: '' });
      const escape = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
      const csv = [
        cols.join(','),
        ...rows.map(r => cols.map(c => escape((r as Record<string, unknown>)[c])).join(',')),
      ].join('\n');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="carey-labels.csv"');
      return res.status(200).send(csv);
    }

    return res.status(200).json({ serverTime: Date.now(), count: rows.length, rows });
  } catch (err) {
    console.error('[labels] export failed:', err);
    return res.status(500).json({ error: 'Failed to export labels' });
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'POST') return handlePost(req, res);
  if (req.method === 'GET') return handleGet(req, res);
  return res.status(405).json({ error: 'Method not allowed' });
}
