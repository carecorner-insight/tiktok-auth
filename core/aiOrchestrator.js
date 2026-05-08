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

async function handleIncomingMessage(webhookData, content) {
    // Start the master clock
    const totalStartTime = performance.now(); 
    
    const messageId = content.message_id;
    const conversationId = content.conversation_id;
    const userMessage = content.text.body;

    if (!messageId) {
        console.log('⚠️ No message_id found, skipping');
        return;
    }

    // --- MEASUREMENT 1: Redis Latency ---
    const redisStartTime = performance.now();
    const isNewMessage = await redis.set(`lock:${messageId}`, 'processed', 'EX', 3600, 'NX');
    console.log(`⏱️ [1] Redis Dedup took: ${(performance.now() - redisStartTime).toFixed(2)}ms`);

    if (!isNewMessage) {
        console.log('⚠️ Duplicate message, skipping:', messageId);
        return;
    }

    console.log('📨 Incoming message from:', content.from);
    console.log('Conversation ID:', conversationId);

    if (content.from_user?.role === 'business_account') {
        return;
    }

    if (content.type !== 'text') {
        return;
    }

    const staticReply = getStaticResponse(userMessage);
    if (staticReply) {
        const staticSendStartTime = performance.now();
        await sendTikTokMessage(webhookData.user_openid, conversationId, staticReply);
        console.log(`⏱️ [Static] TikTok Send took: ${(performance.now() - staticSendStartTime).toFixed(2)}ms`);
        console.log(`🏁 [Static] Total Execution time: ${(performance.now() - totalStartTime).toFixed(2)}ms`);
        return;
    }

    try {
        // --- MEASUREMENT 2: Typing Indicator Latency ---
        const typingStartTime = performance.now();
        const [_, reply] = await Promise.all([
        sendTypingIndicator(webhookData.user_openid, conversationId).catch(e => console.error("Typing indicator failed", e)),
        getAIResponse(conversationId, userMessage)
        ]);
        console.log(`⏱️ [3] AI Generation (AIBot/Dify) took: ${(performance.now() - typingStartTime).toFixed(2)}ms`);

        // --- MEASUREMENT 4: Async Background Task ---
        waitUntil((async () => {
        const asyncStartTime = performance.now();
        const tag = await tagMessage(userMessage);
        await logToGoogleSheets(conversationId, content.from, userMessage, reply, tag);
        console.log(`⏱️ [Async] Tagging & Google Sheets log took: ${(performance.now() - asyncStartTime).toFixed(2)}ms`);
        })());

        // --- MEASUREMENT 5: TikTok Reply Latency ---
        const sendStartTime = performance.now();
        await sendTikTokMessage(webhookData.user_openid, conversationId, reply);
        console.log(`⏱️ [4] TikTok Reply Send took: ${(performance.now() - sendStartTime).toFixed(2)}ms`);

        // Stop the master clock
        console.log(`🏁 [AI] Total Execution time: ${(performance.now() - totalStartTime).toFixed(2)}ms`);

    } catch (error) {
        console.error(`❌ All AI options failed after ${(performance.now() - totalStartTime).toFixed(2)}ms. Error:`, error.message);
        await sendTikTokMessage(
        webhookData.user_openid,
        conversationId,
        "I'm having trouble processing your message right now. Please try again in a moment."
        );
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