import type { CareyBotState } from '../types/state';
import type { NodeResult } from '../types/nodes';
import { EMERGENCY_MESSAGE } from '../config/questionnaire';
import { parseCrisisReply } from '../lib/crisisDetection';
import { staticFirstCrisis } from '../lib/pivotFlags';

interface IAIBotsClient {
  chat(chatId: string | null, text: string, primeMessage?: string, history?: Array<{ role: 'user' | 'assistant'; content: string }>): Promise<{ reply: string; chatId: string }>;
}

interface ITypingIndicator {
  sendTypingIndicator(userId: string): Promise<void>;
}

export function makeEmergencyHandler(aiBotsClient: IAIBotsClient, typing: ITypingIndicator) {
  return async function emergencyHandler(state: CareyBotState): Promise<NodeResult> {
    // ── F3: static-first crisis ──────────────────────────────────────────────
    // The FIRST crisis turn uses the configured static wording, produced
    // with no generative model at all. This is the pivot's answer to the
    // governance concern about an LLM being the primary handler of self-harm
    // disclosures. Follow-up turns (already in the crisis phase) fall through
    // to the AI path below so the bot can stay with the user.
    const isFirstCrisisTurn = state.conversationPhase !== 'crisis';
    if (staticFirstCrisis() && isFirstCrisisTurn) {
      return {
        pendingResponse: EMERGENCY_MESSAGE,
        conversationPhase: 'crisis',
        crisisDetected: true,
        // The prior ID may belong to a different bot/provider. A follow-up
        // creates the crisis session using the retained transcript.
        aiBotChatId: null,
      };
    }

    // AI-generated crisis response with a GUARANTEED static-hotline fallback, so
    // 1771 is never lost — regardless of which phase routed us here (screener,
    // safety gate, intent label, the router's crisis backstop, or an ongoing
    // crisis) or whether AIBots is reachable. Session creation alone must not
    // restart a conversation whose static safety message has already been sent.
    const isFreshCrisisSession = !state.aiBotChatId;

    const primeMessage = isFreshCrisisSession
      ? `[SYSTEM CONTEXT] Continue crisis support from the conversation history and latest answer. ` +
        `The user has been identified as high risk. Do not run triage or a screener, introduce yourself, ` +
        `or repeat answered questions. The platform may already have sent the static safety message. ` +
        `Clearly and calmly surface the crisis resources when needed — National Mindline ` +
        `1771, and 995 for immediate danger — validate their feelings, and keep them gently engaged. ` +
        `Do not remind too incessantly about the hotlines once given. Stay warm and present; do not end the conversation.`
      : undefined;

    await typing.sendTypingIndicator(state.userId);
    const typingInterval = setInterval(() => {
      typing.sendTypingIndicator(state.userId).catch(() => {});
    }, 4000);

    const textForAI = [...state.messages].reverse().find(m => m.role === 'user')?.content ?? '';
    const history = state.messages.slice(0, -1);
    try {
      const result = await aiBotsClient.chat(state.aiBotChatId, textForAI, primeMessage, history);
      const { reply } = parseCrisisReply(result.reply);
      return {
        aiBotChatId: result.chatId,
        pendingResponse: reply,
        conversationPhase: 'crisis',
        crisisDetected: true,
      };
    } catch (err) {
      // AIBots unavailable / rate-limited — GUARANTEE the hotline reaches the user.
      console.error('[emergencyHandler] AIBots failed, using static crisis fallback:', err);
      return {
        pendingResponse: EMERGENCY_MESSAGE,
        conversationPhase: 'crisis',
        crisisDetected: true,
      };
    } finally {
      clearInterval(typingInterval);
    }
  };
}
