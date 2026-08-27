import { timingSafeEqual } from 'crypto';
import type { VercelRequest, VercelResponse } from '@vercel/node';

import { getRedis } from '../src/lib/redis';
import {
  getStoredPrompt,
  saveCoachPrompt,
  listPromptHistory,
  validatePromptText,
  PROMPT_MIN_CHARS,
  PROMPT_MAX_CHARS,
} from '../src/lib/promptStore';
import { SOCIAL_COACH_BASE_PROMPT, baseDefinesTagContract } from '../src/config/socialCoachPrompt';
import { coachProvider } from '../src/services/makeSocialCoachClient';

export const config = { runtime: 'nodejs', maxDuration: 15 };

// ── Prompt admin — backs public/prompt-editor.html ───────────────────────────
// Lets the team publish coach-prompt changes without a deploy. Token-gated by
// PROMPT_ADMIN_TOKEN (fails closed: unset → 503). Publishing is a real
// production change, so this token is as sensitive as SIM_TOKEN — hand it only
// to people allowed to change what the live bot says.

function tokenOk(req: VercelRequest): boolean {
  const expected = process.env.PROMPT_ADMIN_TOKEN;
  if (!expected) return false;
  const header = req.headers['x-admin-token'];
  const provided =
    (typeof header === 'string' && header) ||
    (typeof req.query['token'] === 'string' ? (req.query['token'] as string) : '');
  if (!provided) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (!process.env.PROMPT_ADMIN_TOKEN) {
    return res.status(503).json({ error: 'Prompt admin is not enabled on this deployment' });
  }
  if (!tokenOk(req)) {
    return res.status(401).json({ error: 'Unauthorized' });
  }

  const redis = getRedis();

  if (req.method === 'GET') {
    const [live, history] = await Promise.all([getStoredPrompt(redis), listPromptHistory(redis)]);
    return res.status(200).json({
      live, // null → the bundled default prompt is serving
      bundled: {
        chars: SOCIAL_COACH_BASE_PROMPT.length,
        text: live ? undefined : SOCIAL_COACH_BASE_PROMPT,
      },
      limits: { min: PROMPT_MIN_CHARS, max: PROMPT_MAX_CHARS },
      provider: coachProvider(), // 'aibots' → edits here do not reach the model
      dynamicEnabled: process.env.DYNAMIC_COACH_PROMPT !== 'false',
      // Full history records so the page can offer view + restore without
      // another endpoint (20 × prompt ≤ ~1.2MB worst case; fine for admin use).
      history,
    });
  }

  if (req.method === 'POST') {
    const body = (req.body ?? {}) as { text?: unknown; label?: unknown; editor?: unknown };
    const text = typeof body.text === 'string' ? body.text : '';
    const label = typeof body.label === 'string' ? body.label : '';
    const editor = typeof body.editor === 'string' ? body.editor : '';

    if (!label.trim()) return res.status(400).json({ error: 'A short version label is required.' });
    if (!editor.trim()) return res.status(400).json({ error: 'Your name is required — every version records who published it.' });
    const problem = validatePromptText(text);
    if (problem) return res.status(400).json({ error: problem });

    try {
      const saved = await saveCoachPrompt(redis, { text, label, editor });
      console.log(`[prompt-admin] v${saved.version} "${saved.label}" published by ${saved.editor}`);
      return res.status(200).json({
        ok: true,
        version: saved.version,
        savedAt: saved.savedAt,
        tagContractAppended: !baseDefinesTagContract(text),
      });
    } catch (err) {
      return res.status(400).json({ error: err instanceof Error ? err.message : 'Save failed' });
    }
  }

  return res.status(405).json({ error: 'Method not allowed' });
}
