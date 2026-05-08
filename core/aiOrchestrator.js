import { waitUntil } from '@vercel/functions';
import { redis } from '../utils/redis.js';

const CREATE_CHAT_URL = "https://carelytics.sdnim.com/api/flows/trigger/0dc3a82d-1e76-408e-b4f9-cced0f5d9fc2";
const SEND_MESSAGE_URL = "https://carelytics.sdnim.com/api/flows/trigger/e33fcc9c-555e-4b1b-af74-ef6f229f46e4";

const DIFY_API_URL = process.env.DIFY_API_URL;
const DIFY_API_KEY = process.env.DIFY_API_KEY;

const MAX_HISTORY = 20; // 10 exchanges
const MAX_REPLAY = 10;  // max messages to replay into AIBot on recovery

// ─── HISTORY HELPERS ──────────────────────────────────────────────────────────

async function saveToHistory(conversationId, userMessage, assistantReply, handledBy) {
    try {
        const key = `history:${conversationId}`;
        const existing = await redis.get(key);
        const history = existing ? JSON.parse(existing) : [];

        history.push({ role: 'user', content: userMessage, handledBy });
        history.push({ role: 'assistant', content: assistantReply, handledBy });

        // Keep only last MAX_HISTORY messages
        if (history.length > MAX_HISTORY) {
        history.splice(0, history.length - MAX_HISTORY);
        }

        await redis.set(key, JSON.stringify(history), 'EX', 21600); // 6 hours
        console.log(`💾 Saved to history (${handledBy}), total messages: ${history.length}`);
    } catch (error) {
        console.error('⚠️ Failed to save history:', error.message);
    }
}

async function getHistory(conversationId) {
    try {
        const key = `history:${conversationId}`;
        const existing = await redis.get(key);
        return existing ? JSON.parse(existing) : [];
    } catch (error) {
        console.error('⚠️ Failed to get history:', error.message);
        return [];
    }
}
// ─── LOG TO GOOGLE SHEETS ──────────────────────────────────────────────────
async function logToGoogleSheets(conversationId, from, userMessage, aiResponse, tag = '') {
    try {
        const { GoogleAuth } = require('google-auth-library');
        const { google } = require('googleapis');

        const auth = new GoogleAuth({
        credentials: {
            client_email: process.env.GOOGLE_CLIENT_EMAIL,
            private_key: process.env.GOOGLE_PRIVATE_KEY.replace(/\\n/g, '\n'),
        },
        scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        });

        const sheets = google.sheets({ version: 'v4', auth });
        const timestamp = new Date().toLocaleString('en-GB', {
            timeZone: 'Asia/Singapore',
            day: '2-digit',
            month: '2-digit',
            year: 'numeric',
            hour: '2-digit',
            minute: '2-digit',
            second: '2-digit',
            hour12: true,
        });

        await sheets.spreadsheets.values.append({
            spreadsheetId: process.env.SPREADSHEET_ID,
            range: 'Raw_data!A:E',
            valueInputOption: 'RAW',
            requestBody: {
                values: [[conversationId, from, userMessage, aiResponse, timestamp, tag]],
            },
        });

        console.log('✅ Logged to Google Sheets');
    } catch (error) {
        console.error('⚠️ Failed to log to Google Sheets:', error.message);
    }
}

export async function logToSharePoint(conversationId, userId, userMessage, aiResponse, tag = '', platform = '') {
    try {
        const WEBHOOK_URL = process.env.POWER_AUTOMATE_WEBHOOK_URL;

        if (!WEBHOOK_URL) {
            throw new Error('POWER_AUTOMATE_WEBHOOK_URL is missing from environment variables');
        }

        // Create the exact payload Power Automate is expecting
        const payload = {
            conversationId: conversationId.toString(),
            userId: userId.toString(),
            userMessage: userMessage,
            aiResponse: aiResponse,
            timestamp: new Date().toISOString(), 
            tag: tag,
            platform: platform
        };

        const response = await fetch(WEBHOOK_URL, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
            },
            body: JSON.stringify(payload),
            // 5-second timeout ensures this background task never stalls the Vercel instance
            signal: AbortSignal.timeout(5000), 
        });

        if (!response.ok) {
            throw new Error(`Power Automate rejected the payload: HTTP ${response.status}`);
        }

        console.log('✅ Logged to SharePoint via Power Automate');
    } catch (error) {
        console.error('⚠️ Failed to log to SharePoint:', error.message);
    }
}

