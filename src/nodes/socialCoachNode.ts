import type { CareyBotState } from '../types/state';
import type { NodeResult } from '../types/nodes';
import { getLastUserInput } from '../types/nodes';
import { parseReplyTags } from '../lib/replyTags';
import { scenarioMenuEnabled } from '../lib/pivotFlags';
import { scenarioPrime } from '../config/questionnaire';

// Menu option 2 → the Growing We Social Coach. This is a SEPARATE bot on the
// AIBots/Directus platform (its own seeded system prompt), reached via a second
// AIBotsClient injected as `socialCoach`. It reuses the same crisis plumbing:
// the coach's prompt must prefix replies with [CRISIS] on distress so
// parseReplyTags routes the turn to emergencyHandler.

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
    const rawText =
      [...state.messages].reverse().find(m => m.role === 'user')?.content ?? userText;

    // A "bridge" is any entry into the coach that isn't a continuation of an
    // existing coach session: the numbered-mode confirm handoff (pendingHandoff),
    // or an intent-mode seamless switch (justSwitchedLane). Either way the current
    // aiBotChatId belongs to a DIFFERENT bot, so we start a FRESH coach session and
    // pass state.messages as history to give the coach the prior context.
    const isBridge =
      state.pendingHandoff === 'socialCoach' || (!state.aiBotChatId && state.justSwitchedLane);
    const effectiveChatId = isBridge ? null : state.aiBotChatId;

    // Growing We build: the menu already told us WHICH situation, so open the
    // coach directly on that scenario instead of asking again (F6).
    const scenarioOption =
      scenarioMenuEnabled() && state.selectedOption ? state.selectedOption : null;

    const primeMessage = scenarioOption && !state.aiBotChatId
      ? scenarioPrime(scenarioOption)
      : isBridge
      ? `[SYSTEM CONTEXT] The user was just talking with Carey and now wants to ` +
        `work on a social situation with you. The conversation history shows what ` +
        `they have been dealing with — acknowledge it briefly in ONE line, then go ` +
        `to STEP 1 — CONTEXT CHECK for that situation. Do not run any triage or ` +
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

    // Forward the user's real message so the coach responds to what they actually
    // said. Only fall back to 'Hi' when a fresh session was entered via a bare
    // menu digit (nothing meaningful to forward).
    const isBareMenuDigit = /^[123]$/.test(userText.replace(/[.\s]/g, ''));
    const textForAI = !effectiveChatId && isBareMenuDigit ? 'Hi' : rawText;
    const history = state.messages.slice(0, -1);
    try {
      const result = await aiBotsClient.chat(effectiveChatId, textForAI, primeMessage, history);
      const { reply, isCrisis, suggestsReferral } = parseReplyTags(result.reply);
      return {
        aiBotChatId: result.chatId,
        pendingResponse: reply,
        // Keep the chosen scenario in the Growing We build; the triage build
        // only ever reaches the coach as option 2.
        selectedOption: scenarioOption ?? state.selectedOption ?? 2,
        pendingHandoff: null,
        justSwitchedLane: false,
        // [REFERRAL] is the pivot's only route to a human — the scenario menu
        // has no "connect with our team" entry. Crisis still takes precedence.
        referralRequested: !isCrisis && suggestsReferral,
        conversationPhase: isCrisis ? 'crisis' : 'option',
        ...(isCrisis && { crisisDetected: true }),
      };
    } finally {
      clearInterval(typingInterval);
    }
  };
}
