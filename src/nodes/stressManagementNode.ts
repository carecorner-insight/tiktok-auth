import type { CareyBotState } from '../types/state';
import type { NodeResult } from '../types/nodes';
import { getLastUserInput } from '../types/nodes';

interface IAIBotsClient {
  chat(chatId: string | null, text: string, primeMessage?: string): Promise<{ reply: string; chatId: string }>;
}

export function makeStressManagementNode(aiBotsClient: IAIBotsClient) {
  return async function stressManagementNode(state: CareyBotState): Promise<NodeResult> {
    const userText = getLastUserInput(state);

    const primeMessage = !state.aiBotChatId
      ? `[SYSTEM CONTEXT] The user has already completed the CareyBot intake screening. ` +
        `Risk level: ${state.tag ?? 'low'}. They have chosen to learn ways to manage stress. ` +
        `You are now in State 4 (Regulation). ` +
        `Do not run triage or screener. Begin with ONE stress management technique.`
      : undefined;

    const result = await aiBotsClient.chat(state.aiBotChatId, userText, primeMessage);
    return {
      aiBotChatId: result.chatId,
      pendingResponse: result.reply,
      conversationPhase: 'ended',
    };
  };
}
