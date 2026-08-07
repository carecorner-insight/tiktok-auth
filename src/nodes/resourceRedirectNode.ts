import type { CareyBotState } from '../types/state';
import type { NodeResult } from '../types/nodes';
import {
  COUNSELLING_URL,
  REFERRAL_AGE_FALLBACK,
  referralUrlForAge,
} from '../config/questionnaire';
import { scenarioMenuEnabled } from '../lib/pivotFlags';
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

    // ── Growing We referral (F2/F6) ──────────────────────────────────────────
    // Reached when the coach emits [REFERRAL]. The link is auto-selected from
    // the age captured at welcome — no question at the referral moment. Only an
    // unknown age (the user skipped twice) triggers the fallback question.
    if (scenarioMenuEnabled()) {
      const url = referralUrlForAge(state.age);
      if (url) {
        return {
          pendingResponse:
            `It sounds like it could help to talk this through with someone from our team.\n\n` +
            `You can reach them here: ${url}\n\n` +
            `We can keep going here too — just tell me what's on your mind.`,
          conversationPhase: 'option',
          referralRequested: false,
          awaitingReferralAge: false,
        };
      }
      return {
        pendingResponse: REFERRAL_AGE_FALLBACK,
        conversationPhase: 'option',
        referralRequested: false,
        awaitingReferralAge: true,
      };
    }

    const isInitialSelection = /^[.\s]*[3][.\s]*$/.test(userText);

    // Static resource block — the counselling URL must be exact, so we never let
    // the LLM reproduce it. Used for the initial selection and for a seamless
    // mid-conversation switch into this lane (with a brief bridging line).
    const RESOURCE_BLOCK =
      `📅 Book a counselling session: ${COUNSELLING_URL}\n\n` +
      `You can also reach out to someone you trust, or contact a crisis line if you need immediate support.\n\n` +
      `Feel free to keep chatting, or type *menu* to see other support options.`;

    if (state.justSwitchedLane) {
      return {
        pendingResponse:
          `It sounds like connecting with real support could really help. ` +
          `Here are some ways to reach the Care Corner team:\n\n` +
          RESOURCE_BLOCK,
        conversationPhase: 'option',
        selectedOption: 3,
        justSwitchedLane: false,
        aiBotChatId: null,
      };
    }

    if (isInitialSelection) {
      return {
        pendingResponse: `Here are some resources that may help:\n\n` + RESOURCE_BLOCK,
        conversationPhase: 'option',
        selectedOption: 3,
        justSwitchedLane: false,
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
        justSwitchedLane: false,
        ...(isCrisis && { crisisDetected: true }),
      };
    } finally {
      clearInterval(typingInterval);
    }
  };
}
