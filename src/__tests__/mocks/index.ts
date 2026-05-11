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
    questionIndex: 9,
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

/** All-no answers — Q1 (suicidal) = no, Q2–Q9 all no → low risk */
export const ALL_NO_ANSWERS = Array(9).fill('no');

/** High risk via Q1 (suicidal ideation) */
export const SUICIDAL_YES_ANSWERS = ['yes', ...Array(8).fill('no')];

/** High risk via tabulation — 6 yes answers in Q2–Q9 */
export const HIGH_TAB_ANSWERS = ['no', ...Array(6).fill('yes'), ...Array(2).fill('no')];

/** Medium risk — 3 yes answers in Q2–Q9 */
export const MEDIUM_TAB_ANSWERS = ['no', ...Array(3).fill('yes'), ...Array(5).fill('no')];

/** Low risk — 2 yes answers in Q2–Q9 */
export const LOW_TAB_ANSWERS = ['no', ...Array(2).fill('yes'), ...Array(6).fill('no')];
