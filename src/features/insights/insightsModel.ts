import { DAY_MS, localDay, localWeekday, toMillis, type Instant } from '../../engine/dates.ts'
import { tierOf } from '../../engine/gates.ts'
import { factsFor } from '../../engine/score.ts'
import { AWAITING_REPLY, wasSubmitted } from '../../engine/states.ts'
import { compareRates, gotInterview, gotOffer, gotResponse, MIN_SAMPLE, rateOf, segmentRates, type Rate } from '../../engine/stats.ts'
import type { AppStatus, Application, Job } from '../../engine/types.ts'

/**
 * What the Insights page shows, worked out with the engine's honest-rate rules: counts are
 * always shown, a rate only from MIN_SAMPLE submitted applications, and every rate with its
 * Wilson 95% range. "A reply" means a person answered (an assessment, interview, offer or
 * rejection); automatic receipts do not count.
 */

// ---------- Funnel ----------

export interface FunnelStage {
  id: 'submitted' | 'reply' | 'interview' | 'offer'
  label: string
  count: number
  /** Share of submitted applications that reached this stage. Not shown below the minimum sample. */
  rate: Rate
}

export interface Funnel {
  stages: FunnelStage[]
  /** Drafts and prepared applications: not sent yet, so not in the funnel. */
  unsent: number
  awaitingReply: number
  /** How many applications are in each status right now, in the state machine's order. */
  byStatus: { status: AppStatus; count: number }[]
}

const STATUS_ORDER: readonly AppStatus[] = [
  'draft', 'prepared', 'applied', 'confirmed', 'reviewing', 'assessment_pending', 'interview_scheduled', 'offer', 'rejected', 'ghosted', 'withdrawn',
]

export function funnelOf(apps: readonly Application[]): Funnel {
  const submitted = apps.filter(wasSubmitted)
  const stage = (id: FunnelStage['id'], label: string, test: (app: Application) => boolean): FunnelStage => {
    const count = submitted.filter(test).length
    return { id, label, count, rate: rateOf(count, submitted.length) }
  }
  const counts = new Map<AppStatus, number>()
  for (const app of apps) counts.set(app.status, (counts.get(app.status) ?? 0) + 1)
  return {
    stages: [
      stage('submitted', 'Sent', () => true),
      stage('reply', 'A person replied', gotResponse),
      stage('interview', 'Interview', gotInterview),
      stage('offer', 'Offer', gotOffer),
    ],
    unsent: apps.length - submitted.length,
    awaitingReply: submitted.filter((app) => AWAITING_REPLY.includes(app.status)).length,
    byStatus: STATUS_ORDER.flatMap((status) => (counts.get(status) ? [{ status, count: counts.get(status) ?? 0 }] : [])),
  }
}

// ---------- Reply rate by group ----------

export type DimensionId = 'source' | 'tier' | 'size' | 'workplace'

export interface SegmentGroup {
  key: string
  label: string
  rate: Rate
}

export interface Segment {
  id: DimensionId
  title: string
  groups: SegmentGroup[]
  /** Submitted applications with no value for this dimension (no saved job, or no company size). */
  missing: number
  missingNote: string | null
  /** Whether the highest and lowest shown rates differ enough to act on; null with fewer than two shown. */
  comparison: string | null
}

const SOURCE_LABELS: Record<string, string> = {
  greenhouse: 'Greenhouse boards',
  ashby: 'Ashby boards',
  lever: 'Lever boards',
  manual: 'Added by hand',
  'web-search': 'Web search',
  'job-hunter-import': 'Imported from job-hunter',
}

const TIER_LABELS: Record<1 | 2 | 3, string> = {
  1: 'Entry level (tier 1)',
  2: 'Some experience or not stated (tier 2)',
  3: 'A stretch (tier 3)',
}

const WORKPLACE_LABELS: Record<Job['workplace'], string> = { remote: 'Remote', hybrid: 'Hybrid', onsite: 'On-site', unknown: 'Not stated' }

/** Company size bands from job-hunter's learning report, plus "under 10". */
export function sizeBand(size: number | undefined): string | null {
  if (size === undefined || !Number.isFinite(size) || size <= 0) return null
  if (size < 10) return 'Under 10 people'
  if (size <= 50) return '10 to 50 people'
  if (size <= 200) return '51 to 200 people'
  if (size <= 500) return '201 to 500 people'
  return 'More than 500 people'
}

const SIZE_ORDER = ['Under 10 people', '10 to 50 people', '51 to 200 people', '201 to 500 people', 'More than 500 people']

function sourceLabel(source: string): string {
  return SOURCE_LABELS[source] ?? source.replace(/[-_]+/g, ' ').replace(/^./, (first) => first.toUpperCase())
}

