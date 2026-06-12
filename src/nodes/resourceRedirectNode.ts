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
      ? `[SYSTEM CONTEXT] The user has already completed the CareyBot intake screening. ` +
        `Risk level: ${state.tag ?? 'low'}. They have chosen to find resources. ` +
        `You are now going to provide resource information for Care Corner and redirect them to the appropriate services and/or people in their lives. ` +
        `Do not run triage or screener. Begin the resource provision and redirection process.`
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
