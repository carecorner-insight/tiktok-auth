import type { CareyBotState } from '../types/state';
import type { NodeResult } from '../types/nodes';
import { COUNSELLING_URL } from '../config/questionnaire';
import { getLastUserInput } from '../types/nodes';

interface IAIBotsClient {
  chat: (chatId: string | null, message: string, primeMessage?: string) => Promise<{ chatId: string; reply: string }>;
}

export function makeResourceRedirectNode(aiBotsClient: IAIBotsClient) {
  return async function resourceRedirectNode(state: CareyBotState): Promise<NodeResult> {
    const userText = getLastUserInput(state);
    const isInitialSelection = /^[.\s]*[4][.\s]*$/.test(userText);

    if (isInitialSelection) {
      return {
        pendingResponse:
          `Here are some resources that may help:\n\n` +
          `📅 Book a counselling session: ${COUNSELLING_URL}\n\n` +
          `You can also reach out to someone you trust, or contact a crisis line if you need immediate support.\n\n` +
          `Feel free to keep chatting, or type *menu* to see other support options.`,
        conversationPhase: 'option',
        selectedOption: 4,
      };
    }
    const primeMessage = !state.aiBotChatId
      ? `[SYSTEM CONTEXT] This is the start of a new conversation. ` +
        `The user has completed the CareyBot intake screening (risk level: ${state.tag ?? 'low'}) ` +
        `and is now opening a fresh chat to find support resources. ` +
        `You are entering State 7 (Support Routing) for the first time. ` +
        `Do not reference any previous sessions. Do not run triage or screener. ` +
        `Help them find appropriate Care Corner services and support in their lives.`
      : undefined;

    const result = await aiBotsClient.chat(state.aiBotChatId, userText, primeMessage);
    return {
      aiBotChatId: result.chatId,
      pendingResponse: result.reply,
      conversationPhase: 'option',
      selectedOption: 4,
    };
  };
}
