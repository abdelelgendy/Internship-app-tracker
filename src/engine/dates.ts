/**
 * Date helpers shared by the engine. Stored dates are UTC instants; "days" are local calendar
 * days in the user's time zone, because a follow-up or a streak follows the user's calendar,
 * not UTC midnight.
 */

export type Instant = Date | string | number

export const HOUR_MS = 3_600_000
export const DAY_MS = 86_400_000

/** Milliseconds since the epoch, or null when the value is missing or not a real date. */
export function toMillis(value: Instant | null | undefined): number | null {
  if (value === null || value === undefined) return null
  const ms = value instanceof Date ? value.getTime() : typeof value === 'number' ? value : Date.parse(value)
  return Number.isFinite(ms) ? ms : null
}

export function toIso(ms: number): string {
  return new Date(ms).toISOString()
}

/** The runtime's zone: the browser's in the UI, the machine's in a Node script. */
export function defaultTimeZone(): string {
  return Intl.DateTimeFormat().resolvedOptions().timeZone
}

const formatters = new Map<string, Intl.DateTimeFormat>()

function partsIn(ms: number, timeZone: string): { day: string; weekday: number } {
  let formatter = formatters.get(timeZone)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      weekday: 'short',
    })
    formatters.set(timeZone, formatter)
  }
  const parts: Record<string, string> = {}
  for (const part of formatter.formatToParts(ms)) parts[part.type] = part.value
  return {
    day: `${parts.year}-${parts.month}-${parts.day}`,
    weekday: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(parts.weekday),
  }
}

function requireMillis(at: Instant): number {
  const ms = toMillis(at)
  if (ms === null) throw new RangeError(`Not a valid date: ${String(at)}`)
  return ms
}

/** The local calendar day of an instant, as YYYY-MM-DD. */
export function localDay(at: Instant, timeZone: string): string {
  return partsIn(requireMillis(at), timeZone).day
}

/** 0 for Sunday through 6 for Saturday, in the given zone. */
export function localWeekday(at: Instant, timeZone: string): number {
  return partsIn(requireMillis(at), timeZone).weekday
}

export function isWeekend(at: Instant, timeZone: string): boolean {
  const weekday = localWeekday(at, timeZone)
  return weekday === 0 || weekday === 6
}

function dayNumber(day: string): number {
  const [year, month, date] = day.split('-').map(Number)
  return Date.UTC(year, month - 1, date) / DAY_MS
}

/** Whole calendar days from one YYYY-MM-DD day to another (negative when `to` is earlier). */
export function daysBetweenDays(from: string, to: string): number {
  return Math.round(dayNumber(to) - dayNumber(from))
}

/** Whole local calendar days between two instants. */
export function localDaysBetween(from: Instant, to: Instant, timeZone: string): number {
  return daysBetweenDays(localDay(from, timeZone), localDay(to, timeZone))
}
