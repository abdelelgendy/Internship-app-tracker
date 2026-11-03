/**
 * Applications as CSV for a spreadsheet, with the columns job-hunter's dashboard export used.
 * Pure: the caller loads the data and writes the file.
 */
import { localDay, localDaysBetween, toMillis, type Instant } from '../../src/engine/dates.ts'
import { followUpDue, nextAction } from '../../src/engine/followups.ts'
import { AWAITING_REPLY } from '../../src/engine/states.ts'
import type { AppStatus, Application, Job, Profile } from '../../src/engine/types.ts'
import { scoreFor } from '../../src/features/jobs/jobView.ts'
import { APP_STATUS_DISPLAY } from '../../src/ui/status.ts'

export const CSV_COLUMNS = [
  'Company', 'Role', 'Location', 'Source', 'Fit Score', 'Date Applied', 'Days Waiting', 'Status', 'ATS Platform',
  'Resume Used', 'Response Date', 'Response Type', 'Next Action', 'Follow Up Date', 'Job URL', 'Notes',
] as const

const RESPONSES: readonly AppStatus[] = ['assessment_pending', 'interview_scheduled', 'offer', 'rejected']

/**
 * One CSV field. Quoted when it holds a comma, quote or line break. A cell that starts with
 * =, +, -, @, tab or carriage return gets a leading apostrophe, so a spreadsheet shows a posting
 * title such as "=HYPERLINK(...)" as text instead of running it.
 */
export function csvField(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return ''
  let text = String(value)
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(text)) text = `'${text}`
  return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text
}

function firstResponse(app: Application): Application['history'][number] | undefined {
  return [...app.history].sort((a, b) => (toMillis(a.at) ?? 0) - (toMillis(b.at) ?? 0)).find((entry) => RESPONSES.includes(entry.status))
}

export function applicationsCsv(
  applications: readonly Application[],
  jobs: readonly Job[],
  profile: Profile | null,
  { now, timeZone }: { now: Instant; timeZone: string },
): string {
  const byId = new Map(jobs.map((job) => [job.id, job]))
  const day = (at: string | undefined) => (at && toMillis(at) !== null ? localDay(at, timeZone) : '')
  const rows = [...applications]
    .sort((a, b) => (toMillis(b.appliedAt) ?? 0) - (toMillis(a.appliedAt) ?? 0) || a.company.localeCompare(b.company))
    .map((app) => {
      const job = byId.get(app.jobId)
      const response = firstResponse(app)
      const waiting = AWAITING_REPLY.includes(app.status) && app.appliedAt && toMillis(app.appliedAt) !== null ? localDaysBetween(app.appliedAt, now, timeZone) : null
      const followUp = app.followUp?.dueAt ?? followUpDue(app, timeZone) ?? undefined
      return [
        app.company,
        app.title,
        job?.location ?? '',
        job?.source ?? '',
        job ? (scoreFor(job, profile, now)?.total ?? null) : null,
        day(app.appliedAt),
        waiting,
        APP_STATUS_DISPLAY[app.status]?.label ?? app.status,
        job?.ats ?? '',
        app.resumeVersion ?? '',
        day(response?.at),
        response ? APP_STATUS_DISPLAY[response.status].label : '',
        nextAction(app, now, timeZone).label,
        AWAITING_REPLY.includes(app.status) ? day(followUp) : '',
        app.url || job?.url || '',
        app.notes ?? '',
      ]
    })
  return [CSV_COLUMNS, ...rows].map((row) => row.map(csvField).join(',')).join('\r\n') + '\r\n'
}
