export type Platform = 'tiktok' | 'telegram';

export type tag = 'low' | 'medium' | 'high';

export type ConversationPhase =
  | 'ageCheck'
  | 'questionnaire'
  | 'menu'
  | 'option'
  | 'crisis'
  | 'ended';

export type MenuOption = 1 | 2 | 3 | 4;

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

  // Questionnaire — Q1 is suicidal ideation (PHQ-9 Q9, screened first)
  questionIndex: number;       // 0–8; 9 = all answered
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
