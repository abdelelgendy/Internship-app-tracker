import { defaultTimeZone, HOUR_MS, localWeekday, toMillis, type Instant } from './dates.ts'
import { experienceBand } from './experience.ts'
import { normalizeCompany } from './normalize.ts'
import type { Job, JobFacts, QueueStatus, ScoreResult } from './types.ts'

/**
 * The recency gate. Postings are ranked by freshness, and a fresh posting needs a lower score
 * to apply to right away, because early applicants get read. These bars are the restored
 * April 28 values (decision table 1.10, #1-3) and only decide "apply now" in the first 72 hours.
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

/**
 * Past this age an unchecked posting is skipped. job-hunter skipped everything after 72 hours,
 * which is too strict for a search a person drives: new-grad postings stay open for weeks.
 * The profile can set its own limit (targeting.maxPostingAgeDays).
 */
export const DEFAULT_MAX_POSTING_AGE_DAYS = 30

// A posting dated slightly ahead of our clock is clock skew; more than this is bad data.
const FUTURE_SKEW_HOURS = 1

function ageText(hours: number): string {
  if (hours < 1) return 'less than an hour ago'
  if (hours < 48) return `${Math.floor(hours)} hour${Math.floor(hours) === 1 ? '' : 's'} ago`
  return `${Math.floor(hours / 24)} days ago`
}

/** No posting age passes a score below this, so neither a date nor a check can change the verdict. */
const LOWEST_PASSING_SCORE = Math.min(...RECENCY_BANDS.map((band) => band.minScore), LOCATION_EXCEPTION.minScore)

/** The posting-age limit in days: the profile's, when it is a positive number, else the default. */
export function maxPostingAgeDays(value: number | undefined): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : DEFAULT_MAX_POSTING_AGE_DAYS
}

export interface GateOptions {
  /** A person confirmed the posting is open (Job.verified). Age alone then never skips it. */
  verified?: boolean
  /** Skip unchecked postings older than this many days. Defaults to 30. */
  maxAgeDays?: number
  exceptionCompanies?: readonly string[]
}

/**
 * Decides apply, hold or skip from the score and the posting's age.
 * - A score below 65 is a skip at any age: no posting age passes it.
 * - Unknown or unreadable dates are a hold: a person opens the posting and adds the date.
 * - Under 72 hours, in bands [0,12), [12,24), [24,48), [48,72): a score at the band's bar is
 *   "apply"; below it the job is held, not skipped, since only its age keeps it back.
 * - From 72 hours to the age limit (30 days by default) it is a hold: confirm the posting is
 *   still open. Exception companies still pass up to 168 hours (7 days) at 85 or more.
 * - Past the limit it is a skip, unless it is verified: age alone never skips a checked posting.
 */
export function recencyGate(
  score: number,
  postedAt: string | null,
  now: Instant,
  company: string,
  options: GateOptions = {},
): ScoreResult['gate'] {
  const { verified = false, exceptionCompanies = LOCATION_EXCEPTION_COMPANIES } = options
  const limitDays = maxPostingAgeDays(options.maxAgeDays)
  if (score < LOWEST_PASSING_SCORE) {
    return { verdict: 'skip', reason: `Score ${score} is below ${LOWEST_PASSING_SCORE}, the lowest any posting age needs, so the date can't change this.` }
  }
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
  const limit = `${limitDays}-day limit`

  if (hours > limitDays * 24) {
    return verified
      ? { verdict: 'hold', reason: `${age} That is past your ${limit}, but you checked it is open. Confirm it again before you apply.` }
      : { verdict: 'skip', reason: `${age} That is past your ${limit}.` }
  }

  const band = RECENCY_BANDS.find((entry) => hours < entry.underHours)
  if (band) {
    return score >= band.minScore
      ? { verdict: 'apply', reason: `${age} Score ${score} meets the ${band.minScore} needed at ${band.label}.` }
      : { verdict: 'hold', reason: `${age} Score ${score} is below the ${band.minScore} needed to apply right away at ${band.label}. Worth a look if your queue is short.` }
  }

  const key = normalizeCompany(company)
  const isException = exceptionCompanies.some((name) => normalizeCompany(name) === key)
  if (isException && hours <= LOCATION_EXCEPTION.maxAgeHours && score >= LOCATION_EXCEPTION.minScore) {
    return {
      verdict: 'apply',
      reason: `${age} ${company} is on the exception list, open for 7 days at ${LOCATION_EXCEPTION.minScore}. Score ${score} meets it.`,
    }
  }
  return { verdict: 'hold', reason: `${age} Older than 72 hours, so confirm the posting is still open before you apply.` }
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
 * gate: a score below every bar, or an unchecked posting past the age limit.
 */
export function queueStatusFor(result: ScoreResult, signals: { duplicate?: boolean; ghost?: string | null } = {}): QueueStatus {
  if (signals.duplicate) return 'skipped_duplicate'
  if (result.disqualifiers.length > 0) return 'skipped_dealbreaker'
  if (signals.ghost) return 'skipped_ghost'
  if (result.gate.verdict === 'skip') return 'skipped_age'
  return 'queued'
}
