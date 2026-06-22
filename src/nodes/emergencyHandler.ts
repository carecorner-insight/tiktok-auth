import type { CareyBotState } from '../types/state';
import type { NodeResult } from '../types/nodes';
import { EMERGENCY_MESSAGE } from '../config/questionnaire';
import { parseCrisisReply } from '../lib/crisisDetection';

interface IAIBotsClient {
  chat(chatId: string | null, text: string, primeMessage?: string, history?: Array<{ role: 'user' | 'assistant'; content: string }>): Promise<{ reply: string; chatId: string }>;
}

interface ITypingIndicator {
  sendTypingIndicator(userId: string): Promise<void>;
}

export function makeEmergencyHandler(aiBotsClient: IAIBotsClient, typing: ITypingIndicator) {
  return async function emergencyHandler(state: CareyBotState): Promise<NodeResult> {
    // First crisis turn: send the static hotline message immediately, no AI call.
    // Subsequent turns (phase already 'crisis'): hand off to AIBots for ongoing support.
    if (state.conversationPhase !== 'crisis') {
      return {
        pendingResponse: EMERGENCY_MESSAGE,
        conversationPhase: 'crisis',
        crisisDetected: true,
      };
    }

    const primeMessage = !state.aiBotChatId
      ? `[SYSTEM CONTEXT] This is a crisis support conversation. ` +
        `The user has been identified as high risk and has already received emergency hotline information. ` +
        `You are in State 8 (Crisis Routing). ` +
        `Do not run triage or screener. Do not reference previous sessions. ` +
        `Your role is to keep the user engaged, validate their feelings, and gently reinforce ` +
        `that they should reach out to 1771 (National Mindline) or 995 for immediate danger. ` +
        `Do not remind too incessantly about the hotlines, but do look for cues that they may be in crisis and gently nudge them to use those resources if they haven't already. ` +
        `Stay calm, warm, and present. Do not end the conversation.`
      : undefined;

    await typing.sendTypingIndicator(state.userId);
    const typingInterval = setInterval(() => {
      typing.sendTypingIndicator(state.userId).catch(() => {});
    }, 4000);

    const textForAI = !state.aiBotChatId ? 'Hi' : state.messages[state.messages.length - 1]?.content ?? 'Hi';
    // history = all messages except the current user message (last entry)
    const history = state.messages.slice(0, -1);
    try {
      const result = await aiBotsClient.chat(state.aiBotChatId, textForAI, primeMessage, history);
      // Already in crisis — we only strip the tag, the isCrisis flag is moot here.
      const { reply } = parseCrisisReply(result.reply);
      return {
        aiBotChatId: result.chatId,
        pendingResponse: reply,
        conversationPhase: 'crisis',
        crisisDetected: true,
      };
    } finally {
      clearInterval(typingInterval);
    }
  };
}
