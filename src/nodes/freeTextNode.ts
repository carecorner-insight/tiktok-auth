import type { CareyBotState, Message } from '@/types/state';
import type { NodeResult } from '@/types/nodes';
interface IAIBotsClient {
  chat(messages: Message[]): Promise<string>;
}
import { getLastUserInput } from '@/types/nodes';

// AIBots prefixes its reply with [CRISIS] when it enters State 8 (crisis routing).
// This must be configured in the AIBots system prompt.
// Using a prefix rather than exact match so the compassionate transitional
// message AIBots generates is preserved and shown to the user.
const CRISIS_PREFIX = '[CRISIS]';

export function makeFreeTextNode(aiBotsClient: IAIBotsClient) {
  return async function freeTextNode(state: CareyBotState): Promise<NodeResult> {
    const userInput = getLastUserInput(state);

    const updatedMessages: Message[] = [
      ...state.messages,
      { role: 'user', content: userInput, timestamp: Date.now() },
    ];

    const reply = await aiBotsClient.chat(updatedMessages);

    const isCrisis = reply.trimStart().startsWith(CRISIS_PREFIX);
    const cleanReply = isCrisis
      ? reply.trimStart().slice(CRISIS_PREFIX.length).trimStart()
      : reply;

    return {
      messages: [
        ...updatedMessages,
        { role: 'assistant', content: cleanReply, timestamp: Date.now() },
      ],
      pendingResponse: cleanReply,
      ...(isCrisis && { crisisDetected: true, conversationPhase: 'ended' }),
    };
  };
}
