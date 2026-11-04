import { addLocalDays, defaultTimeZone, localDay, localDaysBetween, toIso, toMillis, type Instant } from './dates.ts'
import type { Application } from './types.ts'

/**
 * Follow-up timing (decision table 1.10, #9): one follow-up on day 7, a "no reply" flag on
 * day 14, and a suggestion to mark the application ghosted on day 30. The tool only suggests;
 * you send the follow-up and change the status yourself.
 */
export const FOLLOW_UP = { firstAfterDays: 7, flagAfterDays: 14, ghostedAfterDays: 30 } as const

/**
 * When the follow-up is due: 7 days after applying, moved to Monday if that lands on a weekend.
 * Null until the application has an `appliedAt` date.
 */
export function followUpDue(app: Pick<Application, 'appliedAt'>, timeZone: string = defaultTimeZone()): string | null {
  const applied = toMillis(app.appliedAt)
  if (applied === null) return null
  return toIso(addLocalDays(applied, FOLLOW_UP.firstAfterDays, timeZone, { weekdaysOnly: true }))
}

export type NextActionKind =
  | 'finish_draft' | 'submit' | 'add_applied_date' | 'wait' | 'follow_up' | 'no_reply_flag'
  | 'mark_ghosted' | 'complete_assessment' | 'prepare_interview' | 'review_offer' | 'none'

export interface NextAction {
  kind: NextActionKind
  label: string
  /** When the action is due, or when the next one becomes due while waiting. */
  dueAt?: string
}

/** The last time anything happened on the application: its latest history entry or the applied date. */
function lastActivity(app: Application): number | null {
  const times = [app.appliedAt, ...app.history.map((entry) => entry.at)].map(toMillis).filter((ms): ms is number => ms !== null)
  return times.length > 0 ? Math.max(...times) : null
}

/** What to do next on an application, by status and by local calendar days since the last activity. */
export function nextAction(app: Application, now: Instant, timeZone: string = defaultTimeZone()): NextAction {
  switch (app.status) {
    case 'draft':
      return { kind: 'finish_draft', label: 'Finish preparing this application.' }
    case 'prepared':
      return { kind: 'submit', label: 'Submit it yourself on the posting, then mark it applied.' }
    case 'assessment_pending':
      return { kind: 'complete_assessment', label: 'Complete the assessment.' }
    case 'interview_scheduled': {
      const nowMs = toMillis(now) ?? 0
      const upcoming = (app.interviews ?? [])
        .map((interview) => toMillis(interview.at))
        .filter((ms): ms is number => ms !== null && ms >= nowMs)
        .sort((a, b) => a - b)[0]
      return upcoming === undefined
        ? { kind: 'prepare_interview', label: 'Prepare for the interview.' }
        : { kind: 'prepare_interview', label: 'Prepare for the interview.', dueAt: toIso(upcoming) }
    }
    case 'offer':
      return { kind: 'review_offer', label: 'Review the offer and reply.' }
    case 'rejected':
    case 'ghosted':
    case 'withdrawn':
      return { kind: 'none', label: 'Nothing to do.' }
  }

  // Only applied, confirmed and reviewing reach this point: submitted and waiting on the company.
  const due = app.followUp?.dueAt ?? followUpDue(app, timeZone)
  const last = lastActivity(app)
  if (!app.appliedAt || due === null || last === null) {
    return { kind: 'add_applied_date', label: 'Add the date you applied so follow-ups can be scheduled.' }
  }
  const quietDays = localDaysBetween(last, now, timeZone)
  const followUpSent = Boolean(app.followUp?.sentAt)
  if (quietDays >= FOLLOW_UP.ghostedAfterDays) {
    return { kind: 'mark_ghosted', label: `No reply in ${quietDays} days. Mark it as no reply?` }
  }
  if (!followUpSent && localDay(now, timeZone) >= localDay(due, timeZone)) {
    return { kind: 'follow_up', label: 'Send one short follow-up.', dueAt: due }
  }
  if (quietDays >= FOLLOW_UP.flagAfterDays) {
    return { kind: 'no_reply_flag', label: `No reply in ${quietDays} days.` }
  }
  return followUpSent
    ? { kind: 'wait', label: 'Follow-up sent. Wait for a reply.' }
    : { kind: 'wait', label: 'Wait. A follow-up is scheduled.', dueAt: due }
}
