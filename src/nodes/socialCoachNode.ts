import type { CareyBotState } from '../types/state';
import type { NodeResult } from '../types/nodes';
import { getLastUserInput } from '../types/nodes';
import { parseReplyTags } from '../lib/replyTags';
import { scenarioMenuEnabled } from '../lib/pivotFlags';
import { scenarioPrime } from '../config/questionnaire';
import { startScenario, explicitlyRequestsSupport } from '../analytics/contract';
import { parseMeasurement, applyMeasurement, READINESS_QUESTION, type CoachMeasurementServices } from '../analytics/coachMeasurement';

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

export function makeSocialCoachNode(aiBotsClient: IAIBotsClient, typing: ITypingIndicator, measurementServices?: CoachMeasurementServices) {
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

    let analytics = state.kpi;
    if (analytics && scenarioOption && (state.menuSelection || !analytics.scenarioRunId)) {
      analytics = startScenario(analytics, scenarioOption, state.messages[state.messages.length - 1]?.timestamp ?? Date.now());
      if (measurementServices?.scenarioStarted) await measurementServices.scenarioStarted({ ...state, kpi: analytics });
    }
    // Continuing normal conversation instead of answering is allowed. The
    // unanswered response stays missing; never force a survey re-prompt.
    if (analytics?.pendingQuestion) analytics = { ...analytics, pendingQuestion: null };

    const primeMessage = scenarioOption && state.menuSelection
      ? scenarioPrime(scenarioOption) + ` AGE: ${state.age ?? 'unknown'}. ` +
        `Use earlier context where relevant; do not introduce yourself again or re-ask answered questions.`
      : isBridge
      ? `[SYSTEM CONTEXT] The user was just talking with Carey and now wants to ` +
        `work on a social situation with you. The conversation history shows what ` +
        `they have been dealing with — continue from that context without a new introduction ` +
        `or repeating answered questions. Do not run any triage or ` +
        `screener. Keep it short and mobile-friendly.`
      : state.menuSelection
      ? `[SYSTEM CONTEXT] This is the start of a new social coaching conversation. ` +
        `The user has completed the CareyBot intake screening (risk level: ${state.tag ?? 'low'}) ` +
        `and chose the social coach. Begin at STEP 1 — CONTEXT CHECK: warmly ask which social ` +
        `situation they want to prepare for or reflect on, offering a few friendly scenario options. ` +
        `Do not run any triage or screener. Keep it short and mobile-friendly.`
      : !effectiveChatId
      ? `[SYSTEM CONTEXT] Continue the existing conversation from the history and the user's ` +
        `latest answer. A new backend session is not a new conversation. Do not introduce ` +
        `yourself or repeat answered questions. AGE: ${state.age ?? 'unknown'}.`
      : undefined;

    await typing.sendTypingIndicator(state.userId);
    const typingInterval = setInterval(() => {
      typing.sendTypingIndicator(state.userId).catch(() => {});
    }, 4000);

    const history = state.messages.slice(0, -1);
    try {
      const result = await aiBotsClient.chat(effectiveChatId, rawText, primeMessage, history);
      // Preserve safety tags even if the model accidentally puts one inside
      // its metadata block. Bookkeeping must never suppress a crisis signal.
      const routing = parseReplyTags(result.reply);
      const measured = analytics ? parseMeasurement(routing.reply) : { reply: routing.reply, measurement: null };
      const { isCrisis, suggestsReferral } = routing;
      const reply = measured.reply;
      let response = reply;
      if (analytics) {
        const wasComplete = analytics.checkinReached;
        analytics = applyMeasurement(analytics, measured.measurement, !isCrisis && !suggestsReferral);
        if (!wasComplete && analytics.checkinReached) response = `${reply}\n\n${READINESS_QUESTION}`;
        if (suggestsReferral && !isCrisis) {
          analytics.supportSource = explicitlyRequestsSupport(rawText) ? 'user_requested' : 'bot_suggested';
          analytics.facts.push({ eventType: 'referral_requested' });
        }
      }
      return {
        ...(analytics ? { kpi: analytics } : {}),
        aiBotChatId: result.chatId,
        pendingResponse: response,
        // Keep the chosen scenario in the Growing We build; the triage build
        // only ever reaches the coach as option 2.
        selectedOption: scenarioOption ?? 2,
        pendingHandoff: null,
        justSwitchedLane: false,
        menuSelection: false,
        // The coach can request a referral as well as the intent classifier.
        // Crisis always takes precedence.
        referralRequested: !isCrisis && suggestsReferral,
        conversationPhase: 'option',
        ...(isCrisis && { crisisDetected: true }),
      };
    } finally {
      clearInterval(typingInterval);
    }
  };
}
