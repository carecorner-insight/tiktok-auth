import { createHash, timingSafeEqual } from 'crypto';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getControlRedis } from '../lib/redis';
import { KpiOutbox, RETENTION_SECONDS } from './outbox';
import { computeMonthlyReport } from './report';
import { collectionEnabled } from './collector';
import { INSIGHT_URL, CREST_URL } from '../config/questionnaire';
import { signReferral, type KpiEvent } from './contract';

function sameSecret(actual: unknown, expected: string | undefined): boolean {
  if (!expected || typeof actual !== 'string') return false;
  const left = Buffer.from(actual);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

/** Private operations and opaque referral links share one function. No raw
 * Telegram IDs, transcript content or signed receiver URLs are ever returned. */
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('Referrer-Policy', 'no-referrer');
  const ref = req.query.ref;
  if ((req.method === 'GET' || req.method === 'HEAD') && typeof ref === 'string') {
    if (!/^[a-f0-9]{32}$/.test(ref)) return res.status(404).end();
    const target = req.query.target;
    const secret = process.env.KPI_USER_KEY_SECRET;
    if (!secret || (target !== 'insight' && target !== 'crest') ||
        !sameSecret(req.query.sig, signReferral(ref, target, secret))) return res.status(404).end();
    const destination = target === 'insight' ? INSIGHT_URL : CREST_URL;
    // Automated previews aren't participant clicks. Other observed GETs remain
    // an imperfect click proxy, explicitly NOT successful help-seeking/conversion.
    if (req.method === 'GET' && !/bot|crawler|spider|preview/i.test(String(req.headers['user-agent'] ?? ''))) {
      try {
        const redis = getControlRedis();
        const outbox = new KpiOutbox(redis, process.env.KPI_POWER_AUTOMATE_WEBHOOK_URL);
        const raw = await redis.get(`kpi:referral:${ref}`);
        const link = raw ? JSON.parse(raw) as { event: KpiEvent } : null;
        if (link) {
          const key = createHash('sha256').update(`click:${ref}`).digest('hex');
          const now = new Date().toISOString();
          const sgt = new Date(Date.now() + 8 * 3600_000).toISOString();
          await outbox.record({ ...link.event, eventId: key, eventType: 'referral_clicked', occurredAt: now, receivedAt: now, monthSGT: sgt.slice(0, 7), dateSGT: sgt.slice(0, 10) });
        }
      } catch { console.error('[kpi] referral-click collection failed; redirect continues'); }
    }
    res.setHeader('Location', destination);
    return res.status(302).end();
  }

  const admin = sameSecret(req.headers['x-bot-control-token'], process.env.BOT_CONTROL_TOKEN);
  const cron = sameSecret(req.headers.authorization, process.env.CRON_SECRET ? `Bearer ${process.env.CRON_SECRET}` : undefined);
  if (!admin && !cron) return res.status(401).json({ error: 'Unauthorized' });
  try {
    const redis = getControlRedis();
    const outbox = new KpiOutbox(redis, process.env.KPI_POWER_AUTOMATE_WEBHOOK_URL);
    if (cron || (req.method === 'POST' && req.query.action === 'flush')) {
      const delivery = await outbox.flush(12);
      await outbox.prune();
      return res.status(200).json({ ...delivery, ...await outbox.status() });
    }
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });
    if (req.query.action === 'export') {
      const offset = Number(req.query.offset ?? 0);
      if (!Number.isSafeInteger(offset) || offset < 0) return res.status(400).json({ error: 'Invalid offset' });
      const events = await outbox.read(Date.now() - RETENTION_SECONDS * 1000, Date.now(), offset);
      return res.status(200).json({ events, nextOffset: events.length === 1000 ? offset + events.length : null });
    }
    if (req.query.action === 'report') {
      const month = String(req.query.month ?? '');
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) return res.status(400).json({ error: 'Use YYYY-MM' });
      const from = Date.parse(`${month}-01T00:00:00+08:00`);
      const asOf = Date.now();
      if (from < asOf - RETENTION_SECONDS * 1000) return res.status(409).json({ error: 'Month is outside retained event coverage; use the Microsoft archive' });
      const events: KpiEvent[] = [];
      for (let offset = 0; offset <= 50000; offset += 1000) {
        const page = await outbox.read(from, asOf, offset);
        if (offset === 50000 && page.length) return res.status(409).json({ error: 'Report exceeds online limit; export and compute offline. No partial report produced.' });
        events.push(...page);
        if (page.length < 1000) break;
      }
      const report = computeMonthlyReport(events, month, asOf, await outbox.priorUsers(from));
      const status = await outbox.status();
      await redis.set(`kpi:report:${month}:${report.revision}`, JSON.stringify(report), { ex: RETENTION_SECONDS });
      return res.status(200).json({ ...report, delivery: status, provisional: true });
    }
    return res.status(200).json({
      enabled: collectionEnabled(), telegramVerificationConfigured: !!process.env.TELEGRAM_WEBHOOK_SECRET,
      identitySecretConfigured: (process.env.KPI_USER_KEY_SECRET?.length ?? 0) >= 32,
      ...await outbox.status(),
    });
  } catch {
    return res.status(503).json({ error: 'KPI storage or receiver unavailable; no partial result returned' });
  }
}
