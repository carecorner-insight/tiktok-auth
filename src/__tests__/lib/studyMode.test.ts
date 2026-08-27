import { applyStudyEnv, STUDY_ENV_DEFAULTS } from '@/lib/studyMode';

describe('applyStudyEnv', () => {
  it('forces the NUS-study flag configuration onto the environment', () => {
    // Pivot-style env, as set on the live deployment.
    const env: Record<string, string | undefined> = {
      SCREENER_ENABLED: 'false',
      AUTH_ENABLED: 'false',
      SCENARIO_MENU: 'true',
      USE_DIRECT_LLM: 'true',
    };

    applyStudyEnv(env);

    expect(env.SCREENER_ENABLED).toBe('true');
    expect(env.AUTH_ENABLED).toBe('true');
    expect(env.SCENARIO_MENU).toBe('false');
    expect(env.CRISIS_STATIC_FIRST).toBe('true');
    expect(env.USE_DIRECT_LLM).toBe('false');
  });

  it('lets an explicit STUDY_* variable override each default', () => {
    const env: Record<string, string | undefined> = {
      STUDY_USE_DIRECT_LLM: 'true',
      USE_DIRECT_LLM: 'false',
    };

    applyStudyEnv(env);

    expect(env.USE_DIRECT_LLM).toBe('true');
    // Non-overridden keys still get the study default.
    expect(env.SCREENER_ENABLED).toBe('true');
  });

  it('leaves unrelated variables untouched', () => {
    const env: Record<string, string | undefined> = { TELEGRAM_BOT_TOKEN: 'x' };
    applyStudyEnv(env);
    expect(env.TELEGRAM_BOT_TOKEN).toBe('x');
  });

  it('covers every flag the pivot introduced', () => {
    expect(Object.keys(STUDY_ENV_DEFAULTS).sort()).toEqual([
      'AUTH_ENABLED',
      'CRISIS_STATIC_FIRST',
      'DYNAMIC_COACH_PROMPT',
      'SCENARIO_MENU',
      'SCREENER_ENABLED',
      'USE_DIRECT_LLM',
    ]);
  });
});
