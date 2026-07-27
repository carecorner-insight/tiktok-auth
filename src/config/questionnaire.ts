export interface Question {
  id: number;
  text: string;
  // When true, a "yes" answer immediately triggers HIGH risk without waiting
  // for all questions to be answered.
  isHighRiskTrigger: boolean;
}

// C-SSRS informed distress screener — 4 questions.
// Q1: Passive Death Wish
// Q2: Suicidal Thoughts
// Q3: Plan / Intent / Method  ← immediate HIGH if yes
// Q4: Suicide Attempt / Preparation ← immediate HIGH if yes
export const CSSRS_QUESTIONS: Question[] = [
  {
    id: 1,
    text: 'Have things felt so heavy or exhausting lately that you’ve wished you could just go to sleep and not wake up?',
    isHighRiskTrigger: false,
  },
  {
    id: 2,
    text: 'Sometimes when the pain feels like too much, people think about ending their lives. Have you found yourself having thoughts about killing yourself?',
    isHighRiskTrigger: false,
  },
  {
    id: 3,
    text: 'If you have been having these thoughts, have you found yourself thinking about how you might do it, or starting to make a plan?',
    isHighRiskTrigger: true,
  },
  {
    id: 4,
    text: 'In your most difficult moments, have you ever tried to end your life, or taken any steps to prepare for it?',
    isHighRiskTrigger: true,
  },
];

export const TOTAL_QUESTIONS = CSSRS_QUESTIONS.length; // 4

export const MENU_TEXT =
  `Thanks for answering that.\n\n` +
  `What would feel most helpful right now?\n\n` +
  `1. Talk about something that's been bothering me\n` +
  `2. Practise a social situation (social coach)\n` +
  `3. Connect with someone from our team today\n\n` +
  `Please reply with the number of your choice. If you want to go back to the menu at any time, just type "menu"!\n\n` + 
  `Alternatively, if you want to restart the conversation entirely, type "/restart".`;

export const EMERGENCY_MESSAGE =
  "I'm really concerned about your safety right now.\n\n" +
  "Please text or call 1771 (National Mindline) now.\n\n" +
  "If possible, stay near someone you trust or let someone nearby know you need support. If that feels too heavy right now, feel free to chat with me. \n\n" +
  `Alternatively, if you wish to restart the conversation, type "/restart".`;

// Shown after MODERATE scoring — evaluates whether the user is currently safe.
// "Yes" proceeds to the menu; "No" or anything else escalates to HIGH risk.
export const SAFETY_CHECK_MESSAGE =
  "Thank you for sharing that with me.\n\n" +
  "Before we continue — right now, do you feel safe?\n\n" +
  "Yes / No";

export const UNAUTHORIZED_MESSAGE =
  "Hi! CareyBot is currently in private access.\n\n" +
  "To request access, please register at: {REGISTRATION_URL}\n\n" +
  "Your User ID for the registration form is:";

export const COUNSELLING_URL =
  process.env.COUNSELLING_BOOKING_URL ?? 'https://carecorner-ist.my.site.com/insight/';
