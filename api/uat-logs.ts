import { timingSafeEqual } from 'crypto';
import type { VercelRequest, VercelResponse } from '@vercel/node';

import { getRedis } from '../src/lib/redis';
import { readUatLogs, toggleUatLogging } from '../src/lib/uatLog';

export const config = { runtime: 'nodejs' };

function tokenMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'GET' && req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }
  
  const expected = process.env.UAT_LOG_TOKEN;
  if (!expected) {
    return res.status(503).json({ error: 'UAT logging is disabled' });
  }
  const provided =
    (typeof req.query['token'] === 'string' ? req.query['token'] : '') ||
    (typeof req.headers['x-uat-token'] === 'string' ? req.headers['x-uat-token'] : '');

  if (!provided || !tokenMatches(provided, expected)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  if (req.method === 'GET') {
    const sinceRaw = req.query['since'];
    const since =
      typeof sinceRaw === 'string' && sinceRaw !== '' ? Number(sinceRaw) : undefined;
    try {
      const entries = await readUatLogs(getRedis(), Number.isNaN(since) ? undefined : since);
      res.setHeader('Cache-Control', 'no-store');
      return res.status(200).json({ serverTime: Date.now(), entries });
    } catch (err) {
      console.error('[uat-logs] read failed:', err);
      return res.status(500).json({ error: 'Failed to read logs' });
    }
  } else {
    try {
      const enabled = req.body.enabled === true;
      await toggleUatLogging(getRedis(), enabled);
      return res.status(200).json({ success: true });
    } catch (err) {
      console.error('[uat-logs] toggle failed:', err);
      return res.status(500).json({ error: 'Failed to toggle logging' });
    }
  }
}
