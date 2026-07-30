import type { CareyBotState } from '../types/state';
import type { NodeResult } from '../types/nodes';
import { getLastUserInput } from '../types/nodes';
import { parseReplyTags } from '../lib/replyTags';

// Menu option 5 → the Growing We Social Coach. This is a SEPARATE bot on the
// AIBots/Directus platform (its own seeded system prompt), reached via a second
// AIBotsClient injected as `socialCoach`. It reuses the same crisis plumbing:
// the coach's prompt must prefix replies with [CRISIS] on distress so
// parseCrisisReply routes the turn to emergencyHandler.

interface IAIBotsClient {
  chat(
    chatId: string | null,
    text: string,
    primeMessage?: string,
    history?: Array<{ role: 'user' | 'assistant'; content: string }>,
  ): Promise<{ reply: string; chatId: string }>;
}

interface ITypingIndicator {
  sendTypingIndicator(userId: string): Promise<void>;
}

export function makeSocialCoachNode(aiBotsClient: IAIBotsClient, typing: ITypingIndicator) {
  return async function socialCoachNode(state: CareyBotState): Promise<NodeResult> {
    const userText = getLastUserInput(state);

    // Handoff from Carey (user accepted the mid-chat offer): the existing
    // aiBotChatId belongs to the Carey bot, so start a FRESH coach session.
    // state.messages (passed as history) gives the coach the prior context.
    const isHandoff = state.pendingHandoff === 'socialCoach';
    const effectiveChatId = isHandoff ? null : state.aiBotChatId;

    const primeMessage = isHandoff
      ? `[SYSTEM CONTEXT] The user was talking with Carey and agreed to practise ` +
        `a social situation with you. The conversation history shows what they ` +
        `have been dealing with — acknowledge it briefly and go straight to ` +
        `STEP 1 — CONTEXT CHECK for that situation. Do not run any triage or ` +
        `screener. Keep it short and mobile-friendly.`
      : !state.aiBotChatId
      ? `[SYSTEM CONTEXT] This is the start of a new social coaching conversation. ` +
        `The user has completed the CareyBot intake screening (risk level: ${state.tag ?? 'low'}) ` +
        `and chose the social coach. Begin at STEP 1 — CONTEXT CHECK: warmly ask which social ` +
        `situation they want to prepare for or reflect on, offering a few friendly scenario options. ` +
        `Do not run any triage or screener. Keep it short and mobile-friendly.`
      : undefined;

    await typing.sendTypingIndicator(state.userId);
    const typingInterval = setInterval(() => {
      typing.sendTypingIndicator(state.userId).catch(() => {});
    }, 4000);

    const textForAI = !effectiveChatId ? 'Hi' : userText;
    const history = state.messages.slice(0, -1);
    try {
      const result = await aiBotsClient.chat(effectiveChatId, textForAI, primeMessage, history);
      const { reply, isCrisis } = parseReplyTags(result.reply);
      return {
        aiBotChatId: result.chatId,
        pendingResponse: reply,
        selectedOption: 2,
        pendingHandoff: null,
        conversationPhase: isCrisis ? 'crisis' : 'option',
        ...(isCrisis && { crisisDetected: true }),
      };
    } finally {
      clearInterval(typingInterval);
    }
  };
}
