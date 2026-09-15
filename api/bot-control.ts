import { timingSafeEqual } from 'crypto';
import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getControlRedis } from '../src/lib/redis';
import { allowedCoachModel, COACH_MODELS, controlScope, MAINTENANCE_NOTICE,
  readBotMode, readCoachModel, setBotMode, setCoachModel } from '../src/lib/botControl';
import { scenarioMenuEnabled } from '../src/lib/pivotFlags';
import { coachProvider } from '../src/services/resolveCoachConfig';

export const config = { runtime: 'nodejs', maxDuration: 15 };

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'GET' && req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });
  const expected = process.env.BOT_CONTROL_TOKEN;
  if (!expected) return res.status(503).json({ error: 'Bot Control is not configured. Ask the project administrator.' });
  const token = req.headers['x-bot-control-token'];
  if (typeof token !== 'string' || token.length > 512 ||
      Buffer.byteLength(token) !== Buffer.byteLength(expected) ||
      !timingSafeEqual(Buffer.from(token), Buffer.from(expected))) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  try {
    const redis = getControlRedis();
    const modelEditable = scenarioMenuEnabled() && coachProvider() === 'direct';
    if (req.method === 'POST') {
      const body: unknown = req.body;
      if (!req.headers['content-type']?.startsWith('application/json') ||
          Number(req.headers['content-length'] ?? 0) > 1024 ||
          !body || typeof body !== 'object' || Array.isArray(body) ||
          Buffer.byteLength(JSON.stringify(body)) > 1024 || Object.keys(body).length !== 1) {
        return res.status(400).json({ error: 'Send exactly one setting as a small JSON object.' });
      }
      if ('enabled' in body && typeof body.enabled === 'boolean') {
        await setBotMode(redis, body.enabled);
      } else if ('model' in body && (body.model === null || allowedCoachModel(body.model))) {
        if (!modelEditable) return res.status(409).json({ error: 'Model selection is only available for direct main coaching.' });
        await setCoachModel(redis, body.model);
      } else return res.status(400).json({ error: 'Invalid mode or unapproved model.' });
    }
    // Read both independently: a corrupt model setting must not prevent OFF.
    const [mode, model] = await Promise.all([
      readBotMode(redis).catch(() => null), readCoachModel(redis).catch(() => null),
    ]);
    const defaultModel = process.env.COACH_MODEL ?? process.env.QWEN_MODEL ?? 'qwen-plus';
    return res.status(200).json({
      scope: controlScope(), environment: process.env.VERCEL_ENV ?? 'development',
      bot: 'Main CareyChats (Telegram and TikTok); study bot excluded',
      mode, model, models: COACH_MODELS, modelEditable,
      effectiveModel: coachProvider() === 'aibots' ? 'externally-managed'
        : modelEditable ? (model ? model.model ?? defaultModel : null) : defaultModel,
      defaultModel, maintenanceNotice: MAINTENANCE_NOTICE,
      deploymentSha: /^[a-f\d]{7,40}$/i.test(process.env.VERCEL_GIT_COMMIT_SHA ?? '') ? process.env.VERCEL_GIT_COMMIT_SHA : null,
    });
  } catch {
    return res.status(503).json({ error: 'Control state is unavailable or the save is unconfirmed. Refresh before retrying.' });
  }
}
