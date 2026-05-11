import type { VercelRequest, VercelResponse } from '@vercel/node';

import { getRedis } from '../../src/lib/redis';

export const config = { runtime: 'nodejs' };

const TIKTOK_REFRESH_URL =
  'https://business-api.tiktok.com/open_api/v1.3/tt_user/oauth2/refresh_token/';

export default async function handler(_req: VercelRequest, res: VercelResponse) {
  const redis = getRedis();

  const refreshToken = await redis.get('tiktok_refresh_token');
  if (!refreshToken) {
    console.error('[tiktokToken] No refresh token in Redis');
    return res.status(400).json({ error: 'No refresh token found' });
  }

  let response: Response;
  try {
    response = await fetch(TIKTOK_REFRESH_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        client_key: process.env.TIKTOK_CLIENT_KEY,
        client_secret: process.env.TIKTOK_CLIENT_SECRET,
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
      }),
    });
  } catch (err) {
    console.error('[tiktokToken] Network error:', err);
    return res.status(502).json({ error: 'TikTok API unreachable' });
  }

  const result = (await response.json()) as {
    code: number;
    data?: { access_token: string; refresh_token: string };
    message?: string;
  };

  if (result.code !== 0 || !result.data) {
    console.error('[tiktokToken] TikTok rejected refresh:', result.message);
    return res.status(400).json({ error: 'TikTok rejected the refresh', details: result });
  }

  await Promise.all([
    redis.set('tiktok_access_token', result.data.access_token),
    redis.set('tiktok_refresh_token', result.data.refresh_token),
  ]);

  console.log('[tiktokToken] Tokens rotated successfully');
  return res.status(200).json({ ok: true, message: 'Tokens rotated' });
}
