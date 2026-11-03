import type { AppStatus, Application, QueueStatus } from './types.ts'

/**
 * The two state machines: one per posting (the queue) and one per application. The old
 * engine listed states but enforced nothing; here every move goes through `canTransition`.
 */

export const QUEUE_STATUSES: readonly QueueStatus[] = [
  'queued', 'shortlisted', 'skipped_age', 'skipped_dealbreaker', 'skipped_duplicate',
  'skipped_ghost', 'expired', 'archived',
]

export const APP_STATUSES: readonly AppStatus[] = [
  'draft', 'prepared', 'applied', 'confirmed', 'reviewing', 'assessment_pending',
  'interview_scheduled', 'offer', 'rejected', 'ghosted', 'withdrawn',
]

/** Legacy values from job-hunter (templates/states.yml and auto-apply.js), mapped to today's states. */
const QUEUE_ALIASES: Record<string, QueueStatus> = {
  duplicate: 'skipped_duplicate',
  dup: 'skipped_duplicate',
  ghost_skipped: 'skipped_ghost',
  tailored: 'shortlisted',
}

const APP_ALIASES: Record<string, AppStatus> = {
  submitted: 'applied',
  submitted_unconfirmed: 'applied',
  prepared_not_submitted: 'prepared',
  tailored: 'prepared',
  interview: 'interview_scheduled',
  likely_ghosted: 'ghosted',
}

function clean(value: string): string {
  return value.trim().toLowerCase().replace(/[\s-]+/g, '_')
}

/** A known status or alias mapped to its canonical value; null for anything else, so imports can report it. */
export function normalizeStatus(value: string, domain: 'application'): AppStatus | null
export function normalizeStatus(value: string, domain: 'queue'): QueueStatus | null
export function normalizeStatus(value: string, domain: 'application' | 'queue'): AppStatus | QueueStatus | null {
  const key = clean(value)
  if (domain === 'application') {
    return (APP_STATUSES as readonly string[]).includes(key) ? (key as AppStatus) : (APP_ALIASES[key] ?? null)
  }
  return (QUEUE_STATUSES as readonly string[]).includes(key) ? (key as QueueStatus) : (QUEUE_ALIASES[key] ?? null)
}

const REPLIES: readonly AppStatus[] = ['assessment_pending', 'interview_scheduled', 'offer', 'rejected']

/**
 * Allowed moves. Notes on the less obvious ones:
 * - "ghosted" is not final: late replies happen, so it can move to any reply state.
 * - "offer" can go to "rejected" (rescinded) or "withdrawn" (declined).
 * - "rejected" and "withdrawn" are final; reapplying is a new application.
 */
const APP_TRANSITIONS: Record<AppStatus, readonly AppStatus[]> = {
  draft: ['prepared', 'applied', 'withdrawn'],
  prepared: ['draft', 'applied', 'withdrawn'],
  applied: ['confirmed', 'reviewing', ...REPLIES, 'ghosted', 'withdrawn'],
  confirmed: ['reviewing', ...REPLIES, 'ghosted', 'withdrawn'],
  reviewing: [...REPLIES, 'ghosted', 'withdrawn'],
  assessment_pending: ['reviewing', 'interview_scheduled', 'offer', 'rejected', 'ghosted', 'withdrawn'],
  interview_scheduled: ['assessment_pending', 'offer', 'rejected', 'ghosted', 'withdrawn'],
  offer: ['rejected', 'withdrawn'],
  ghosted: ['confirmed', 'reviewing', ...REPLIES, 'withdrawn'],
  rejected: [],
  withdrawn: [],
}

const SKIPS: readonly QueueStatus[] = ['skipped_age', 'skipped_dealbreaker', 'skipped_duplicate', 'skipped_ghost']

/** A person can always override a skip, and anything can be archived and restored. */
const QUEUE_TRANSITIONS: Record<QueueStatus, readonly QueueStatus[]> = {
  queued: ['shortlisted', ...SKIPS, 'expired', 'archived'],
  shortlisted: ['queued', 'skipped_duplicate', 'expired', 'archived'],
  skipped_age: ['queued', 'shortlisted', 'archived'],
  skipped_dealbreaker: ['queued', 'shortlisted', 'archived'],
  skipped_duplicate: ['queued', 'shortlisted', 'archived'],
  skipped_ghost: ['queued', 'shortlisted', 'archived'],
  expired: ['queued', 'archived'],
  archived: ['queued'],
}

export function canTransition(from: AppStatus, to: AppStatus): boolean {
  return APP_TRANSITIONS[from].includes(to)
}

export function canQueueTransition(from: QueueStatus, to: QueueStatus): boolean {
  return QUEUE_TRANSITIONS[from].includes(to)
}

export function isTerminal(status: AppStatus): boolean {
  return APP_TRANSITIONS[status].length === 0
}

/** Submitted applications that are still waiting on the company. */
export const AWAITING_REPLY: readonly AppStatus[] = ['applied', 'confirmed', 'reviewing']

/** True once the application has been submitted, whatever happened after. */
export function wasSubmitted(app: Pick<Application, 'status' | 'history'>): boolean {
  const notYet: readonly AppStatus[] = ['draft', 'prepared']
  return !notYet.includes(app.status) || app.history.some((entry) => entry.status === 'applied')
}

export type TransitionResult = { ok: true; app: Application } | { ok: false; reason: string }

/**
 * Moves an application to a new status, appending to its history. The first move to "applied"
 * also records `appliedAt`; schedule the follow-up with `followUpDue`.
 */
export function transition(
  app: Application,
  to: AppStatus,
  at: string,
  by: Application['history'][number]['by'] = 'me',
): TransitionResult {
  if (!canTransition(app.status, to)) {
    return { ok: false, reason: `Can't move from ${app.status} to ${to}.` }
  }
  return {
    ok: true,
    app: {
      ...app,
      status: to,
      history: [...app.history, { status: to, at, by }],
      appliedAt: to === 'applied' && !app.appliedAt ? at : app.appliedAt,
    },
  }
}
