import { timingSafeEqual } from 'crypto';
import type { VercelRequest, VercelResponse } from '@vercel/node';

import { getRedis } from '../src/lib/redis';
import { readUnits, readHumanLabels } from '../src/lib/labelStore';
import { computeAgreement, type JoinedLabel } from '../src/lib/agreement';

export const config = { runtime: 'nodejs', maxDuration: 30 };

function tokenMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

/**
 * Human-vs-judge agreement report for the labelling dashboard.
 * Read-only, gated by UAT_LOG_TOKEN like the other review surfaces.
 */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

  const expected = process.env.UAT_LOG_TOKEN;
  if (!expected) return res.status(503).json({ error: 'Label stats are disabled' });
  const header = req.headers['x-uat-token'];
  const provided =
    typeof header === 'string' && header
      ? header
      : typeof req.query['token'] === 'string'
      ? (req.query['token'] as string)
      : '';
  if (!provided || !tokenMatches(provided, expected)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  try {
    const redis = getRedis();
    res.setHeader('Cache-Control', 'no-store');

    const [units, labels] = await Promise.all([readUnits(redis), readHumanLabels(redis)]);
    const byKey = new Map(units.map(u => [u.replyKey, u]));

    const joined: JoinedLabel[] = labels.map(l => {
      const u = byKey.get(l.replyKey);
      return {
        replyKey: l.replyKey,
        labelerId: l.labelerId,
        labelerName: l.labelerName,
        judgeVersion: l.judgeVersion,
        ts: l.ts,
        human: {
          safety: l.safety, shape: l.shape, tone: l.tone,
          referral: l.referral, boundaries: l.boundaries, overall: l.overall,
        },
        llm: u?.llm ?? null,
        rationale: l.rationale,
        persona: u?.persona,
        menuMode: u?.menuMode,
        phase: u?.phase ?? undefined,
        replyText: u?.reply,
      };
    });

    const report = computeAgreement(joined);

    // Trim the drill-down lists — the dashboard only renders the recent ones.
    return res.status(200).json({
      serverTime: Date.now(),
      corpusSize: units.length,
      report: {
        ...report,
        disagreements: report.disagreements.slice(0, 50),
        criticalMisses: report.criticalMisses.slice(0, 50),
      },
    });
  } catch (err) {
    console.error('[label-stats] failed:', err);
    return res.status(500).json({ error: 'Failed to compute agreement' });
  }
}
