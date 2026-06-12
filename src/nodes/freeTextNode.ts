import type { CareyBotState } from '../types/state';
import type { NodeResult } from '../types/nodes';
import { getLastUserInput } from '../types/nodes';

interface IAIBotsClient {
  chat(chatId: string | null, text: string, primeMessage?: string): Promise<{ reply: string; chatId: string }>;
}

interface ITypingIndicator {
  sendTypingIndicator(userId: string): Promise<void>;
}

// AIBots prefixes its reply with [CRISIS] when it enters State 8 (crisis routing).
const CRISIS_PREFIX = '[CRISIS]';

export function makeFreeTextNode(aiBotsClient: IAIBotsClient, typing: ITypingIndicator) {
  return async function freeTextNode(state: CareyBotState): Promise<NodeResult> {
    const userText = getLastUserInput(state);

    // Only prime new sessions — existing sessions already have context
    const primeMessage = !state.aiBotChatId
      ? `[SYSTEM CONTEXT] This is the start of a new conversation. ` +
        `The user has completed the CareyBot intake screening (risk level: ${state.tag ?? 'low'}) ` +
        `and is now opening a fresh chat to talk about something on their mind. ` +
        `You are entering State 2B (Post-Screener Engagement) for the first time. ` +
        `Do not reference any previous sessions. Do not run triage or screener. ` +
        `Begin with a warm, brief invitation to share.`
      : undefined;

    await typing.sendTypingIndicator(state.userId);
    const typingInterval = setInterval(() => {
      typing.sendTypingIndicator(state.userId).catch(() => {});
    }, 4000);

    const textForAI = !state.aiBotChatId ? 'Hi' : userText;
    try {
      const result = await aiBotsClient.chat(state.aiBotChatId, textForAI, primeMessage);
      const isCrisis = result.reply.trimStart().startsWith(CRISIS_PREFIX);
      const cleanReply = isCrisis
        ? result.reply.trimStart().slice(CRISIS_PREFIX.length).trimStart()
        : result.reply;
      return {
        aiBotChatId: result.chatId,
        pendingResponse: cleanReply,
        ...(isCrisis && { crisisDetected: true, conversationPhase: 'crisis' }),
      };
    } finally {
      clearInterval(typingInterval);
    }
  };
}
