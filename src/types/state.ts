export type Platform = 'tiktok' | 'telegram';

export type RiskLevel = 'low' | 'medium' | 'high';

export type ConversationPhase =
  | 'questionnaire'
  | 'menu'
  | 'option'
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
  sessionId: string;

  // RBAC
  isAuthorized: boolean;

  // Questionnaire — Q1 is suicidal ideation (PHQ-9 Q9, screened first)
  questionIndex: number;       // 0–8; 9 = all answered
  answers: string[];           // 'yes' | 'no' per question
  riskLevel: RiskLevel | null;

  // Post-questionnaire flow
  conversationPhase: ConversationPhase;
  selectedOption: MenuOption | null;

  // Conversation history sent to AIBots
  messages: Message[];

  // The response CareyBot will send this turn
  pendingResponse: string | null;

  // Set true when crisis detected mid free-text (Option 1)
  crisisDetected: boolean;
}

export const initialState = (
  platform: Platform,
  userId: string,
  sessionId: string,
): CareyBotState => ({
  platform,
  userId,
  sessionId,
  isAuthorized: false,
  questionIndex: 0,
  answers: [],
  riskLevel: null,
  conversationPhase: 'questionnaire',
  selectedOption: null,
  messages: [],
  pendingResponse: null,
  crisisDetected: false,
});
