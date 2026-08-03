import type { CareyBotState } from '../types/state';
import type { NodeResult } from '../types/nodes';
import { getLastUserInput } from '../types/nodes';
import { parseReplyTags } from '../lib/replyTags';
import type { MenuMode } from '../lib/menuMode';

interface IAIBotsClient {
  chat(chatId: string | null, text: string, primeMessage?: string, history?: Array<{ role: 'user' | 'assistant'; content: string }>): Promise<{ reply: string; chatId: string }>;
}

interface ITypingIndicator {
  sendTypingIndicator(userId: string): Promise<void>;
}

const SOCIAL_COACH_OFFER =
  `\n\nBy the way — it sounds like a social situation might be part of this. ` +
  `If you'd like, we could practise how to handle it together with the social ` +
  `coach. Want to give that a try? (yes / no — or just keep chatting)`;

export function makeFreeTextNode(
  aiBotsClient: IAIBotsClient,
  typing: ITypingIndicator,
  mode: MenuMode = 'intent',
) {
  return async function freeTextNode(state: CareyBotState): Promise<NodeResult> {
    const normalized = getLastUserInput(state);
    const rawText =
      [...state.messages].reverse().find(m => m.role === 'user')?.content ?? normalized;

    // Fresh backend session (no chatId): either the first turn in this lane, or
    // the intent classifier just switched the user in from another lane.
    const isBridgeIn = !state.aiBotChatId && state.justSwitchedLane;
    const primeMessage = state.aiBotChatId
      ? undefined // existing session already has context
      : isBridgeIn
      ? `[SYSTEM CONTEXT] The user was just in another part of CareyBot and has ` +
        `moved to open up about what's on their mind. The conversation history ` +
        `shows what they've been dealing with — acknowledge it briefly in ONE line, ` +
        `then continue warmly from where they are (State 2B, Post-Screener ` +
        `Engagement). Do not run triage or a screener. If they are distressed you ` +
        `may offer ONE brief coping or regulation skill when it fits.`
      : `[SYSTEM CONTEXT] This is the start of a new conversation. ` +
        `The user has completed the CareyBot intake screening (risk level: ${state.tag ?? 'low'}) ` +
        `and is now opening a fresh chat to talk about something on their mind. ` +
        `You are entering State 2B (Post-Screener Engagement) for the first time. ` +
        `Do not reference any previous sessions. Do not run triage or screener. ` +
        `Begin with a warm, brief invitation to share. As the conversation develops, ` +
        `follow the emotion ladder — if the user is distressed, you may offer ONE brief ` +
        `coping or regulation skill (State 4) when it fits.`;

    await typing.sendTypingIndicator(state.userId);
    const typingInterval = setInterval(() => {
      typing.sendTypingIndicator(state.userId).catch(() => {});
    }, 4000);

    // New session: if the user arrived via a bare menu digit there is nothing
    // meaningful to forward, so kick off with 'Hi'. Otherwise (open-ended entry,
    // or a mid-conversation switch) their message carries real content — forward
    // it so Carey responds to what they actually said.
    const isBareMenuDigit = /^[123]$/.test(normalized.replace(/[.\s]/g, ''));
    const textForAI = !state.aiBotChatId && isBareMenuDigit ? 'Hi' : rawText;

    const history = state.messages.slice(0, -1);
    try {
      const result = await aiBotsClient.chat(state.aiBotChatId, textForAI, primeMessage, history);
      const { reply, isCrisis, suggestsSocialCoach } = parseReplyTags(result.reply);

      // The manual coach offer only applies in NUMBERED mode. In intent mode the
      // classifier switches the user to the coach seamlessly, so we never ask.
      const offerCoach =
        mode === 'numbered' && suggestsSocialCoach && !isCrisis && !state.socialCoachOffered;

      return {
        aiBotChatId: result.chatId,
        pendingResponse: offerCoach ? reply + SOCIAL_COACH_OFFER : reply,
        // An unanswered offer from last turn is treated as declined once the
        // user says anything that isn't "yes" (the router catches "yes").
        pendingHandoff: offerCoach ? 'socialCoach' : null,
        justSwitchedLane: false,
        ...(offerCoach && { socialCoachOffered: true }),
        ...(isCrisis && { crisisDetected: true, conversationPhase: 'crisis' }),
      };
    } finally {
      clearInterval(typingInterval);
    }
  };
}
