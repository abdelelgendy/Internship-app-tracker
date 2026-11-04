import type { AppStatus, QueueStatus } from '../engine/types.ts'

export type BadgeTone = 'neutral' | 'info' | 'warn' | 'violet' | 'success' | 'danger' | 'muted' | 'accent'

/** One label and color per status, so the board, lists and detail pages all say the same thing. */
export const APP_STATUS_DISPLAY: Record<AppStatus, { label: string; tone: BadgeTone }> = {
  draft: { label: 'Draft', tone: 'muted' },
  prepared: { label: 'Prepared', tone: 'neutral' },
  applied: { label: 'Applied', tone: 'info' },
  confirmed: { label: 'Confirmed', tone: 'info' },
  reviewing: { label: 'In review', tone: 'info' },
  assessment_pending: { label: 'Assessment', tone: 'warn' },
  interview_scheduled: { label: 'Interview', tone: 'violet' },
  offer: { label: 'Offer', tone: 'success' },
  rejected: { label: 'Rejected', tone: 'danger' },
  ghosted: { label: 'No reply', tone: 'muted' },
  withdrawn: { label: 'Withdrawn', tone: 'muted' },
}

export const QUEUE_STATUS_DISPLAY: Record<QueueStatus, { label: string; tone: BadgeTone }> = {
  queued: { label: 'Queued', tone: 'neutral' },
  shortlisted: { label: 'Shortlisted', tone: 'info' },
  skipped_age: { label: 'Missed the gate', tone: 'muted' },
  skipped_dealbreaker: { label: 'Dealbreaker', tone: 'muted' },
  skipped_duplicate: { label: 'Duplicate', tone: 'muted' },
  skipped_ghost: { label: 'Likely ghost job', tone: 'muted' },
  expired: { label: 'Expired', tone: 'muted' },
  archived: { label: 'Archived', tone: 'muted' },
}
