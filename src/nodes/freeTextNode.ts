import type { CareyBotState } from '../types/state';
import type { NodeResult } from '../types/nodes';
import { getLastUserInput } from '../types/nodes';

interface IAIBotsClient {
  chat(chatId: string | null, text: string, primeMessage?: string): Promise<{ reply: string; chatId: string }>;
}

// AIBots prefixes its reply with [CRISIS] when it enters State 8 (crisis routing).
const CRISIS_PREFIX = '[CRISIS]';

export function makeFreeTextNode(aiBotsClient: IAIBotsClient) {
  return async function freeTextNode(state: CareyBotState): Promise<NodeResult> {
    const userText = getLastUserInput(state);

    // Only prime new sessions — existing sessions already have context
    const primeMessage = !state.aiBotChatId
      ? `[SYSTEM CONTEXT] The user has already completed the CareyBot intake screening. ` +
        `Risk level: ${state.tag ?? 'low'}. They have chosen to talk about something that has been bothering them. ` +
        `You are now in State 2B (Post-Screener Engagement). ` +
        `Do not run triage or screener. Begin with a warm, brief invitation to share.`
      : undefined;

    const textForAI = !state.aiBotChatId ? 'Hi' : userText;
    const result = await aiBotsClient.chat(state.aiBotChatId, textForAI, primeMessage);

    const isCrisis = result.reply.trimStart().startsWith(CRISIS_PREFIX);
    const cleanReply = isCrisis
      ? result.reply.trimStart().slice(CRISIS_PREFIX.length).trimStart()
      : result.reply;

    return {
      aiBotChatId: result.chatId,
      pendingResponse: cleanReply,
      ...(isCrisis && { crisisDetected: true, conversationPhase: 'ended' }),
    };
  };
}
