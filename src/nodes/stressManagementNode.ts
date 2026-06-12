import type { CareyBotState } from '../types/state';
import type { NodeResult } from '../types/nodes';
import { getLastUserInput } from '../types/nodes';

interface IAIBotsClient {
  chat(chatId: string | null, text: string, primeMessage?: string, history?: Array<{ role: 'user' | 'assistant'; content: string }>): Promise<{ reply: string; chatId: string }>;
}

interface ITypingIndicator {
  sendTypingIndicator(userId: string): Promise<void>;
}

export function makeStressManagementNode(aiBotsClient: IAIBotsClient, typing: ITypingIndicator) {
  return async function stressManagementNode(state: CareyBotState): Promise<NodeResult> {
    const userText = getLastUserInput(state);

    const primeMessage = !state.aiBotChatId
      ? `[SYSTEM CONTEXT] This is the start of a new conversation. ` +
        `The user has completed the CareyBot intake screening (risk level: ${state.tag ?? 'low'}) ` +
        `and is now opening a fresh chat to learn stress management techniques. ` +
        `You are entering State 4 (Regulation) for the first time. ` +
        `Do not reference any previous sessions. Do not run triage or screener. ` +
        `Begin with ONE new stress management technique.`
      : undefined;

    await typing.sendTypingIndicator(state.userId);
    const typingInterval = setInterval(() => {
      typing.sendTypingIndicator(state.userId).catch(() => {});
    }, 4000);

    const textForAI = !state.aiBotChatId ? 'Hi' : userText;
    const history = state.messages.slice(0, -1);
    try {
      const result = await aiBotsClient.chat(state.aiBotChatId, textForAI, primeMessage, history);
      return {
        aiBotChatId: result.chatId,
        pendingResponse: result.reply,
        selectedOption: 3,
        conversationPhase: 'option',
      };
    } finally {
      clearInterval(typingInterval);
    }
  };
}
