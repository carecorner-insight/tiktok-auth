import { TikTokAdapter } from '../adapters/TikTokAdapter.js';
import { TelegramAdapter } from '../adapters/TelegramAdapter.js';
import { handleIncomingMessage } from '../core/aiOrchestrator.js';
import { waitUntil } from '@vercel/functions';

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

        // 4. If it's a valid text message, pass the adapter AND the message to the AI
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