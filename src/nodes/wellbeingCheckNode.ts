import type { CareyBotState } from '../types/state';
import type { NodeResult } from '../types/nodes';
import { getLastUserInput } from '../types/nodes';

interface IAIBotsClient {
  chat(chatId: string | null, text: string, primeMessage?: string): Promise<{ reply: string; chatId: string }>;
}

export function makeWellbeingCheckNode(aiBotsClient: IAIBotsClient) {
  return async function wellbeingCheckNode(state: CareyBotState): Promise<NodeResult> {
    const userText = getLastUserInput(state);

    const primeMessage = !state.aiBotChatId
      ? `[SYSTEM CONTEXT] The user has already completed the CareyBot intake screening. ` +
        `Risk level: ${state.tag ?? 'low'}. They have chosen to do a wellbeing self-check. ` +
        `You are now in State 2A (Wellbeing Self Check). ` +
        `Do not run triage or screener. Begin the wellbeing quiz.`
      : undefined;

    const textForAI = !state.aiBotChatId ? 'Hi' : userText;
    const result = await aiBotsClient.chat(state.aiBotChatId, textForAI, primeMessage);
    return {
      aiBotChatId: result.chatId,
      pendingResponse: result.reply,
      conversationPhase: 'option',
      selectedOption: 2,
    };
  };
}
