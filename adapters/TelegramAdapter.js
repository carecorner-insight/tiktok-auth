import { BaseAdapter } from './BaseAdapter.js';

export class TelegramAdapter extends BaseAdapter {
    constructor() {
        super('telegram');
        this.botToken = process.env.TELEGRAM_BOT_TOKEN;
        this.apiUrl = `https://api.telegram.org/bot${this.botToken}`;
    }

    parseWebhook(req) {
        const update = req.body;

        // Ignore non-text messages (like images, button clicks, edits)
        if (!update.message || !update.message.text) {
        return null;
        }

        return {
            platform: this.platformName,
            messageId: update.message.message_id.toString(),
            conversationId: update.message.chat.id.toString(),
            userId: update.message.from.id.toString(),
            text: update.message.text,
            isBotMessage: update.message.from.is_bot === true
        };
    }

    async sendMessage(userId, conversationId, text) {
        const url = `${this.apiUrl}/sendMessage`;
        
        const response = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            chat_id: conversationId, // Telegram routes by chat_id
            text: text
        }),
        signal: AbortSignal.timeout(10000),
        });

        const data = await response.json();
        
        if (!data.ok) {
        throw new Error(`Telegram Send Error: ${data.description}`);
        }
        
        console.log('✅ Telegram message sent');
    }

    async sendTypingIndicator(userId, conversationId) {
        const url = `${this.apiUrl}/sendChatAction`;
        
        try {
        const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
            chat_id: conversationId,
            action: 'typing' // This triggers the "... is typing" UI
            }),
            signal: AbortSignal.timeout(5000),
        });

        const data = await response.json();
        if (data.ok) {
            console.log('✅ Telegram typing indicator sent');
        } else {
            console.warn('⚠️ Telegram typing indicator failed:', data.description);
        }
        } catch (error) {
        // We catch and log this instead of throwing, because if the typing 
        // indicator fails, we still want the bot to try sending the actual message.
            console.warn('⚠️ Telegram typing indicator network error:', error.message);
        }
    }
}