const DIMENSIONS: Record<DimensionId, { title: string; keyOf: (job: Job) => string | null; missing: (count: number) => string; order?: readonly string[] }> = {
  source: { title: 'Where you found the job', keyOf: (job) => sourceLabel(job.source), missing: (n) => `${n} without a saved job ${n === 1 ? 'is' : 'are'} left out.` },
  tier: { title: 'Experience the posting asks for', keyOf: (job) => TIER_LABELS[tierOf(factsFor(job))], missing: (n) => `${n} without a saved job ${n === 1 ? 'is' : 'are'} left out.`, order: Object.values(TIER_LABELS) },
  size: { title: 'Company size', keyOf: (job) => sizeBand(job.companySize), missing: (n) => `${n} ${n === 1 ? 'has' : 'have'} no company size on the job, so ${n === 1 ? 'it is' : 'they are'} left out.`, order: SIZE_ORDER },
  workplace: { title: 'Workplace', keyOf: (job) => WORKPLACE_LABELS[job.workplace], missing: (n) => `${n} without a saved job ${n === 1 ? 'is' : 'are'} left out.`, order: Object.values(WORKPLACE_LABELS) },
}

export const DIMENSION_IDS = Object.keys(DIMENSIONS) as DimensionId[]

export function segmentOf(id: DimensionId, apps: readonly Application[], jobs: readonly Job[]): Segment {
  const dimension = DIMENSIONS[id]
  const byId = new Map(jobs.map((job) => [job.id, job]))
  const keyOf = (app: Application) => {
    const job = byId.get(app.jobId)
    return job ? dimension.keyOf(job) : null
  }
  const rates = segmentRates(apps, keyOf)
  const order = dimension.order
  const groups = rates
    .map(({ key, rate }) => ({ key, label: key, rate }))
    .sort((a, b) => (order ? order.indexOf(a.key) - order.indexOf(b.key) : 0))
  const missing = apps.filter(wasSubmitted).length - groups.reduce((sum, group) => sum + group.rate.n, 0)

  const shown = groups.filter((group) => group.rate.shown && group.rate.rate !== null)
  let comparison: string | null = null
  if (shown.length >= 2) {
    const sorted = [...shown].sort((a, b) => (b.rate.rate ?? 0) - (a.rate.rate ?? 0))
    const [high, low] = [sorted[0], sorted[sorted.length - 1]]
    comparison = `${high.label} and ${low.label}: ${compareRates(high.rate, low.rate).note}`
  }
  return { id, title: dimension.title, groups, missing, missingNote: missing > 0 ? dimension.missing(missing) : null, comparison }
}

// ---------- Applications per week ----------

export interface WeekCount {
  /** The Monday that starts the week, as YYYY-MM-DD in the user's zone. */
  start: string
  count: number
  /** The week that holds today, still running. */
  current: boolean
}

function shiftDay(day: string, days: number): string {
  const [year, month, date] = day.split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, date) + days * DAY_MS).toISOString().slice(0, 10)
}

/** The Monday of the local week holding an instant. */
export function weekStart(at: Instant, timeZone: string): string {
  return shiftDay(localDay(at, timeZone), -((localWeekday(at, timeZone) + 6) % 7))
}

/** Submitted applications per local week (Monday to Sunday), for the last `weeks` weeks, oldest first. */
export function weeklyCounts(apps: readonly Application[], now: Instant, timeZone: string, weeks = 12): WeekCount[] {
  const thisWeek = weekStart(now, timeZone)
  const starts = Array.from({ length: weeks }, (_, index) => shiftDay(thisWeek, (index - weeks + 1) * 7))
  const counts = new Map(starts.map((start) => [start, 0]))
  for (const app of apps) {
    if (!wasSubmitted(app) || toMillis(app.appliedAt) === null) continue
    const start = weekStart(app.appliedAt as string, timeZone)
    if (counts.has(start)) counts.set(start, (counts.get(start) ?? 0) + 1)
  }
  return starts.map((start) => ({ start, count: counts.get(start) ?? 0, current: start === thisWeek }))
}

/** Evenly spaced whole-number ticks from 0 that cover the largest value: 0-1-2-3, 0-2-4, 0-5-10. */
export function countTicks(max: number): number[] {
  if (max <= 0) return [0, 1]
  const step = [1, 2, 5, 10, 20, 25, 50, 100].find((candidate) => Math.ceil(max / candidate) <= 5) ?? Math.ceil(max / 5)
  const top = Math.ceil(max / step) * step
  return Array.from({ length: top / step + 1 }, (_, index) => index * step)
}

// ---------- Wording ----------

export function percent(value: number): string {
  return `${Math.round(value * 100)}%`
}

/** "42%, likely 19% to 68%" for a shown rate; null below the minimum sample. */
export function rateText(rate: Rate): string | null {
  if (!rate.shown || rate.rate === null || !rate.interval) return null
  return `${percent(rate.rate)}, likely ${percent(rate.interval.low)} to ${percent(rate.interval.high)}`
}

/** The line under the page title. */
export function headline(funnel: Funnel): string {
  const [sent, reply] = funnel.stages
  if (sent.count === 0) return 'Nothing sent yet. Rates appear here once applications go out.'
  const share = rateText(reply.rate)
  const replies = `${reply.count} got a reply from a person`
  const tail = share ? ` (${share}).` : `. A rate shows from ${MIN_SAMPLE} sent.`
  return `${sent.count} application${sent.count === 1 ? '' : 's'} sent. ${replies}${tail}`
}
