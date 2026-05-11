import type { CareyBotState } from '@/types/state';
import type { NodeResult } from '@/types/nodes';
import type { Message } from '@/types/state';

interface IAIBotsClient {
  chat(messages: Message[]): Promise<string>;
}

export function makeWellbeingCheckNode(aiBotsClient: IAIBotsClient) {
  return async function wellbeingCheckNode(state: CareyBotState): Promise<NodeResult> {
    const reply = await aiBotsClient.chat(state.messages);
    return {
      pendingResponse: reply,
      conversationPhase: 'ended',
    };
  };
}