// -── TAGGING WITH DIFY ─────────────────────────────────────────────────────
async function tagMessage(userMessage) {
    try {
        const response = await fetch('https://api.dify.ai/v1/chat-messages', {
            method: 'POST',
            headers: {
                'Authorization': `Bearer ${process.env.DIFY_TAGGING_API_KEY}`,
                'Content-Type': 'application/json',
            },
            body: JSON.stringify({
                inputs: {},
                query: userMessage,
                response_mode: 'blocking',
                conversation_id: '',
                user: 'tagging-bot',
            }),
            signal: AbortSignal.timeout(30000),
        });

        if (!response.ok) throw new Error(`Tagging Dify error: ${response.status}`);

        const data = await response.json();
        const tag = data.answer?.trim().toLowerCase();

        if (['high risk', 'moderate risk', 'low risk'].includes(tag)) {
            return tag;
        }

        console.warn('⚠️ Unexpected tag value:', tag);
        return 'untagged';
    } catch (error) {
        console.error('⚠️ Tagging failed:', error.message);
        return 'untagged';
    }
}

/**
 * The core AI router. Completely platform-agnostic.
 * * @param {Object} adapter - The instantiated platform adapter (e.g., TikTokAdapter, TelegramAdapter)
 * @param {Object} message - The normalized message object created by adapter.parseWebhook()
 */
export async function handleIncomingMessage(adapter, message) {
    const { messageId, conversationId, userId, text, isBotMessage, platform } = message;

    // 1. Guard Clauses: Ignore invalid payloads or bot-loop messages
    if (!messageId || !text || isBotMessage) {
        return;
    }

    // 2. Global Deduplication Lock (Crucial for at-least-once webhook delivery)
    const isNewMessage = await redis.set(`lock:${messageId}`, 'processed', 'EX', 3600, 'NX');
    if (!isNewMessage) {
        console.log(`⚠️ [${platform}] Duplicate message skipped: ${messageId}`);
        return;
    }

    console.log(`📨 [${platform.toUpperCase()}] Incoming from ${userId}: "${text.substring(0, 20)}..."`);

    // 3. Static Triggers (Fast Path)


    try {
        // 4. Start AI Generation & Typing Indicator concurrently
        // We catch the typing indicator error so a network blip doesn't kill the whole AI process
        const [_, reply] = await Promise.all([
        adapter.sendTypingIndicator(userId, conversationId).catch(e => 
            console.warn(`⚠️ [${platform}] Typing indicator failed:`, e.message)
        ),
        getAIResponse(conversationId, text)
        ]);

        // 5. Background Tasks (Tagging & Logging)
        // waitUntil ensures Vercel doesn't kill the background task after we respond to the user
        waitUntil((async () => {
        try {
            const tag = await tagMessage(text);
            await logToSharePoint(conversationId, userId, text, reply, tag, platform);
        } catch (analyticsError) {
            console.error('⚠️ Analytics background task failed:', analyticsError.message);
        }
        })());

        // 6. Send Final AI Reply
        await adapter.sendMessage(userId, conversationId, reply);
        console.log(`✅ [${platform}] AI Reply sent successfully.`);

    } catch (error) {
        console.error(`❌ [${platform}] Critical AI Processing Failure:`, error.message);
        
        // Fallback: Gracefully tell the user the bot is struggling
        try {
        await adapter.sendMessage(
            userId, 
            conversationId, 
            "I'm having trouble processing your message right now. Please try again in a moment."
        );
        } catch (fallbackError) {
        console.error(`🚨 [${platform}] Even the fallback message failed:`, fallbackError.message);
        }
    }
    }

    // ─── AIBOT ────────────────────────────────────────────────────────────────────

    async function createAIChat() {
    console.log('🤖 Creating AIBot chat session...');

    const response = await fetch(CREATE_CHAT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: "azure~openai.gpt-5-2-chat"}),
        signal: AbortSignal.timeout(10000),
    });

    if (!response.ok) {
        throw new Error(`createAIChat failed: ${response.status}`);
    }

    const data = await response.json();

    if (!data.id) {
        throw new Error('createAIChat returned no ID');
    }

    console.log('✅ AIBot chat created, ID:', data.id);
    return data.id;
}

