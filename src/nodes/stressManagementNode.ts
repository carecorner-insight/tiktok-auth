import type { CareyBotState } from '@/types/state';
import type { NodeResult } from '@/types/nodes';
import type { AIBotsClient } from '@/services/aiBotsClient';

export function makeStressManagementNode(aiBotsClient: AIBotsClient) {
  return async function stressManagementNode(state: CareyBotState): Promise<NodeResult> {
    const reply = await aiBotsClient.chat(state.messages);
    return {
      pendingResponse: reply,
      conversationPhase: 'ended',
    };
  };
}
