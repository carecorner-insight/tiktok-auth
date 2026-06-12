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
];

export const TOTAL_QUESTIONS = PHQ9_QUESTIONS.length;

// Risk thresholds for tabulated score (Q2–Q4, max score = 3)
export const RISK_THRESHOLDS = {
  high: 2,    // 2–3 yes answers
  medium: 1,  // 1 yes answer
  // 0 = low
} as const;

export const MENU_TEXT = `Thanks for answering that.\n\nWhat would feel most helpful right now?\n\n1. Talk about something that's been bothering me\n2. Do a quick wellbeing self-check\n3. Learn ways to manage stress\n4. Find support / resources`;

export const EMERGENCY_MESSAGE =
  "I'm really concerned about your safety right now.\n\n" +
  "Please call 1771 (National Mindline) now.\n\n" +
  "If possible, stay near someone you trust or let someone nearby know you need support.";

export const UNAUTHORIZED_MESSAGE =
  "Hi! CareyBot is currently in private access.\n\n" +
  "To request access, please register at: {REGISTRATION_URL}\n\n" +
  "Your User ID for the registration form is:";


export const COUNSELLING_URL =
  process.env.COUNSELLING_BOOKING_URL ?? 'https://carecorner-ist.my.site.com/insight/';
