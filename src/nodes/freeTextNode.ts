import type { CareyBotState, Message } from '@/types/state';
import type { NodeResult } from '@/types/nodes';
import type { AIBotsClient } from '@/services/aiBotsClient';
import { getLastUserInput } from '@/types/nodes';
import { EMERGENCY_MESSAGE } from '@/config/questionnaire';

// AIBots signals a detected crisis with this sentinel in its reply
const CRISIS_SIGNAL = '__CRISIS__';

export function makeFreeTextNode(aiBotsClient: AIBotsClient) {
  return async function freeTextNode(state: CareyBotState): Promise<NodeResult> {
    const userInput = getLastUserInput(state);

    const updatedMessages: Message[] = [
      ...state.messages,
      { role: 'user', content: userInput, timestamp: Date.now() },
    ];

    const reply = await aiBotsClient.chat(updatedMessages);

    if (reply === CRISIS_SIGNAL) {
      return {
        messages: updatedMessages,
        crisisDetected: true,
        conversationPhase: 'ended',
        pendingResponse: EMERGENCY_MESSAGE,
      };
    }

    return {
      messages: [
        ...updatedMessages,
        { role: 'assistant', content: reply, timestamp: Date.now() },
      ],
      pendingResponse: reply,
    };
  };
}
