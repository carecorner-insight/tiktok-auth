import type { CareyBotState } from '../types/state';
import type { NodeResult } from '../types/nodes';
import { getLastUserInput } from '../types/nodes';

interface IAIBotsClient {
  chat(chatId: string | null, text: string): Promise<{ reply: string; chatId: string }>;
}

export function makeStressManagementNode(aiBotsClient: IAIBotsClient) {
  return async function stressManagementNode(state: CareyBotState): Promise<NodeResult> {
    const userText = getLastUserInput(state);
    const result = await aiBotsCli  ent.chat(state.aiBotChatId, userText);
    return {
      aiBotChatId: result.chatId,
      pendingResponse: result.reply,
      selectedOption: 3,
      conversationPhase: 'option',
    };
  };
}
