import { followUpDue } from '../../engine/followups.ts'
import { APP_STATUSES, canTransition, isTerminal, transition, type TransitionResult } from '../../engine/states.ts'
import type { AppStatus, Application } from '../../engine/types.ts'
import { APP_STATUS_DISPLAY } from '../../ui/status.ts'

/**
 * Board moves go through the engine's state machine. When a move is not allowed, the reason is
 * written for a person: what is final, what can't go backwards, and where the card can go.
 */

function label(status: AppStatus): string {
  return APP_STATUS_DISPLAY[status].label
}

function listOf(labels: readonly string[]): string {
  if (labels.length <= 1) return labels.join('')
  return `${labels.slice(0, -1).join(', ')} or ${labels[labels.length - 1]}`
}

/** Where an application in this status may move. */
export function allowedMoves(from: AppStatus): AppStatus[] {
  return APP_STATUSES.filter((to) => canTransition(from, to))
}

/** Null when the move is allowed; otherwise why not, in plain words. */
export function moveProblem(from: AppStatus, to: AppStatus): string | null {
  if (from === to || canTransition(from, to)) return null
  if (isTerminal(from)) {
    return `${label(from)} is final. To try again, start a new application from the job.`
  }
  const notSubmitted: readonly AppStatus[] = ['draft', 'prepared']
  if (notSubmitted.includes(to) && !notSubmitted.includes(from)) {
    return `It has been submitted, so it can't go back to ${label(to)}.`
  }
  if (notSubmitted.includes(from) && to !== 'applied' && to !== 'withdrawn') {
    return `It hasn't been submitted yet. Move it to Applied once you submit it.`
  }
  const where = listOf(allowedMoves(from).map(label))
  if (from === 'offer') return `An offer ends as Rejected (it was rescinded) or Withdrawn (you declined). It can move to ${where}.`
  return `From ${label(from)} it can move to ${where}.`
}

/**
 * The application after a move. A move to Applied records the date and schedules the follow-up
 * for day 7, the same as "I submitted it" in the apply kit.
 */
export function applyMove(app: Application, to: AppStatus, at: string, timeZone: string): TransitionResult {
  const problem = moveProblem(app.status, to)
  if (problem) return { ok: false, reason: problem }
  const moved = transition(app, to, at, 'me')
  if (!moved.ok || to !== 'applied' || moved.app.followUp) return moved
  const dueAt = followUpDue(moved.app, timeZone)
  return dueAt ? { ok: true, app: { ...moved.app, followUp: { dueAt } } } : moved
}
