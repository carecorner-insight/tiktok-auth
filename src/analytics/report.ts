import { createHash } from 'crypto';
import { type KpiEvent, type Score, sgtDate, POLICY_VERSION } from './contract';

// Version denominators and units independently of participant collection rules.
export const REPORT_DEFINITION_VERSION = 'carey-monthly-metrics-v1';

function validScore(value: Score): value is '1' | '2' | '3' {
  return value === '1' || value === '2' || value === '3';
}

function ratio(numerator: number, denominator: number) {
  return { numerator, denominator, percent: denominator ? Math.round(numerator / denominator * 10000) / 100 : null };
}

/** Compute from observed facts, never repeated snapshots. Report revisions have
 * a deterministic source hash and as-of time; late check-ins revise start month. */
export function computeMonthlyReport(
  input: KpiEvent[], month: string, asOf = Date.now(), priorUsers = new Set<string>(),
) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error('Expected a YYYY-MM month');
  const testers = new Set(input.filter(event => event.isTester).map(event => event.userKey));
  const dedup = new Map<string, KpiEvent>();
  for (const event of input) {
    if (!testers.has(event.userKey) && Date.parse(event.occurredAt) <= asOf && Date.parse(event.receivedAt) <= asOf) dedup.set(event.eventId, event);
  }
  const events = [...dedup.values()].sort((a, b) => {
    const timeOrder = a.occurredAt.localeCompare(b.occurredAt);
    if (timeOrder) return timeOrder;
    // Telegram dates have only second precision. Its monotonically increasing
    // update ID disambiguates two genuine ratings received in the same second.
    if (a.sourceMessageId && b.sourceMessageId && /^\d+$/.test(a.sourceMessageId) && /^\d+$/.test(b.sourceMessageId)) {
      const left = BigInt(a.sourceMessageId);
      const right = BigInt(b.sourceMessageId);
      if (left !== right) return left < right ? -1 : 1;
    }
    return a.receivedAt.localeCompare(b.receivedAt) || a.eventId.localeCompare(b.eventId);
  });
  const monthly = events.filter(event => event.monthSGT === month);
  // Learning age later in the SAME month establishes that month's cohort.
  // It does not backfill eligibility into earlier unknown-age months.
  const eligible = new Set(monthly.filter(event => event.eligibility === 'eligible').map(event => event.userKey));
  const active = new Set(monthly.filter(event => event.eventType === 'activity' && eligible.has(event.userKey)).map(event => event.userKey));
  const contacts = new Set(monthly.filter(event => event.eventType === 'activity').map(event => event.userKey));
  const unknown = [...contacts].filter(key => !monthly.some(event => event.userKey === key && event.eligibility !== 'missing'));
  const ratings = new Map<string, KpiEvent>();
  for (const event of monthly) {
    if (active.has(event.userKey) && event.eventType === 'response_recorded' && event.question === 'usefulness' && ['yes', 'no'].includes(event.response)) ratings.set(event.userKey, event);
  }
  const starts = new Map<string, KpiEvent>();
  for (const event of events) {
    if (event.eventType === 'scenario_started' && event.scenarioRunId && event.scenarioStartMonthSGT === month && eligible.has(event.userKey)) starts.set(event.scenarioRunId, event);
  }
  const complete = new Set(events.filter(event => event.eventType === 'checkin_reached' && event.deliveryStatus === 'sent' && event.scenarioRunId && starts.has(event.scenarioRunId)).map(event => event.scenarioRunId!));
  const scenarioUsers = new Set([...starts.values()].filter(event => active.has(event.userKey)).map(event => event.userKey));
  const readiness = new Map<string, Score>();
  const scripts = new Set<string>();
  for (const event of events) {
    if (!event.scenarioRunId || !starts.has(event.scenarioRunId)) continue;
    if (event.eventType === 'response_recorded' && event.question === 'readiness' && validScore(event.response as Score)) readiness.set(event.scenarioRunId, event.response as Score);
    if (event.eventType === 'script_selected' && event.response === 'yes') scripts.add(event.scenarioRunId);
  }
  const pairs = new Map<string, { userKey: string; before?: number; after?: number; afterOrder: number }>();
  const offers = new Map<string, KpiEvent>();
  for (const [eventOrder, event] of monthly.entries()) {
    if (!active.has(event.userKey) || !event.feedbackId) continue;
    if (event.eventType === 'feedback_offered' && event.question !== 'clarityAfter' && event.deliveryStatus === 'sent') offers.set(event.feedbackId, event);
    if (event.eventType === 'response_recorded' && validScore(event.response as Score)) {
      // Never stitch different people's answers together, even if a bad source
      // record reuses a feedback ID. Events are already in timestamp order.
      const pairKey = `${event.userKey}:${event.feedbackId}`;
      const pair = pairs.get(pairKey) ?? { userKey: event.userKey, afterOrder: -1 };
      if (event.question === 'clarityBefore') pair.before = Number(event.response);
      if (event.question === 'clarityAfter') {
        pair.after = Number(event.response);
        pair.afterOrder = eventOrder;
      }
      pairs.set(pairKey, pair);
    }
  }
  const completePairs = [...pairs.values()].filter(pair => pair.before !== undefined && pair.after !== undefined);
  const sessionDays = new Map<string, Set<string>>();
  for (const event of monthly) {
    if (!active.has(event.userKey) || event.eventType !== 'session_started' || !event.sessionStartObserved || !event.sessionStartedAt) continue;
    const days = sessionDays.get(event.userKey) ?? new Set<string>();
    days.add(sgtDate(Date.parse(event.sessionStartedAt)));
    sessionDays.set(event.userKey, days);
  }
  const previous = new Set([...priorUsers, ...events.filter(event => event.monthSGT < month && event.eventType === 'activity' && event.eligibility === 'eligible').map(event => event.userKey)]);
  const referrals = monthly.filter(event => event.eventType === 'referral_delivered' && event.deliveryStatus === 'sent' && active.has(event.userKey));
  const prepareRuns = [...starts.values()].filter(start => events.some(event => event.scenarioRunId === start.scenarioRunId && event.mode === 'prepare'));
  const earlyKnown = referrals.filter(event => event.tierHistoryComplete && event.maxTierBeforeReferral !== 'missing');
  const sessionsAtTier = (tier: string) => new Set(monthly.filter(event => active.has(event.userKey) && event.eventType === 'tier_estimated' && event.tier === tier && event.sessionId).map(event => event.sessionId)).size;
  const newScenarioUsers = new Set([...starts.values()].filter(event => event.scenarioTag === '1').map(event => event.userKey));
  const readinessAnswered = [...readiness.keys()].filter(id => complete.has(id)).length;
  const readinessPositive = [...readiness.entries()].filter(([id, score]) => complete.has(id) && Number(score) >= 2).length;
  const latestClarityByUser = new Map<string, typeof completePairs[number]>();
  for (const pair of completePairs) {
    const current = latestClarityByUser.get(pair.userKey);
    if (!current || pair.afterOrder > current.afterOrder) latestClarityByUser.set(pair.userKey, pair);
  }
  const returners = new Set([...active].filter(key => previous.has(key)));
  const referralRecipients = new Set(referrals.map(event => event.userKey));
  const earlyRecipients = new Set<string>();
  const unresolvedRecipients = new Set<string>();
  for (const referral of referrals) {
    const lowMaximum = referral.maxTierBeforeReferral === '1' || referral.maxTierBeforeReferral === '2';
    if (lowMaximum && referral.tierHistoryComplete) {
      earlyRecipients.add(referral.userKey);
    } else if (referral.maxTierBeforeReferral === 'missing' || (lowMaximum && !referral.tierHistoryComplete)) {
      unresolvedRecipients.add(referral.userKey);
    }
    // An observed maximum of 3/4 rules out early delivery for this referral,
    // even when another part of the history was not measured.
  }
  for (const key of earlyRecipients) unresolvedRecipients.delete(key);
  return {
    monthSGT: month, asOf: new Date(asOf).toISOString(), policyVersion: POLICY_VERSION,
    definitionVersion: REPORT_DEFINITION_VERSION,
    revision: createHash('sha256').update(JSON.stringify({
      events, previous: [...previous].sort(), definitionVersion: REPORT_DEFINITION_VERSION,
    })).digest('hex').slice(0, 16),
    K1_usefulness: ratio([...ratings.values()].filter(event => event.response === 'yes').length, ratings.size),
    K2a_scenarioCompletion: ratio(complete.size, starts.size),
    K2b_scenarioParticipation: ratio(scenarioUsers.size, active.size),
    K3_twoSessionStartDays: ratio([...sessionDays.values()].filter(days => days.size >= 2).length, active.size),
    K4_monthlyActiveUsers: active.size,
    K5_anyPriorMonthReturners: ratio([...active].filter(key => previous.has(key)).length, active.size),
    K6_conversion: { status: 'deferred_salesforce_matching', insightOfferedUsers: new Set(referrals.filter(event => event.referralTarget === 'insight').map(event => event.userKey)).size },
    readiness: ratio(readinessPositive, complete.size),
    readinessCoverage: ratio(readinessAnswered, complete.size),
    scriptChoice: ratio(prepareRuns.filter(run => scripts.has(run.scenarioRunId!)).length, prepareRuns.length),
    retrospectiveClarity: ratio(completePairs.filter(pair => pair.after! > pair.before!).length, completePairs.length),
    clarityCoverage: ratio(completePairs.length, [...offers.values()].filter(event => event.question === 'clarityBefore').length),
    feedback: { offers: offers.size, usefulnessOffers: [...offers.values()].filter(event => event.question === 'usefulness').length, usefulnessRaters: ratings.size, clarityOffers: [...offers.values()].filter(event => event.question === 'clarityBefore').length, completeClarityPairs: completePairs.length },
    earlySupport: ratio(earlyKnown.filter(event => Number(event.maxTierBeforeReferral) < 3).length, earlyKnown.length),
    support: { userRequested: referrals.filter(event => event.referralSource === 'user_requested').length, botSuggested: referrals.filter(event => event.referralSource === 'bot_suggested').length, sourceMissing: referrals.filter(event => event.referralSource === 'missing').length, missingTierHistory: referrals.length - earlyKnown.length, observedClicks: monthly.filter(event => event.eventType === 'referral_clicked' && active.has(event.userKey)).length },
    distress: { tier3Sessions: sessionsAtTier('3'), tier4Sessions: sessionsAtTier('4'), state8Sessions: new Set(monthly.filter(event => active.has(event.userKey) && event.deliveryStatus === 'sent' && event.state8Reached && event.sessionId).map(event => event.sessionId)).size, label: 'AI estimates; staff validation required' },
    startingSomethingNewReturners: ratio([...newScenarioUsers].filter(key => previous.has(key)).length, newScenarioUsers.size),
    // Keep existing measures intact. These named user/respondent measures use
    // the additional denominators documented in the calculation guide.
    derived: {
      readinessAmongRespondents: ratio(readinessPositive, readinessAnswered),
      clarityByUser: ratio([...latestClarityByUser.values()].filter(pair => pair.after! > pair.before!).length, latestClarityByUser.size),
      requestedReferralUserRate: ratio(new Set(referrals.filter(event => event.referralSource === 'user_requested').map(event => event.userKey)).size, active.size),
      observedReferralAccessUserRate: ratio(new Set(monthly.filter(event => event.eventType === 'referral_clicked' && active.has(event.userKey)).map(event => event.userKey)).size, active.size),
      transitionAmongReturners: ratio([...returners].filter(key => newScenarioUsers.has(key)).length, returners.size),
      earlyReferralUserRate: ratio(earlyRecipients.size, referralRecipients.size),
      earlyReferralUnresolvedUsers: unresolvedRecipients.size,
    },
    dataQuality: { unknownAgeContacts: unknown.length, excludedTesters: testers.size, retainedEvents: events.length, responseMissingValue: 'missing', historicalBackfill: false },
  };
}
