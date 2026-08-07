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
    // The FIRST crisis turn is the exact clinically-approved wording, produced
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
      };
    }

    // AI-generated crisis response with a GUARANTEED static-hotline fallback, so
    // 1771 is never lost — regardless of which phase routed us here (screener,
    // safety gate, intent label, the router's crisis backstop, or an ongoing
    // crisis) or whether AIBots is reachable. A fresh crisis session (no AI chat
    // yet) gets a first-contact prime that surfaces the hotlines explicitly.
    const isFreshCrisisSession = !state.aiBotChatId;

    const primeMessage = isFreshCrisisSession
      ? `[SYSTEM CONTEXT] This is the start of a crisis support conversation (State 8, Crisis Routing). ` +
        `The user has just been identified as high risk. Do not run triage or a screener, and do not ` +
        `reference previous sessions. Clearly and calmly surface the crisis resources — National Mindline ` +
        `1771, and 995 for immediate danger — validate their feelings, and keep them gently engaged. ` +
        `Do not remind too incessantly about the hotlines once given. Stay warm and present; do not end the conversation.`
      : undefined;

    await typing.sendTypingIndicator(state.userId);
    const typingInterval = setInterval(() => {
      typing.sendTypingIndicator(state.userId).catch(() => {});
    }, 4000);

    const textForAI = isFreshCrisisSession
      ? 'Hi'
      : state.messages[state.messages.length - 1]?.content ?? 'Hi';
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
