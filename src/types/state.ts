export type Platform = 'tiktok' | 'telegram';

export type tag = 'low' | 'elevated' | 'moderate' | 'high';

export type ConversationPhase =
  | 'ageCheck'
  | 'questionnaire'
  | 'safetyCheck'
  | 'menu'
  | 'option'
  | 'crisis'
  | 'ended';

export type MenuOption = 1 | 2 | 3 | 4 | 5;

export interface Message {
  role: 'user' | 'assistant';
  content: string;
  timestamp: number;
}

export interface CareyBotState {
  // Identity
  platform: Platform;
  userId: string;
  conversationId: string;

  // RBAC
  isAuthorized: boolean;

  // Demographics — actual age collected at the age gate (null until answered)
  age: number | null;

  // Questionnaire — C-SSRS informed 4-question screener
  questionIndex: number;       // 0–3; 4 = all answered
  answers: string[];           // 'yes' | 'no' per question
  tag: tag | null;

  // Post-questionnaire flow
  conversationPhase: ConversationPhase;
  selectedOption: MenuOption | null;

  // Conversation history sent to AIBots
  messages: Message[];

  // The response CareyBot will send this turn
  pendingResponse: string | null;

  // Set true when crisis detected mid free-text (Option 1)
  crisisDetected: boolean;

  // AIBots server-side chat session ID (created on first AI call, persisted across turns)
  aiBotChatId: string | null;
}

export const initialState = (
  platform: Platform,
  userId: string,
  conversationId: string,
): CareyBotState => ({
  platform,
  userId,
  conversationId,
  isAuthorized: false,
  age: null,
  questionIndex: 0,
  answers: [],
  tag: null,
  conversationPhase: 'ageCheck',
  selectedOption: null,
  messages: [],
  pendingResponse: null,
  crisisDetected: false,
  aiBotChatId: null,
});
