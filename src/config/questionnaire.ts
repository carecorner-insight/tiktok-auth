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

// Open-ended post-screener entry (change #1). MENU_TEXT is retained as the
// fallback shown when intent classification returns UNCLEAR or the LLM fails,
// and for the re-engagement nudge, which presents numbered options.
export const OPENING_TEXT =
  `Thanks for answering that.\n\n` +
  `What brings you here today? You can share whatever's on your mind — ` +
  `or if you'd rather, just say you'd like to practise a social situation ` +
  `or speak with someone from our team.\n\n` +
  `(Type "menu" anytime to see options, or "/restart" to start over.)`;

export const MENU_TEXT =
  `Thanks for answering that.\n\n` +
  `What would feel most helpful right now?\n\n` +
  `1. Talk about something that's been bothering me\n` +
  `2. Practise a social situation (social coach)\n` +
  `3. Connect with someone from our team today\n\n` +
  `Please reply with the number of your choice. If you want to go back to the menu at any time, just type "menu"!\n\n` + 
  `Alternatively, if you want to restart the conversation entirely, type "/restart".`;

// ── F3: always-on safety response ────────────────────────────────────────────
// Verbatim from the pivot brief. Ends with an engaging question because the bot
// stays with the user after the hotline message rather than closing the chat.
// ⚠️ Pending clinical advisor sign-off on this exact wording before launch.
export const EMERGENCY_MESSAGE =
  "I'm really concerned about your safety right now.\n\n" +
  "Please call 1771 (National Mindline) now.\n\n" +
  "If possible, stay near someone you trust or let someone nearby know you need support.\n\n" +
  "Would you like me to help you think of someone to reach out to right now?";

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

// ═════════════════════════════════════════════════════════════════════════════
// PIVOT — Growing We Social Coach
// Copy below is specified verbatim in the design pivot brief. The constants
// above are retained for the NUS study build (SCREENER_ENABLED=true).
// ═════════════════════════════════════════════════════════════════════════════

// ── F2: welcome + age (a question, never a gate) ─────────────────────────────
export const WELCOME_TEXT =
  `Hey, I'm Carey 👋\n\n` +
  `I'm a digital support assistant that helps you navigate social situations — ` +
  `from making friends to handling awkward moments at work or school.\n\n` +
  `A few things to know before we start:\n` +
  `— I'm not a real person\n` +
  `— Your messages are processed through Telegram and stored to keep you safe ` +
  `and improve the service\n` +
  `— Some messages may be reviewed by trained staff\n` +
  `— If we're concerned about your safety, someone from our team may reach out\n` +
  `— I'm not an emergency service. If you need urgent help, call SOS at 1767 or 995\n\n` +
  `Before we start, how old are you? Just reply with a number`;

// One re-prompt only — a second non-answer proceeds to the menu, age unknown.
export const AGE_REPROMPT_TEXT =
  `No worries — just a number is fine (for example, 17). Or type anything to skip`;

// Returning user whose age we already have: orient them without re-reading the
// full disclosures or re-asking age.
export const WELCOME_BACK_TEXT = `Welcome back 👋 What would you like to work on today?`;

// ── F6: six-option scenario menu ─────────────────────────────────────────────
const SCENARIO_LIST =
  `1. Starting something new (new school, poly, first job, NS)\n` +
  `2. Work and adulting (internship, colleagues, navigating the workplace, ` +
  `money stress, living independently)\n` +
  `3. Making or keeping friends\n` +
  `4. Relationships (romantic, family, falling out with someone close)\n` +
  `5. Something awkward happened\n` +
  `6. Online or texting situations\n\n` +
  `Type the number to get started\n\n` +
  `(Type "menu" anytime to come back here, or "/restart" to start over.)`;

/** Shown after the age reply. */
export const SCENARIO_MENU_TEXT = `Thanks! What would you like to work on today?\n\n` + SCENARIO_LIST;

/** Re-display (the "menu" keyword) — the brief drops the leading "Thanks!". */
export const SCENARIO_MENU_REPEAT_TEXT = `What would you like to work on today?\n\n` + SCENARIO_LIST;

export interface Scenario {
  label: string;
  /** Injected into the coach's prime so it opens on-topic. */
  context: string;
}

export const SCENARIOS: Record<1 | 2 | 3 | 4 | 5 | 6, Scenario> = {
  1: {
    label: 'Starting something new',
    context:
      'starting something new — a new school, poly, their first job, or NS — and wants to ' +
      'prepare for the social side of that transition',
  },
  2: {
    label: 'Work and adulting',
    context:
      'navigating work and adulting — an internship, colleagues, workplace norms, money ' +
      'stress, or living independently',
  },
  3: {
    label: 'Making or keeping friends',
    context: 'making new friends or keeping the friendships they already have',
  },
  4: {
    label: 'Relationships',
    context:
      'a relationship — romantic, family, or a falling out with someone close to them',
  },
  5: {
    label: 'Something awkward happened',
    context:
      'something awkward that already happened, and how to handle or recover from it',
  },
  6: {
    label: 'Online or texting situations',
    context: 'an online or texting situation — messaging, group chats, or social media',
  },
};

/**
 * Prime for the social coach when the user picks a scenario. The point is that
 * the coach opens ON the chosen topic instead of asking "which situation?" —
 * the menu already answered that.
 */
export function scenarioPrime(option: 1 | 2 | 3 | 4 | 5 | 6): string {
  const scenario = SCENARIOS[option];
  return (
    `[SYSTEM CONTEXT] The user has chosen to work on: ${scenario.label}. ` +
    `Specifically, they are dealing with ${scenario.context}. ` +
    `Open directly on this topic with one warm, brief question to find out what is ` +
    `going on for them in that situation. Do NOT ask which situation or scenario they ` +
    `want to work on — they have already chosen. Do not run any triage or screener. ` +
    `Keep it short and mobile-friendly.`
  );
}

// ── F2: referral triage by stored age ────────────────────────────────────────
export const INSIGHT_URL =
  process.env.INSIGHT_REFERRAL_URL ?? 'https://carecorner-ist.my.site.com/insight/';
export const CREST_URL =
  process.env.CREST_REFERRAL_URL ?? 'https://www.carecorner.org.sg/crest-enquiry-form/';

/** 25 & under → INSIGHT, 26+ → CREST. Null when age is unknown. */
export function referralUrlForAge(age: number | null): string | null {
  if (age === null || Number.isNaN(age)) return null;
  return age <= 25 ? INSIGHT_URL : CREST_URL;
}

/** Asked only when age is unknown (the user skipped the question twice). */
export const REFERRAL_AGE_FALLBACK =
  `So I can point you to the right team — are you 25 or under?\n\n` + `1. Yes\n` + `2. No`;
