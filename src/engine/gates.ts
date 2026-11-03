import { defaultTimeZone, HOUR_MS, localWeekday, toMillis, type Instant } from './dates.ts'
import { experienceBand } from './experience.ts'
import { normalizeCompany } from './normalize.ts'
import type { Job, JobFacts, QueueStatus, ScoreResult } from './types.ts'

/**
 * The recency gate: a fresh posting needs a lower score than an old one, because early
 * applicants get read. Thresholds are the restored April 28 values (decision table 1.10, #1-3).
 */
export const RECENCY_BANDS = [
  { underHours: 12, minScore: 65, label: 'under 12 hours' },
  { underHours: 24, minScore: 70, label: '12 to 24 hours' },
  { underHours: 48, minScore: 75, label: '24 to 48 hours' },
  { underHours: 72, minScore: 85, label: '48 to 72 hours' },
] as const

/** Companies whose postings stay worth applying to for a week, at a higher score. */
export const LOCATION_EXCEPTION = { maxAgeHours: 168, minScore: 85 } as const
export const LOCATION_EXCEPTION_COMPANIES = [
  'Google', 'Meta', 'Amazon', 'Apple', 'Microsoft', 'Stripe', 'Databricks', 'Coinbase',
  'Shopify', 'Vercel', 'Supabase', 'Linear', 'Notion', 'Figma',
] as const

// A posting dated slightly ahead of our clock is clock skew; more than this is bad data.
const FUTURE_SKEW_HOURS = 1

function ageText(hours: number): string {
  if (hours < 1) return 'less than an hour ago'
  if (hours < 48) return `${Math.floor(hours)} hour${Math.floor(hours) === 1 ? '' : 's'} ago`
  return `${Math.floor(hours / 24)} days ago`
}

/**
 * Decides apply, hold or skip from the score and the posting's age.
 * - Unknown or unreadable dates are a hold: a person opens the posting and adds the date.
 * - Ages fall in [0,12), [12,24), [24,48), [48,72) hours.
 * - From 72 hours on, only exception companies pass, up to 168 hours (7 days), at 85 or more.
 */
export function recencyGate(
  score: number,
  postedAt: string | null,
  now: Instant,
  company: string,
  exceptionCompanies: readonly string[] = LOCATION_EXCEPTION_COMPANIES,
): ScoreResult['gate'] {
  if (postedAt === null || postedAt.trim() === '') {
    return { verdict: 'hold', reason: 'Posting date unknown. Add it from the posting to run the recency check.' }
  }
  const posted = toMillis(postedAt)
  const nowMs = toMillis(now)
  if (posted === null || nowMs === null) {
    return { verdict: 'hold', reason: `Posting date "${postedAt}" can't be read. Fix it to run the recency check.` }
  }
  const rawHours = (nowMs - posted) / HOUR_MS
  if (rawHours < -FUTURE_SKEW_HOURS) {
    return { verdict: 'hold', reason: 'Posting date is in the future. Check it against the posting.' }
  }
  const hours = Math.max(0, rawHours)
  const age = `Posted ${ageText(hours)}.`

  const band = RECENCY_BANDS.find((entry) => hours < entry.underHours)
  if (band) {
    return score >= band.minScore
      ? { verdict: 'apply', reason: `${age} Score ${score} meets the ${band.minScore} needed at ${band.label}.` }
      : { verdict: 'skip', reason: `${age} Score ${score} is below the ${band.minScore} needed at ${band.label}.` }
  }

  const key = normalizeCompany(company)
  const isException = exceptionCompanies.some((name) => normalizeCompany(name) === key)
  if (!isException || hours > LOCATION_EXCEPTION.maxAgeHours) {
    return { verdict: 'skip', reason: `${age} That is past the 72-hour window.` }
  }
  return score >= LOCATION_EXCEPTION.minScore
    ? { verdict: 'apply', reason: `${age} ${company} is an exception company, open for 7 days at ${LOCATION_EXCEPTION.minScore}; score ${score} meets it.` }
    : { verdict: 'skip', reason: `${age} ${company} is an exception company, open for 7 days at ${LOCATION_EXCEPTION.minScore}; score ${score} is below it.` }
}

/** Tier 1 is entry level, tier 2 asks for a little experience or does not say, tier 3 is a stretch. */
export function tierOf(facts: JobFacts): 1 | 2 | 3 {
  return experienceBand(facts).tier
}

function tierRank(job: Job): number {
  if (!job.score) return 5
  return job.score.tier ?? 4
}

/** Queue order: tier first, then newest posting, then higher score. Unscored and disqualified jobs go last. */
export function byQueueOrder(a: Job, b: Job): number {
  const tier = tierRank(a) - tierRank(b)
  if (tier !== 0) return tier
  const aPosted = toMillis(a.postedAt)
  const bPosted = toMillis(b.postedAt)
  if (aPosted !== bPosted) {
    if (aPosted === null) return 1
    if (bPosted === null) return -1
    return bPosted - aPosted
  }
  return (b.score?.total ?? 0) - (a.score?.total ?? 0)
}

/** Daily caps by weekday, Sunday first. A user setting; the default is 10 on weekdays and none on weekends. */
export const DEFAULT_DAILY_CAPS: readonly number[] = [0, 10, 10, 10, 10, 10, 0]

/** How many applications to aim for on the local day of `now`. Every one is still submitted by hand. */
export function dailyCapFor(
  now: Instant,
  caps: readonly number[] = DEFAULT_DAILY_CAPS,
  timeZone: string = defaultTimeZone(),
): number {
  return caps[localWeekday(now, timeZone)] ?? 0
}

/**
 * The queue status a scored job should get. `skipped_age` means it failed the recency and score
 * gate, which includes a fresh posting whose score is too low for its age band.
 */
export function queueStatusFor(result: ScoreResult, signals: { duplicate?: boolean; ghost?: string | null } = {}): QueueStatus {
  if (signals.duplicate) return 'skipped_duplicate'
  if (result.disqualifiers.length > 0) return 'skipped_dealbreaker'
  if (signals.ghost) return 'skipped_ghost'
  if (result.gate.verdict === 'skip') return 'skipped_age'
  return 'queued'
}
