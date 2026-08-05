import { timingSafeEqual } from 'crypto';
import type { VercelRequest, VercelResponse } from '@vercel/node';

import { getRedis } from '../src/lib/redis';
import { makeLabelerService } from '../src/services/labelerService';
import {
  readUnits,
  readHumanLabels,
  pushUnits,
  queueFor,
  type StoredUnit,
} from '../src/lib/labelStore';
import { RUBRIC_DIMENSIONS, JUDGE_VERSION } from '../src/config/judgeRubric';

export const config = { runtime: 'nodejs', maxDuration: 30 };

const DEFAULT_LIMIT = 25;

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

/**
 * GET — the review queue for the authenticated labeler: replies they have not
 * yet labelled, each with the judge's proposed verdict for confirm/override.
 */
async function handleGet(req: VercelRequest, res: VercelResponse) {
  const limitRaw = req.query['limit'];
  const limit = Math.min(
    100,
    Math.max(1, typeof limitRaw === 'string' ? parseInt(limitRaw, 10) || DEFAULT_LIMIT : DEFAULT_LIMIT),
  );

  try {
    const redis = getRedis();
    const labeler = await makeLabelerService(redis).resolve(readHeader(req, 'x-labeler-token'));
    if (!labeler) return res.status(401).json({ error: 'Unauthorized' });

    res.setHeader('Cache-Control', 'no-store');
    const [units, labels] = await Promise.all([readUnits(redis), readHumanLabels(redis)]);
    const mine = labels.filter(l => l.labelerId === labeler.id);

    return res.status(200).json({
      labeler: { name: labeler.name, id: labeler.id },
      judgeVersion: JUDGE_VERSION,
      rubric: RUBRIC_DIMENSIONS,
      stats: { corpus: units.length, labelledByMe: mine.length, totalLabels: labels.length },
      queue: queueFor(units, labels, labeler.id, limit),
    });
  } catch (err) {
    console.error('[label-queue] read failed:', err);
    return res.status(500).json({ error: 'Failed to read queue' });
  }
}

/**
 * POST — machine ingest (the batch judge script), gated by SIM_TOKEN.
 * Body: { units: StoredUnit[] }. Already-present replyKeys are skipped.
 */
async function handlePost(req: VercelRequest, res: VercelResponse) {
  const expected = process.env.SIM_TOKEN;
  if (!expected) return res.status(503).json({ error: 'Ingest is disabled' });
  const provided = readHeader(req, 'x-sim-token');
  if (!provided || !tokenMatches(provided, expected)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const body = (req.body ?? {}) as { units?: unknown };
  if (!Array.isArray(body.units)) {
    return res.status(400).json({ error: 'units[] is required' });
  }

  try {
    const added = await pushUnits(getRedis(), body.units as StoredUnit[]);
    return res.status(200).json({ ok: true, received: body.units.length, added });
  } catch (err) {
    console.error('[label-queue] ingest failed:', err);
    return res.status(500).json({ error: 'Failed to store units' });
  }
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'GET') return handleGet(req, res);
  if (req.method === 'POST') return handlePost(req, res);
  return res.status(405).json({ error: 'Method not allowed' });
}
