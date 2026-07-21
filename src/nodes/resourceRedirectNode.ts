import type { CareyBotState } from '../types/state';
import type { NodeResult } from '../types/nodes';
import { COUNSELLING_URL } from '../config/questionnaire';
import { getLastUserInput } from '../types/nodes';
import { parseCrisisReply } from '../lib/crisisDetection';

interface IAIBotsClient {
  chat(chatId: string | null, message: string, primeMessage?: string, history?: Array<{ role: 'user' | 'assistant'; content: string }>): Promise<{ chatId: string; reply: string }>;
}

interface ITypingIndicator {
  sendTypingIndicator(userId: string): Promise<void>;
}

export function makeResourceRedirectNode(aiBotsClient: IAIBotsClient, typing: ITypingIndicator) {
  return async function resourceRedirectNode(state: CareyBotState): Promise<NodeResult> {
    const userText = getLastUserInput(state);
    const isInitialSelection = /^[.\s]*[3][.\s]*$/.test(userText);

    if (isInitialSelection) {
      return {
        pendingResponse:
          `Here are some resources that may help:\n\n` +
          `📅 Book a counselling session: ${COUNSELLING_URL}\n\n` +
          `You can also reach out to someone you trust, or contact a crisis line if you need immediate support.\n\n` +
          `Feel free to keep chatting, or type *menu* to see other support options.`,
        conversationPhase: 'option',
        selectedOption: 3,
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

    await typing.sendTypingIndicator(state.userId);
    const typingInterval = setInterval(() => {
      typing.sendTypingIndicator(state.userId).catch(() => {});
    }, 4000);

    const history = state.messages.slice(0, -1);
    try {
      const result = await aiBotsClient.chat(state.aiBotChatId, userText, primeMessage, history);
      const { reply, isCrisis } = parseCrisisReply(result.reply);
      return {
        aiBotChatId: result.chatId,
        pendingResponse: reply,
        conversationPhase: isCrisis ? 'crisis' : 'option',
        selectedOption: 3,
        ...(isCrisis && { crisisDetected: true }),
      };
    } finally {
      clearInterval(typingInterval);
    }
  };
}
