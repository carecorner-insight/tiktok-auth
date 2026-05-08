import fetch from 'node-fetch';
import { redis } from '../utils/redis.js';
import BaseAdapter from '../adapters/BaseAdapter.js';

class TikTokAdapter extends BaseAdapter {
    constructor() {
        super('tiktok');
    }

    parseWebhook(req) {
        const webhookData = req.body
        if (webhookData.event !== 'im_receive_msg') {
            return null;
        }

        let content = {};
        try {
            content = JSON.parse(webhookData.content);
        } catch (e) {
            console.log('Could not parse content:', e);
        }

        return {
            platform: this.platformName,
            messageId: content.message_id,
            conversationId: content.conversation_id,
            userId: webhookData.user_openid,
            text: content.type === 'text' ? content.text.body : null,
            isBotMessage: content.from_user?.role === 'business_account'
        };
    }

    async sendMessage(userId, conversationId, message) {
        const url = 'https://business-api.tiktok.com/open_api/v1.3/business/message/send/';
        const dynamicToken = await redis.get('tiktok_access_token');
        console.log('Sending TikTok message, length:', messageText.length);

        const payload = {
            business_id: userId,
            recipient_type: "CONVERSATION",
            recipient: conversationId,
            message_type: "TEXT",
            text: { body: message }
        };

        const response = await fetch(url, {
            method: 'POST',
            headers: {
            'Content-Type': 'application/json',
            'Access-Token': dynamicToken
            },
            body: JSON.stringify(payload),
            signal: AbortSignal.timeout(10000),
        });

        const data = await response.json();

        if (data.code !== 0) {
            throw new Error(`TikTok API Error: ${data.message}`);
        }

        console.log('TikTok message sent');
            return data;
        }


}