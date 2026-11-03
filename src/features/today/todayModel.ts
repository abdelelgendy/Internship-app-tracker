import { localDay, localDaysBetween, toMillis, type Instant } from '../../engine/dates.ts'
import { nextAction, type NextAction } from '../../engine/followups.ts'
import { byQueueOrder, dailyCapFor } from '../../engine/gates.ts'
import { deckStats, currentStreak } from '../../engine/practice.ts'
import { wasSubmitted } from '../../engine/states.ts'
import type { Application, Job, PracticeDeck, PracticeProgress, Profile, ScoreResult } from '../../engine/types.ts'
import { scoreFor } from '../jobs/jobView.ts'

/**
 * What needs a person today, worked out from the data with the engine's rules. Every list holds
 * things with exactly one next step; the page decides how each step looks.
 */

export interface FollowUpItem {
  app: Application
  action: NextAction
  /** Local calendar days past the due day; 0 when it is due today. */
  daysLate: number
}

export interface InterviewItem {
  app: Application
  interview: NonNullable<Application['interviews']>[number]
}

export interface WaitingItem {
  app: Application
  action: NextAction
}

export interface MatchItem {
  job: Job
  score: ScoreResult
}

export interface TodayPlan {
  followUps: FollowUpItem[]
  /** Quiet for 30 days or more: suggest marking them as no reply. */
  quiet: WaitingItem[]
  interviews: InterviewItem[]
  waiting: WaitingItem[]
  matches: MatchItem[]
  /** Jobs that pass the gate, before the list is cut to the top few. */
  matchCount: number
  submittedToday: number
  dailyTarget: number
  /** The next follow-up after today, for the "nothing due" message. */
  nextFollowUp: string | null
}

export const INTERVIEW_WINDOW_DAYS = 14
export const TOP_MATCHES = 5

const WAITING_ORDER: Record<string, number> = { offer: 0, assessment_pending: 1, prepared: 2, draft: 3 }

export function planToday(
  applications: readonly Application[],
  jobs: readonly Job[],
  profile: Profile | null,
  now: Instant,
  timeZone: string,
): TodayPlan {
  const today = localDay(now, timeZone)
  const followUps: FollowUpItem[] = []
  const quiet: WaitingItem[] = []
  const waiting: WaitingItem[] = []
  const interviews: InterviewItem[] = []
  let nextFollowUp: string | null = null

  for (const app of applications) {
    const action = nextAction(app, now, timeZone)
    if (action.kind === 'follow_up' && action.dueAt) {
      followUps.push({ app, action, daysLate: Math.max(0, localDaysBetween(action.dueAt, now, timeZone)) })
    } else if (action.kind === 'mark_ghosted') {
      quiet.push({ app, action })
    } else if (
      action.kind === 'wait' &&
      action.dueAt &&
      (nextFollowUp === null || (toMillis(action.dueAt) ?? 0) < (toMillis(nextFollowUp) ?? 0))
    ) {
      nextFollowUp = action.dueAt
    }
    if (app.status in WAITING_ORDER) waiting.push({ app, action })

    for (const interview of app.interviews ?? []) {
      if (toMillis(interview.at) === null) continue
      const days = localDaysBetween(now, interview.at, timeZone)
      if (days >= 0 && days <= INTERVIEW_WINDOW_DAYS && (days > 0 || (toMillis(interview.at) ?? 0) >= (toMillis(now) ?? 0))) {
        interviews.push({ app, interview })
      }
    }
  }

  followUps.sort((a, b) => b.daysLate - a.daysLate || a.app.company.localeCompare(b.app.company))
  interviews.sort((a, b) => (toMillis(a.interview.at) ?? 0) - (toMillis(b.interview.at) ?? 0))
  waiting.sort((a, b) => WAITING_ORDER[a.app.status] - WAITING_ORDER[b.app.status] || a.app.company.localeCompare(b.app.company))

  // A job with any application already has its next step above.
  const applied = new Set(applications.map((app) => app.jobId))
  const passing = jobs
    .filter((job) => (job.status === 'queued' || job.status === 'shortlisted') && !applied.has(job.id))
    .map((job) => ({ job, score: scoreFor(job, profile, now) }))
    .filter((item): item is MatchItem => item.score?.gate.verdict === 'apply')
    .sort((a, b) => byQueueOrder({ ...a.job, score: a.score }, { ...b.job, score: b.score }))

  const submittedToday = applications.filter(
    (app) => wasSubmitted(app) && app.appliedAt && toMillis(app.appliedAt) !== null && localDay(app.appliedAt, timeZone) === today,
  ).length

  return {
    followUps,
    quiet,
    interviews,
    waiting,
    matches: passing.slice(0, TOP_MATCHES),
    matchCount: passing.length,
    submittedToday,
    dailyTarget: dailyCapFor(now, undefined, timeZone),
    nextFollowUp,
  }
}

export interface PracticeSummary {
  dueReviews: number
  unseen: number
  streak: number
}

export function practiceSummary(
  decks: readonly PracticeDeck[],
  progress: PracticeProgress,
  now: Instant,
  timeZone: string,
): PracticeSummary {
  let dueReviews = 0
  let unseen = 0
  for (const deck of decks) {
    const stats = deckStats(deck, progress, now, timeZone)
    dueReviews += stats.due
    unseen += stats.unseen
  }
  return { dueReviews, unseen, streak: currentStreak(progress, now, timeZone) }
}

/** The one-line summary under the page title, built from what is actually there. */
export function summaryLine(plan: TodayPlan): string {
  const parts: string[] = []
  if (plan.interviews.length > 0) parts.push(`${plan.interviews.length} interview${plan.interviews.length === 1 ? '' : 's'} coming up`)
  const followUps = plan.followUps.length
  if (followUps > 0) parts.push(`${followUps} follow-up${followUps === 1 ? '' : 's'} due`)
  const waiting = plan.waiting.length
  if (waiting > 0) parts.push(`${waiting} application${waiting === 1 ? '' : 's'} waiting on you`)
  if (plan.matchCount > 0) parts.push(`${plan.matchCount} job${plan.matchCount === 1 ? '' : 's'} worth applying to`)
  if (parts.length === 0) return 'Nothing needs you right now.'
  const sentence = parts.length === 1 ? parts[0] : `${parts.slice(0, -1).join(', ')} and ${parts[parts.length - 1]}`
  return `${sentence[0].toUpperCase()}${sentence.slice(1)}.`
}

/** A short follow-up note for you to send by email or through the ATS. Plain words, no dashes. */
export function followUpNote(app: Application, timeZone: string, signature = ''): string {
  const name = app.contacts?.[0]?.name.split(' ')[0]
  const when =
    app.appliedAt && toMillis(app.appliedAt) !== null
      ? `on ${new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', timeZone }).format(new Date(app.appliedAt))}`
      : 'recently'
  return [
    `Hi${name ? ` ${name}` : ''},`,
    '',
    `I applied for the ${app.title} role at ${app.company} ${when}. I'm still very interested, and I'm happy to send anything else that would help.`,
    '',
    signature ? `Thanks,\n${signature}` : 'Thanks,',
  ].join('\n')
}