async function sendMessageToAI(chatId, message) {
  console.log('💬 Sending to AIBot - Chat ID:', chatId);

  const response = await fetch(SEND_MESSAGE_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ content: message, chat_id: chatId }),
    signal: AbortSignal.timeout(50000),
  });

  if (!response.ok) {
    throw new Error(`sendMessageToAI failed: ${response.status}`);
  }

  const data = await response.json();

  if (data.response?.content) return data.response.content;
  if (data.response) return data.response;

  console.warn('⚠️ Unexpected AIBot response format:', data);
  throw new Error('Unexpected AIBot response format');
}

// ─── MAIN AI CALL WITH DIFY FALLBACK ─────────────────────────────────────────

async function getAIResponse(conversationId, userMessage) {
    try {
        // Step 1: Get or create AIBot session
        let aiChatId = await redis.get(`session:${conversationId}`);

        if (!aiChatId) {
            console.log('No AIBot session found, creating one...');
            aiChatId = await createAIChat();
            await redis.set(`session:${conversationId}`, aiChatId, 'EX', 21600);
        }

        // Step 2: Check if AIBot missed any Dify messages and replay them
        const history = await getHistory(conversationId);
        const lastAibotIndex = history.map(m => m.handledBy).lastIndexOf('aibot');
        const missedByAibot = history
        .slice(lastAibotIndex + 1)
        .filter(m => m.handledBy === 'dify')
        .slice(-MAX_REPLAY); // cap at last 10

        if (missedByAibot.length > 0) {
            console.log(`🔁 Replaying ${missedByAibot.length} missed Dify messages into AIBot...`);

            for (const msg of missedByAibot) {
                if (msg.role === 'user') {
                    try {
                        await sendMessageToAI(aiChatId, msg.content);
                        console.log('✅ Replayed message into AIBot:', msg.content.slice(0, 50));
                    } catch (replayError) {
                        console.error('⚠️ Failed to replay message into AIBot:', replayError.message);
                        // If replay itself fails, AIBot is still down — throw to trigger Dify fallback
                        throw replayError;
                    }
                }
            }
                console.log('✅ AIBot caught up on missed Dify messages');
            }

        // Step 3: Send actual user message to AIBot
        const aiResponse = await sendMessageToAI(aiChatId, userMessage);
        console.log('✅ AIBot responded successfully');

        // Step 4: Save to history
        await saveToHistory(conversationId, userMessage, aiResponse, 'aibot');

        return aiResponse;

    } catch (error) {
        console.error('❌ AIBot failed:', error.message);
        console.log('🔄 Routing to Dify fallback...');

        try {
            const difyResponse = await sendMessageToDify(conversationId, userMessage);
            console.log('✅ Dify fallback responded successfully');

            // Save to history as dify
            await saveToHistory(conversationId, userMessage, difyResponse, 'dify');

            return difyResponse;
        } catch (difyError) {
            console.error('❌ Dify fallback also failed:', difyError.message);
            throw new Error('Both AIBot and Dify failed');
        }
    }
}