import { AWAITING_REPLY, wasSubmitted } from './states.ts'
import type { AppStatus, Application } from './types.ts'

/**
 * Rates with honest uncertainty. A rate is shown only from 10 outcomes up, always with a Wilson
 * 95% interval, and two rates count as different only when they are 5+ points apart and their
 * intervals do not overlap. The old learning report recommended changes from 5 points on 10
 * outcomes, which is noise.
 */
export const MIN_SAMPLE = 10
export const MIN_DIFFERENCE_POINTS = 5
const Z_95 = 1.959963984540054

export interface Interval {
  low: number
  high: number
}

/** Wilson score interval for a proportion. Better than the normal approximation at small n and near 0 or 1. */
export function wilsonInterval(successes: number, n: number, z: number = Z_95): Interval {
  if (!Number.isInteger(successes) || !Number.isInteger(n) || successes < 0 || n < 0 || successes > n) {
    throw new RangeError(`Need whole numbers with 0 <= successes <= n; got ${successes} of ${n}.`)
  }
  if (n === 0) return { low: 0, high: 1 }
  const p = successes / n
  const z2 = z * z
  const denominator = 1 + z2 / n
  const center = (p + z2 / (2 * n)) / denominator
  const half = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denominator
  return { low: Math.max(0, center - half), high: Math.min(1, center + half) }
}

export interface Rate {
  successes: number
  n: number
  /** Null below the minimum sample: there is not enough data to show a rate. */
  rate: number | null
  interval: Interval | null
  shown: boolean
  note: string
}

function percent(value: number): string {
  return `${Math.round(value * 1000) / 10}%`
}

export function rateOf(successes: number, n: number, minSample: number = MIN_SAMPLE): Rate {
  const interval = wilsonInterval(successes, n)
  if (n < minSample) {
    return { successes, n, rate: null, interval: null, shown: false, note: `Only ${n} so far. Rates show from ${minSample}.` }
  }
  const rate = successes / n
  return {
    successes,
    n,
    rate,
    interval,
    shown: true,
    note: `${successes} of ${n} (${percent(rate)}, likely between ${percent(interval.low)} and ${percent(interval.high)}).`,
  }
}

/** Whether two rates differ enough to act on. */
export function compareRates(a: Rate, b: Rate): { differencePoints: number | null; meaningful: boolean; note: string } {
  if (!a.shown || !b.shown || a.rate === null || b.rate === null || !a.interval || !b.interval) {
    return { differencePoints: null, meaningful: false, note: `Each group needs at least ${MIN_SAMPLE} outcomes to compare.` }
  }
  const differencePoints = Math.round((a.rate - b.rate) * 1000) / 10
  if (Math.abs(differencePoints) < MIN_DIFFERENCE_POINTS) {
    return { differencePoints, meaningful: false, note: `${Math.abs(differencePoints)} points apart, under the ${MIN_DIFFERENCE_POINTS}-point bar.` }
  }
  const overlap = a.interval.low <= b.interval.high && b.interval.low <= a.interval.high
  return overlap
    ? { differencePoints, meaningful: false, note: `${Math.abs(differencePoints)} points apart, but the ranges overlap, so it may be chance.` }
    : { differencePoints, meaningful: true, note: `${Math.abs(differencePoints)} points apart and the ranges do not overlap.` }
}

function reached(app: Pick<Application, 'status' | 'history'>, statuses: readonly AppStatus[]): boolean {
  return statuses.includes(app.status) || app.history.some((entry) => statuses.includes(entry.status))
}

/** A person replied: an assessment, interview, offer or rejection. Automatic receipts do not count. */
export function gotResponse(app: Pick<Application, 'status' | 'history'>): boolean {
  return reached(app, ['assessment_pending', 'interview_scheduled', 'offer', 'rejected'])
}

export function gotInterview(app: Pick<Application, 'status' | 'history'>): boolean {
  return reached(app, ['interview_scheduled', 'offer'])
}

export function gotOffer(app: Pick<Application, 'status' | 'history'>): boolean {
  return reached(app, ['offer'])
}

export interface OutcomeSummary {
  submitted: number
  awaitingReply: number
  response: Rate
  interview: Rate
  offer: Rate
}

/** Response, interview and offer rates over every submitted application. */
export function outcomeSummary(apps: readonly Application[]): OutcomeSummary {
  const submitted = apps.filter(wasSubmitted)
  const count = (test: (app: Application) => boolean) => submitted.filter(test).length
  return {
    submitted: submitted.length,
    awaitingReply: count((app) => AWAITING_REPLY.includes(app.status)),
    response: rateOf(count(gotResponse), submitted.length),
    interview: rateOf(count(gotInterview), submitted.length),
    offer: rateOf(count(gotOffer), submitted.length),
  }
}

/** One rate per group (by source, score range, weekday...), largest group first. Apps keyed null are left out. */
export function segmentRates(
  apps: readonly Application[],
  keyOf: (app: Application) => string | null,
  outcome: (app: Application) => boolean = gotResponse,
): { key: string; rate: Rate }[] {
  const groups = new Map<string, Application[]>()
  for (const app of apps.filter(wasSubmitted)) {
    const key = keyOf(app)
    if (key === null) continue
    groups.set(key, [...(groups.get(key) ?? []), app])
  }
  return [...groups.entries()]
    .map(([key, members]) => ({ key, rate: rateOf(members.filter(outcome).length, members.length) }))
    .sort((a, b) => b.rate.n - a.rate.n || (a.key < b.key ? -1 : 1))
}
