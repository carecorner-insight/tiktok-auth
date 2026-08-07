import {
  WELCOME_TEXT,
  AGE_REPROMPT_TEXT,
  WELCOME_BACK_TEXT,
  SCENARIO_MENU_TEXT,
  EMERGENCY_MESSAGE,
  REFERRAL_AGE_FALLBACK,
  INSIGHT_URL,
  CREST_URL,
  SCENARIOS,
  scenarioPrime,
  referralUrlForAge,
} from '@/config/questionnaire';

// The pivot brief specifies this copy verbatim. These tests pin the parts that
// carry legal, safety or routing weight so a careless edit can't quietly drop
// them.

describe('WELCOME_TEXT (disclosures + age question)', () => {
  it('carries every required disclosure', () => {
    expect(WELCOME_TEXT).toContain("I'm not a real person");
    expect(WELCOME_TEXT).toMatch(/reviewed by trained staff/i);
    expect(WELCOME_TEXT).toMatch(/not an emergency service/i);
    expect(WELCOME_TEXT).toMatch(/stored/i);
  });

  it('cites the emergency numbers from the brief (SOS 1767 / 995)', () => {
    expect(WELCOME_TEXT).toContain('1767');
    expect(WELCOME_TEXT).toContain('995');
  });

  it('ends by asking for age as a number', () => {
    expect(WELCOME_TEXT).toMatch(/how old are you/i);
    expect(WELCOME_TEXT.trimEnd()).toMatch(/number$/i);
  });

  it('drops the clinical/emotional-support framing the pivot removes', () => {
    expect(WELCOME_TEXT).not.toMatch(/talk through how you.re feeling/i);
    expect(WELCOME_TEXT).not.toMatch(/for young people in Singapore/i);
  });
});

describe('SCENARIO_MENU_TEXT (6 options)', () => {
  it('lists exactly six numbered scenarios', () => {
    for (let n = 1; n <= 6; n++) {
      expect(SCENARIO_MENU_TEXT).toContain(`${n}.`);
    }
    expect(SCENARIO_MENU_TEXT).not.toContain('7.');
  });

  it('covers the six scenario themes', () => {
    expect(SCENARIO_MENU_TEXT).toMatch(/starting something new/i);
    expect(SCENARIO_MENU_TEXT).toMatch(/work and adulting/i);
    expect(SCENARIO_MENU_TEXT).toMatch(/making or keeping friends/i);
    expect(SCENARIO_MENU_TEXT).toMatch(/relationships/i);
    expect(SCENARIO_MENU_TEXT).toMatch(/something awkward happened/i);
    expect(SCENARIO_MENU_TEXT).toMatch(/online or texting/i);
  });

  it('keeps the menu / restart affordance the brief recommends retaining', () => {
    expect(SCENARIO_MENU_TEXT).toMatch(/menu/i);
    expect(SCENARIO_MENU_TEXT).toContain('/restart');
  });

  it('no longer offers a "connect with our team" option', () => {
    expect(SCENARIO_MENU_TEXT).not.toMatch(/connect with someone from our team/i);
  });
});

describe('EMERGENCY_MESSAGE (F3)', () => {
  it('gives the 1771 hotline', () => {
    expect(EMERGENCY_MESSAGE).toContain('1771');
    expect(EMERGENCY_MESSAGE).toMatch(/national mindline/i);
  });

  it('ends with the engaging question so the bot stays with the user', () => {
    expect(EMERGENCY_MESSAGE.trimEnd()).toMatch(/\?$/);
    expect(EMERGENCY_MESSAGE).toMatch(/help you think of someone/i);
  });

  it('tells them to stay near someone they trust', () => {
    expect(EMERGENCY_MESSAGE).toMatch(/stay near someone you trust/i);
  });
});

describe('referral triage by age (F2)', () => {
  it('routes 25 and under to INSIGHT', () => {
    expect(referralUrlForAge(13)).toBe(INSIGHT_URL);
    expect(referralUrlForAge(25)).toBe(INSIGHT_URL);
  });

  it('routes 26 and over to CREST', () => {
    expect(referralUrlForAge(26)).toBe(CREST_URL);
    expect(referralUrlForAge(60)).toBe(CREST_URL);
  });

  it('returns null for unknown age so the caller asks the fallback question', () => {
    expect(referralUrlForAge(null)).toBeNull();
  });

  it('the fallback question offers a 1/2 yes-no choice', () => {
    expect(REFERRAL_AGE_FALLBACK).toMatch(/25 or under/i);
    expect(REFERRAL_AGE_FALLBACK).toContain('1.');
    expect(REFERRAL_AGE_FALLBACK).toContain('2.');
  });

  it('uses the two distinct Care Corner destinations', () => {
    expect(INSIGHT_URL).toContain('insight');
    expect(CREST_URL).toContain('crest');
    expect(INSIGHT_URL).not.toBe(CREST_URL);
  });
});

describe('scenario primes (F6)', () => {
  it('defines a scenario for every menu option 1-6', () => {
    expect(Object.keys(SCENARIOS)).toHaveLength(6);
    for (let n = 1; n <= 6; n++) {
      expect(SCENARIOS[n as keyof typeof SCENARIOS]).toBeDefined();
    }
  });

  it('builds a prime naming the chosen scenario so the coach opens on-topic', () => {
    const prime = scenarioPrime(3);
    expect(prime).toMatch(/friend/i);
    expect(prime).toMatch(/\[SYSTEM CONTEXT\]/);
  });

  it('tells the coach NOT to ask which situation again', () => {
    expect(scenarioPrime(1)).toMatch(/do not ask.*which (situation|scenario)/i);
  });

  it('produces a distinct prime per scenario', () => {
    const primes = [1, 2, 3, 4, 5, 6].map(n => scenarioPrime(n as 1));
    expect(new Set(primes).size).toBe(6);
  });
});

describe('WELCOME_BACK_TEXT (returning known-age user)', () => {
  it('is short and does not repeat the full disclosures or ask for age', () => {
    expect(WELCOME_BACK_TEXT).not.toMatch(/how old are you/i);
    expect(WELCOME_BACK_TEXT).not.toMatch(/not a real person/i);
    expect(WELCOME_BACK_TEXT.length).toBeLessThan(200);
  });
});

describe('AGE_REPROMPT_TEXT', () => {
  it('makes clear the question can be skipped (it is not a gate)', () => {
    expect(AGE_REPROMPT_TEXT).toMatch(/skip/i);
  });
});
