import { TikTokAdapter } from '../adapters/TikTokAdapter.js';
import { TelegramAdapter } from '../adapters/TelegramAdapter.js';
import { handleIncomingMessage } from '../core/aiOrchestrator.js';
import { waitUntil } from '@vercel/functions';
import { redis } from '../utils/redis.js';

const WHITELIST_CACHE_TTL = 300; // 5 minutes
const REGISTRATION_URL = process.env.REGISTRATION_URL ?? '';

async function fetchWhitelistStatus(platform, userId) {
    const url = process.env.SHAREPOINT_WHITELIST_WEBHOOK_URL;
    if (!url) {
        console.warn('[whitelist] SHAREPOINT_WHITELIST_WEBHOOK_URL is not set — all users will be denied');
        return null;
    }

    const normalizedPlatform = platform.toLowerCase().trim();
    const normalizedUserId = userId.trim();
    console.log(`[whitelist] checking: platform=${normalizedPlatform} userId=${normalizedUserId}`);

    try {
        const res = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ platform: normalizedPlatform, userId: normalizedUserId }),
        });

        console.log(`[whitelist] response status: ${res.status}`);
        if (!res.ok) {
            console.error(`[whitelist] Power Automate returned HTTP ${res.status}`);
            return null;
        }

        const data = await res.json();
        console.log(`[whitelist] raw response: ${JSON.stringify(data)}`);

        const s = data.status?.toLowerCase().trim();
        console.log(`[whitelist] normalised status: "${s}"`);
        return s ?? null;
    } catch (err) {
        console.error('[whitelist] fetch error:', err);
        return null;
    }
}

async function isAuthorized(platform, userId) {
    const key = `whitelist:${platform.toLowerCase().trim()}:${userId.trim()}`;

    const cached = await redis.get(key);
    if (cached !== null) {
        console.log(`[whitelist] cache hit: key=${key} status=${cached}`);
        return cached === 'approved';
    }

    console.log(`[whitelist] cache miss: key=${key} — fetching from SharePoint`);
    const status = await fetchWhitelistStatus(platform, userId);

    if (status) {
        await redis.set(key, status, 'EX', WHITELIST_CACHE_TTL);
        console.log(`[whitelist] cached: key=${key} status=${status} ttl=${WHITELIST_CACHE_TTL}s`);
    } else {
        console.warn(`[whitelist] no status returned for key=${key} — user will be denied`);
    }

    return status === 'approved';
}

export default async function handler(req, res) {
    // 1. Maintenance Mode or Verification GET requests
    if (req.method === 'GET') {
        return res.status(200).send('Webhook is running');
    }

    if (req.method !== 'POST') {
        return res.status(405).send('Method not allowed');
    }

    try {
        console.log("📬 Webhook received with query:", req.query);
        // 2. Figure out which platform sent this webhook using the URL query
        const platform = req.query.platform; // Grabs 'tiktok' or 'telegram' from the URL
        let adapter;

        switch (platform) {
        case 'tiktok':
            adapter = new TikTokAdapter();
            break;
        case 'telegram':
            adapter = new TelegramAdapter();
            break;
        default:
            console.warn(`⚠️ Webhook received from unknown platform: ${platform}`);
            return res.status(400).send('Unknown platform');
        }
        console.log(`✅ Webhook identified as coming from: ${adapter.platformName}`);

        // 3. Use the chosen adapter to translate the messy payload into our standard format
        const normalizedMsg = adapter.parseWebhook(req);
        console.log(`🔄 Normalized message:`, normalizedMsg);

        // 4. Whitelist check
        if (normalizedMsg) {
            const authorized = await isAuthorized(normalizedMsg.platform, normalizedMsg.userId);
            if (!authorized) {
                console.log(`[whitelist] Unauthorized user: ${normalizedMsg.userId} on ${normalizedMsg.platform}`);
                const deniedMsg =
                    `Hi! CareyBot is currently in private access.\n\n` +
                    `To request access, please register at: ${REGISTRATION_URL}\n\n` +
                    `Your User ID is: ${normalizedMsg.userId}`;
                await adapter.sendMessage(normalizedMsg.userId, normalizedMsg.conversationId, deniedMsg);
                return res.status(200).send('OK');
            }
        }

        // 5. If it's a valid text message, pass the adapter AND the message to the AI
        if (normalizedMsg) {
        // waitUntil ensures Vercel doesn't kill the function while the AI is thinking,
        // but allows us to immediately return the 200 OK to the platform below.
        waitUntil(handleIncomingMessage(adapter, normalizedMsg));
        }

        // 5. Instantly tell TikTok/Telegram "Got it!" so they don't timeout or disable the webhook
        return res.status(200).send('OK');

    } catch (error) {
        console.error('❌ Critical Webhook Router Error:', error);
        // Even on error, return 200 so the platform doesn't penalize your webhook health
        return res.status(200).send('OK'); 
    }
}