import { describe, expect, it } from 'vitest'
import { daysBetweenDays, isWeekend, localDay, localDaysBetween, localWeekday, toMillis } from './dates.ts'
import { TZ } from './fixtures.ts'

describe('dates', () => {
  it.each([
    [null, null],
    [undefined, null],
    ['not a date', null],
    ['2026-11-03T15:00:00Z', Date.UTC(2026, 10, 3, 15)],
    [0, 0],
  ])('toMillis(%s) -> %s', (value, expected) => {
    expect(toMillis(value)).toBe(expected)
  })

  it('reads the local day and weekday in the given zone', () => {
    const lateFriday = '2026-11-07T03:00:00Z' // Friday 22:00 in Toronto, Saturday in UTC
    expect(localDay(lateFriday, TZ)).toBe('2026-11-06')
    expect(localDay(lateFriday, 'UTC')).toBe('2026-11-07')
    expect(localWeekday(lateFriday, TZ)).toBe(5)
    expect(isWeekend(lateFriday, TZ)).toBe(false)
    expect(isWeekend(lateFriday, 'UTC')).toBe(true)
  })

  it('counts calendar days, across months and the DST change', () => {
    expect(daysBetweenDays('2026-10-31', '2026-11-02')).toBe(2)
    expect(daysBetweenDays('2026-11-02', '2026-10-31')).toBe(-2)
    expect(localDaysBetween('2026-10-31T23:00:00Z', '2026-11-02T05:00:00Z', TZ)).toBe(2)
  })

  it('throws on an invalid instant', () => {
    expect(() => localDay('nope', TZ)).toThrow(RangeError)
  })
})
