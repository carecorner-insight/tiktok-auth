import { waitUntil } from '@vercel/functions';
import type { VercelRequest, VercelResponse } from '@vercel/node';

import { applyStudyEnv } from '../src/lib/studyMode';
import { withKeyPrefix } from '../src/lib/prefixedRedis';
import { getRedis } from '../src/lib/redis';
import { TikTokAdapter } from '../src/adapters/tiktok';
import { TelegramAdapter } from '../src/adapters/telegram';
import { handleMessage } from './webhook';
import type { IPlatformAdapter } from '../src/types/platform';
import type { MenuMode } from '../src/lib/menuMode';

export const config = { runtime: 'nodejs', maxDuration: 60 };

// ── NUS-study webhook ─────────────────────────────────────────────────────────
// The deployment's env vars hold the PIVOT configuration; this endpoint serves
// the frozen study bot from the same code by forcing the study flag set onto
// its own function instance (safe: each api/ file is a separate Vercel
// function, and every flag is read per-request — see studyMode.ts).
//
// Point the study bot's Telegram webhook here:
//   /api/webhook-study?platform=telegram
//
// Env vars this endpoint reads (all optional except the first):
//   TELEGRAM_BOT_TOKEN_STUDY         study bot token (falls back to
//                                    TELEGRAM_BOT_TOKEN with a warning)
//   STUDY_POWER_AUTOMATE_WEBHOOK_URL study conversation-log flow (falls back
//                                    to the shared POWER_AUTOMATE_WEBHOOK_URL)
//   STUDY_MENU_MODE                  'numbered' (default) | 'intent'
//   STUDY_<FLAG>                     per-flag overrides, see studyMode.ts
applyStudyEnv();

// Namespaces every Redis key ('study:session:…', 'study:age:…', 'study:lock:…')
// so the two bots' state never collides — a Telegram user has the same numeric
// ID on both bots.
const STUDY_REDIS_PREFIX = 'study:';

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'GET') {
    return res.status(200).json({ ok: true, message: 'Study webhook is running' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const platform = String(req.query['platform'] ?? '');
  const rawRedis = getRedis();
  const redis = withKeyPrefix(rawRedis, STUDY_REDIS_PREFIX);

  let adapter: IPlatformAdapter;

  if (platform === 'tiktok') {
    // The token-refresh cron writes this key unprefixed — read it raw.
    adapter = new TikTokAdapter(async () => {
      const token = await rawRedis.get('tiktok_access_token');
      return token ?? '';
    });
  } else if (platform === 'telegram') {
    const studyToken = process.env.TELEGRAM_BOT_TOKEN_STUDY;
    if (!studyToken) {
      console.warn(
        '[webhook-study] TELEGRAM_BOT_TOKEN_STUDY is not set — falling back to TELEGRAM_BOT_TOKEN',
      );
    }
    adapter = new TelegramAdapter(studyToken ?? process.env.TELEGRAM_BOT_TOKEN ?? '');
  } else {
    console.warn('[webhook-study] Unknown platform:', platform);
    return res.status(200).json({ ok: true }); // ack so the platform doesn't retry
  }

  // The study flow uses the classic numbered menu; the intent-classifier entry
  // is the pivot A/B experiment. Pin it rather than reading the (prefixed,
  // therefore empty) menu-mode key.
  const menuMode: MenuMode = process.env.STUDY_MENU_MODE === 'intent' ? 'intent' : 'numbered';

  // Study conversations log to their own SharePoint flow when configured, so
  // study data can be kept apart from pilot data.
  const logUrl =
    process.env.STUDY_POWER_AUTOMATE_WEBHOOK_URL ??
    process.env.POWER_AUTOMATE_WEBHOOK_URL ??
    null;

  // Respond immediately — platforms will retry if they don't receive 200 quickly
  res.status(200).json({ ok: true });

  waitUntil(handleMessage(adapter, req.body, redis, { menuMode, logUrl }));
}
