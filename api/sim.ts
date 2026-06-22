import { timingSafeEqual } from 'crypto';
import type { VercelRequest, VercelResponse } from '@vercel/node';

import { getRedis } from '../src/lib/redis';
import { processMessage } from '../src/graph/runner';
import { SessionManager } from '../src/services/sessionManager';
import { AIBotsClient } from '../src/services/aiBotsClient';
import { DifyClient } from '../src/services/difyClient';
import { FallbackAIClient } from '../src/services/fallbackAIClient';
import type { NormalizedMessage } from '../src/types/platform';
import type { Platform } from '../src/types/state';

export const config = { runtime: 'nodejs', maxDuration: 60 };

// ── Synchronous simulation endpoint ───────────────────────────────────────────
// Runs the SAME graph as the webhook, against the deployment's real services
// (Redis, AIBots via the whitelisted IP, the full static questionnaire), but
// returns Carey's reply directly in the HTTP response instead of pushing it to
// a platform. Unlike the webhook this is NOT fire-and-forget, so a script can
// read each turn.
//
// SECURITY: off by default. Active only when SIM_TOKEN is set, and every call
// must present that token. It force-authorizes the caller and can drive the AI
// as any user, so treat SIM_TOKEN as a secret and unset it after UAT.

function tokenMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  const expected = process.env.SIM_TOKEN;
  if (!expected) {
    return res.status(503).json({ error: 'Simulation endpoint is disabled' });
  }
  const provided =
    typeof req.headers['x-sim-token'] === 'string' ? req.headers['x-sim-token'] : '';
  if (!provided || !tokenMatches(provided, expected)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const body = (req.body ?? {}) as {
    platform?: string;
    userId?: string;
    text?: string;
    reset?: boolean;
  };
  const platform: Platform = body.platform === 'tiktok' ? 'tiktok' : 'telegram';
  const userId = typeof body.userId === 'string' ? body.userId.trim() : '';
  const text = typeof body.text === 'string' ? body.text : '';

  if (!userId) {
    return res.status(400).json({ error: 'userId is required' });
  }

  const redis = getRedis();
  const session = new SessionManager(redis);

  // Start a fresh conversation when requested (e.g. turn 0 of a run).
  if (body.reset) {
    await session.clear(platform, userId);
  }

  const services = {
    // Force-authorized: the simulator uses synthetic user IDs that aren't in the
    // SharePoint whitelist. This exercises the conversation flow, not RBAC.
    whitelist: { isAuthorized: async () => true },
    session,
    aiBots: new FallbackAIClient(
      new AIBotsClient(
        process.env.DIRECTUS_CREATE_CHAT_URL ?? '',
        process.env.DIRECTUS_SEND_MESSAGE_URL ?? '',
      ),
      new DifyClient(
        process.env.DIFY_API_URL ?? '',
        process.env.DIFY_API_KEY ?? '',
      ),
    ),
    typing: { sendTypingIndicator: async () => {} },
  };

  const msg: NormalizedMessage = {
    platform,
    userId,
    text,
    timestamp: Date.now(),
    raw: {},
  };

  try {
    const result = await processMessage(msg, services);
    return res.status(200).json({
      response: result.response,
      state: {
        conversationPhase: result.state.conversationPhase,
        questionIndex: result.state.questionIndex,
        tag: result.state.tag,
        crisisDetected: result.state.crisisDetected,
        selectedOption: result.state.selectedOption,
        isAuthorized: result.state.isAuthorized,
      },
    });
  } catch (err) {
    console.error('[sim] processMessage failed:', err);
    return res.status(500).json({ error: 'processMessage failed', detail: String(err) });
  }
}
