import type { VercelRequest, VercelResponse } from '@vercel/node';

export const config = { runtime: 'nodejs' };

interface RegistrationPayload {
  userId: string;
  platform: 'tiktok' | 'telegram';
  name: string;
  email: string;
}

function isValidPayload(body: unknown): body is RegistrationPayload {
  if (!body || typeof body !== 'object') return false;
  const b = body as Record<string, unknown>;
  return (
    typeof b['userId'] === 'string' && b['userId'].length > 0 &&
    (b['platform'] === 'tiktok' || b['platform'] === 'telegram') &&
    typeof b['name'] === 'string' && b['name'].length > 0 &&
    typeof b['email'] === 'string' && b['email'].includes('@')
  );
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'GET') {
    return res.status(200).json({ ok: true, message: 'Registration endpoint is running' });
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  if (!isValidPayload(req.body)) {
    return res.status(400).json({
      error: 'Missing or invalid fields: userId, platform (tiktok|telegram), name, email',
    });
  }

  const webhookUrl = process.env.POWER_AUTOMATE_WEBHOOK_URL;
  if (!webhookUrl) {
    console.error('[register] POWER_AUTOMATE_WEBHOOK_URL is not set');
    return res.status(503).json({ error: 'Registration service unavailable' });
  }

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        type: 'registration',
        userId: req.body.userId,
        platform: req.body.platform,
        name: req.body.name,
        email: req.body.email,
        registeredAt: new Date().toISOString(),
      }),
    });

    if (!response.ok) {
      console.error('[register] Power Automate returned', response.status);
      return res.status(502).json({ error: 'Failed to submit registration' });
    }

    return res.status(200).json({
      ok: true,
      message: 'Registration submitted. An admin will review and approve your access.',
    });
  } catch (err) {
    console.error('[register] fetch error:', err);
    return res.status(500).json({ error: 'Internal server error' });
  }
}
