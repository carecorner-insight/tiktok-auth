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
      ? `[SYSTEM CONTEXT] This is the start of a new conversation. ` +
        `The user has completed the CareyBot intake screening (risk level: ${state.tag ?? 'low'}) ` +
        `and is now opening a fresh chat to do a wellbeing self-check. ` +
        `You are entering State 2A (Wellbeing Self Check) for the first time. ` +
        `Do not reference any previous sessions. Do not run triage or screener. ` +
        `Begin the wellbeing quiz from the first question.`
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
