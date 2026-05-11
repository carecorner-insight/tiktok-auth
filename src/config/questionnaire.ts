export interface Question {
  id: number;        // 1-indexed, matches PHQ-9 display numbering
  text: string;
  isHighRiskTrigger: boolean;  // true for suicidal ideation (PHQ-9 Q9, asked first)
}

// PHQ-9 questions in triage order.
// Q1 here = PHQ-9 Q9 (suicidal ideation) — screened first so high risk is caught immediately.
// Q2–Q9 here = PHQ-9 Q1–Q8 — tabulated to determine low/medium/high.
export const PHQ9_QUESTIONS: Question[] = [
  {
    id: 1,
    text: 'Over the past two weeks, have you had thoughts of hurting yourself or feeling that you would be better off dead?',
    isHighRiskTrigger: true,
  },
  {
    id: 2,
    text: 'Over the past two weeks, have you often had little interest or pleasure in doing things?',
    isHighRiskTrigger: false,
  },
  {
    id: 3,
    text: 'Over the past two weeks, have you often felt down, depressed, or hopeless?',
    isHighRiskTrigger: false,
  },
  {
    id: 4,
    text: 'Over the past two weeks, have you had trouble falling or staying asleep, or sleeping too much?',
    isHighRiskTrigger: false,
  },
  {
    id: 5,
    text: 'Over the past two weeks, have you often felt tired or had little energy?',
    isHighRiskTrigger: false,
  },
  {
    id: 6,
    text: 'Over the past two weeks, have you had a poor appetite or been overeating?',
    isHighRiskTrigger: false,
  },
  {
    id: 7,
    text: 'Over the past two weeks, have you felt bad about yourself — or that you are a failure or have let yourself or your family down?',
    isHighRiskTrigger: false,
  },
  {
    id: 8,
    text: 'Over the past two weeks, have you had trouble concentrating on things, such as reading the newspaper or watching television?',
    isHighRiskTrigger: false,
  },
  {
    id: 9,
    text: 'Over the past two weeks, have you been moving or speaking so slowly that other people could have noticed? Or the opposite — being so fidgety or restless that you have been moving around a lot more than usual?',
    isHighRiskTrigger: false,
  },
];

export const TOTAL_QUESTIONS = PHQ9_QUESTIONS.length;

// Risk thresholds for tabulated score (Q2–Q9, max score = 8)
export const RISK_THRESHOLDS = {
  high: 6,    // 6–8 yes answers
  medium: 3,  // 3–5 yes answers
  // 0–2 = low
} as const;

export const MENU_TEXT = `Thanks for answering that.\n\nWhat would feel most helpful right now?\n\n1. Talk about something that's been bothering me\n2. Do a quick wellbeing self-check\n3. Learn ways to manage stress\n4. Find support / resources`;

export const EMERGENCY_MESSAGE =
  "I'm really concerned about your safety. Please reach out to a crisis line immediately:\n\n" +
  "🇸🇬 IMH Crisis Hotline: 6389 2222 (24/7)\n" +
  "🇸🇬 SOS: 1800 221 4444 (24/7)\n\n" +
  "If you are in immediate danger, please call 995.\n\n" +
  "You are not alone, and help is available right now.";

export const UNAUTHORIZED_MESSAGE =
  "Hi! CareyBot is currently in private access.\n\n" +
  "To request access, please register at: {REGISTRATION_URL}\n\n" +
  "Your User ID is: {USER_ID}";

export const COUNSELLING_URL = process.env.COUNSELLING_BOOKING_URL ?? '';
