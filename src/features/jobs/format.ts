import { HOUR_MS, localDaysBetween, toMillis, type Instant } from '../../engine/dates.ts'
import type { Workplace } from '../../engine/types.ts'

/**
 * Display helpers shared by Today, Jobs, Board and the apply kit. Dates are stored as UTC
 * instants and shown in the user's zone; "today" and "in 3 days" count local calendar days.
 */

const dayFormats = new Map<string, Intl.DateTimeFormat>()
const timeFormats = new Map<string, Intl.DateTimeFormat>()

function cached(map: Map<string, Intl.DateTimeFormat>, timeZone: string, options: Intl.DateTimeFormatOptions) {
  let format = map.get(timeZone)
  if (!format) {
    format = new Intl.DateTimeFormat('en-US', { ...options, timeZone })
    map.set(timeZone, format)
  }
  return format
}

/** "Mon, Nov 10" */
export function formatDay(at: Instant, timeZone: string): string {
  const ms = toMillis(at)
  return ms === null ? 'Unknown date' : cached(dayFormats, timeZone, { weekday: 'short', month: 'short', day: 'numeric' }).format(ms)
}

/** "Thu, Nov 5, 10:00 AM" */
export function formatDayTime(at: Instant, timeZone: string): string {
  const ms = toMillis(at)
  return ms === null
    ? 'Unknown date'
    : cached(timeFormats, timeZone, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(ms)
}

/** "today", "tomorrow", "in 3 days", "yesterday", "4 days ago", by local calendar days. */
export function relativeDay(at: Instant, now: Instant, timeZone: string): string {
  if (toMillis(at) === null) return 'on an unknown date'
  const days = localDaysBetween(now, at, timeZone)
  if (days === 0) return 'today'
  if (days === 1) return 'tomorrow'
  if (days === -1) return 'yesterday'
  return days > 0 ? `in ${days} days` : `${-days} days ago`
}

export function ageHours(postedAt: string | null, now: Instant): number | null {
  const posted = toMillis(postedAt)
  const current = toMillis(now)
  if (posted === null || current === null) return null
  return Math.max(0, (current - posted) / HOUR_MS)
}

/** "3 hours ago", "2 days ago"; "Date unknown" when the posting has none. */
export function formatAge(postedAt: string | null, now: Instant): string {
  const hours = ageHours(postedAt, now)
  if (hours === null) return 'Date unknown'
  if (hours < 1) return 'Under an hour ago'
  if (hours < 48) {
    const whole = Math.floor(hours)
    return `${whole} hour${whole === 1 ? '' : 's'} ago`
  }
  const days = Math.floor(hours / 24)
  return days < 14 ? `${days} days ago` : `${Math.floor(days / 7)} weeks ago`
}

/** "3h", "2d", "5w": for table cells, where the column header says what it is. */
export function formatAgeShort(postedAt: string | null, now: Instant): string {
  const hours = ageHours(postedAt, now)
  if (hours === null) return 'Unknown'
  if (hours < 1) return '<1h'
  if (hours < 48) return `${Math.floor(hours)}h`
  const days = Math.floor(hours / 24)
  return days < 14 ? `${days}d` : `${Math.floor(days / 7)}w`
}

export const WORKPLACE_LABEL: Record<Workplace, string> = {
  remote: 'Remote',
  hybrid: 'Hybrid',
  onsite: 'On-site',
  unknown: 'Not stated',
}

const SOURCE_LABEL: Record<string, string> = {
  greenhouse: 'Greenhouse',
  ashby: 'Ashby',
  lever: 'Lever',
  workday: 'Workday',
  'web-search': 'Web search',
  manual: 'Added by hand',
  'job-hunter-import': 'Imported',
}

export function sourceLabel(source: string): string {
  return SOURCE_LABEL[source] ?? source.replace(/[-_]+/g, ' ').replace(/^\w/, (letter) => letter.toUpperCase())
}

/** The value for an <input type="datetime-local"> showing `at` in the browser's zone. */
export function toLocalInputValue(at: Instant): string {
  const ms = toMillis(at)
  if (ms === null) return ''
  const date = new Date(ms)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

/** Reads an <input type="datetime-local"> value (browser zone) back into a UTC ISO string. */
export function fromLocalInputValue(value: string): string | null {
  if (!value) return null
  const ms = new Date(value).getTime()
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null
}

/** "1 job", "3 jobs" */
export function plural(count: number, noun: string, pluralNoun = `${noun}s`): string {
  return `${count} ${count === 1 ? noun : pluralNoun}`
}
