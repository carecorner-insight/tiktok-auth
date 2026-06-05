import type { CareyBotState, Platform, ConversationPhase } from '@/types/state';
import type { NormalizedMessage } from '@/types/platform';
import { initialState } from '@/types/state';

// ── State factories ──────────────────────────────────────────────────────────

export const makeState = (overrides: Partial<CareyBotState> = {}): CareyBotState => ({
  ...initialState('telegram', 'user-123', 'conversation-abc'),
  isAuthorized: true,
  ...overrides,
});

export const makeAuthorizedState = (overrides: Partial<CareyBotState> = {}) =>
  makeState({ isAuthorized: true, ...overrides });

export const makeUnauthorizedState = (overrides: Partial<CareyBotState> = {}) =>
  makeState({ isAuthorized: false, ...overrides });

export const makeCompletedQuestionnaireState = (
  answers: string[],
  overrides: Partial<CareyBotState> = {},
) =>
  makeState({
    questionIndex: 4,
    answers,
    conversationPhase: 'menu',
    ...overrides,
  });

// ── Message factory ──────────────────────────────────────────────────────────

export const makeNormalizedMessage = (
  overrides: Partial<NormalizedMessage> = {},
): NormalizedMessage => ({
  platform: 'telegram',
  userId: 'user-123',
  text: 'hello',
  timestamp: Date.now(),
  raw: {},
  ...overrides,
});

// ── Service mocks ────────────────────────────────────────────────────────────

export const makeWhitelistServiceMock = () => ({
  isAuthorized: jest.fn().mockResolvedValue(true),
});

export const makeSessionManagerMock = () => ({
  load: jest.fn().mockResolvedValue(null),
  save: jest.fn().mockResolvedValue(undefined),
  clear: jest.fn().mockResolvedValue(undefined),
});

export const makeSharePointLoggerMock = () => ({
  log: jest.fn().mockResolvedValue(undefined),
});

export const makeAIBotsClientMock = (reply = 'I hear you. Can you tell me more?') => ({
  chat: jest.fn().mockResolvedValue({ reply, chatId: 'mock-chat-id' }),
});

// ── Answer helpers ───────────────────────────────────────────────────────────
// 4 questions total: Q1 (suicidal ideation) + Q2–Q4 (tabulated, max score=3)
// RISK_THRESHOLDS: high ≥ 2, medium ≥ 1, else low

/** All-no answers — Q1 = no, Q2–Q4 all no → low risk */
export const ALL_NO_ANSWERS = ['no', 'no', 'no', 'no'];

/** High risk via Q1 (suicidal ideation) — immediate high regardless of Q2–Q4 */
export const SUICIDAL_YES_ANSWERS = ['yes', 'no', 'no', 'no'];

/** High risk via tabulation — 2 yes answers in Q2–Q4 (score ≥ 2) */
export const HIGH_TAB_ANSWERS = ['no', 'yes', 'yes', 'no'];

/** Medium risk — 1 yes answer in Q2–Q4 (score = 1) */
export const MEDIUM_TAB_ANSWERS = ['no', 'yes', 'no', 'no'];

/** Low risk — 0 yes answers in Q2–Q4 (score = 0) */
export const LOW_TAB_ANSWERS = ['no', 'no', 'no', 'no'];
