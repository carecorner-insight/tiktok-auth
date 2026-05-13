import type { CareyBotState } from '../types/state';
import type { NodeResult } from '../types/nodes';
import { getLastUserInput } from '../types/nodes';

interface IAIBotsClient {
  chat(chatId: string | null, text: string): Promise<{ reply: string; chatId: string }>;
}

// AIBots prefixes its reply with [CRISIS] when it enters State 8 (crisis routing).
const CRISIS_PREFIX = '[CRISIS]';

export function makeFreeTextNode(aiBotsClient: IAIBotsClient) {
  return async function freeTextNode(state: CareyBotState): Promise<NodeResult> {
    const userText = getLastUserInput(state);
    const result = await aiBotsClient.chat(state.aiBotChatId, userText);

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
