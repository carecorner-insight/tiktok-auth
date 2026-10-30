import type { computeMonthlyReport } from './report';

type MonthlyReport = ReturnType<typeof computeMonthlyReport>;
type Ratio = MonthlyReport['K1_usefulness'];

export interface MonthlyMetric {
  metricCode: string;
  metricLabel: string;
  group: 'core' | 'outcome' | 'coverage' | 'safety';
  unit: 'percent' | 'count';
  value: number | null;
  numerator: number | null;
  denominator: number | null;
  status: 'available' | 'no_denominator' | 'not_available';
  note: string;
}

/** Shared aggregate rows for the staff page and Power BI. These are calculated
 * observations, not new participant events or clinically validated outcomes. */
export function monthlyMetrics(report: MonthlyReport): MonthlyMetric[] {
  const metrics: MonthlyMetric[] = [];
  const percentage = (metricCode: string, metricLabel: string, group: MonthlyMetric['group'], result: Ratio, note: string) => {
    metrics.push({ metricCode, metricLabel, group, unit: 'percent', value: result.percent,
      numerator: result.numerator, denominator: result.denominator,
      status: result.denominator ? 'available' : 'no_denominator', note });
  };
  const count = (metricCode: string, metricLabel: string, group: MonthlyMetric['group'], value: number, note: string) => {
    metrics.push({ metricCode, metricLabel, group, unit: 'count', value, numerator: value,
      denominator: null, status: 'available', note });
  };

  percentage('K1_usefulness', 'K1 · Reported usefulness', 'core', report.K1_usefulness,
    'Latest valid yes/no answer per active user. Target: at least 70%.');
  percentage('K2a_scenarioCompletion', 'K2a · Scenario completion', 'core', report.K2a_scenarioCompletion,
    'Delivered check-in / scenario runs started this month. Late completions revise the start month.');
  percentage('K2b_scenarioParticipation', 'K2b · Scenario participation', 'core', report.K2b_scenarioParticipation,
    'Active users starting at least one scenario / all active users.');
  percentage('K3_twoSessionStartDays', 'K3 · Repeat use within the month', 'core', report.K3_twoSessionStartDays,
    'Users with session starts on at least two Singapore dates / active users.');
  count('K4_monthlyActiveUsers', 'K4 · Monthly active users', 'core', report.K4_monthlyActiveUsers,
    'Distinct active users aged 13–30; registered testers excluded. Target: 70–120.');
  percentage('K5_anyPriorMonthReturners', 'K5 · Returning users', 'core', report.K5_anyPriorMonthReturners,
    'Active users with eligible activity in any earlier collected month / active users. Target: 25–35%.');
  metrics.push({ metricCode: 'K6_conversion', metricLabel: 'K6 · Salesforce conversion', group: 'core',
    unit: 'percent', value: null, numerator: null, denominator: report.K6_conversion.insightOfferedUsers,
    status: 'not_available', note: 'Requires matched client records and service dates. Referral clicks are not conversions.' });
  percentage('readinessAmongRespondents', 'Readiness among respondents', 'outcome', report.derived.readinessAmongRespondents,
    'Completed runs answering 2 or 3 / completed runs with a valid 1–3 answer.');
  percentage('scriptChoice', 'Script adoption during practice', 'outcome', report.scriptChoice,
    'Prepare-mode runs with an explicit script adoption / Prepare-mode runs. Does not assess appropriateness.');
  percentage('clarityByUser', 'Reported increase in clarity', 'outcome', report.derived.clarityByUser,
    'Users whose latest complete pair improved / users with complete pairs. Retrospective self-report, not causation.');
  percentage('requestedReferralUserRate', 'Users with a request fulfilled by referral', 'outcome', report.derived.requestedReferralUserRate,
    'Unique users sent a user-requested referral / active users. Unfulfilled or unclassified requests are not counted.');
  percentage('observedReferralAccessUserRate', 'Users associated with referral-link access', 'outcome', report.derived.observedReferralAccessUserRate,
    'Recipients associated with recorded link access / active users. Accessor identity and service attendance are not verified.');
  percentage('transitionAmongReturners', 'Transition scenarios among returners', 'outcome', report.derived.transitionAmongReturners,
    'K5 returners starting Starting something new / all K5 returners. Does not verify a real-life transition.');
  percentage('earlyReferralUserRate', 'Users with a recorded early referral', 'outcome', report.derived.earlyReferralUserRate,
    'Recipients with at least one complete-history tier 1–2 referral / all recipients. Review unresolved histories below.');
  percentage('readinessCoverage', 'Readiness response coverage', 'coverage', report.readinessCoverage,
    'Completed runs with a valid readiness answer / completed runs. Missing is not a negative answer.');
  percentage('clarityCoverage', 'Clarity pair coverage', 'coverage', report.clarityCoverage,
    'Complete same-month clarity pairs / delivered clarity offers; this is not a unique-user rate.');
  count('earlyReferralUnresolvedUsers', 'Recipients with unresolved early-referral status', 'coverage', report.derived.earlyReferralUnresolvedUsers,
    'No known early referral, with at least one missing or inconclusive tier history. Do not classify as late or low risk.');
  count('insightOfferedUsers', 'Users sent an INSIGHT referral', 'coverage', report.K6_conversion.insightOfferedUsers,
    'The available denominator for K6; successful service uptake is not collected.');
  count('tier3Sessions', 'Sessions with a tier 3 estimate', 'safety', report.distress.tier3Sessions, 'AI estimates requiring staff validation; session counts can overlap.');
  count('tier4Sessions', 'Sessions with a tier 4 estimate', 'safety', report.distress.tier4Sessions, 'AI estimates requiring staff validation; session counts can overlap.');
  count('state8Sessions', 'Sessions receiving crisis support', 'safety', report.distress.state8Sessions, 'Delivered State 8 response; separate from the AI tier estimate.');
  return metrics;
}

/** Updating one SharePoint item replaces a month's full aggregate set atomically.
 * This item bypasses the raw-event receiver, which accepts participant events only. */
export function monthlyListItem(report: MonthlyReport, metrics: MonthlyMetric[], health: {
  collectionEnabled: boolean; pendingEvents: number; receiverConfigured: boolean;
}) {
  return {
    Title: `Carey monthly KPIs ${report.monthSGT}`,
    eventId: `kpi-report:${report.monthSGT}`,
    eventType: 'monthly_report',
    monthSGT: report.monthSGT,
    occurredAt: report.asOf,
    eventJson: JSON.stringify({
      schemaVersion: 'carey-kpi-monthly-report-v1',
      monthSGT: report.monthSGT, asOf: report.asOf, revision: report.revision,
      definitionVersion: report.definitionVersion, policyVersion: report.policyVersion,
      provisional: true, source: 'redis', ...health, metrics,
    }),
  };
}
