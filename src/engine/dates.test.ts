import { describe, expect, it } from 'vitest'
import { addLocalDays, daysBetweenDays, localDay, localDaysBetween, localWeekday, toMillis } from './dates.ts'
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
    expect(localWeekday(lateFriday, 'UTC')).toBe(6)
  })

  it.each([
    // Across the November change (EDT to EST) and the March change (EST to EDT), near midnight.
    ['2026-10-28T04:30:00Z', 7, '2026-11-04T05:30:00.000Z'],
    ['2026-03-05T04:30:00Z', 7, '2026-03-12T03:30:00.000Z'],
    ['2026-11-02T14:00:00Z', 7, '2026-11-09T14:00:00.000Z'],
  ])('adds local calendar days, keeping the local time: %s + %s', (at, days, expected) => {
    expect(new Date(addLocalDays(at, days, TZ)).toISOString()).toBe(expected)
  })

  it('skips the weekend on the local calendar', () => {
    // Friday 23:30 in Toronto is Saturday in UTC, so it must not be skipped.
    expect(new Date(addLocalDays('2026-11-07T04:30:00Z', 0, TZ, { weekdaysOnly: true })).toISOString()).toBe('2026-11-07T04:30:00.000Z')
    expect(localDay(addLocalDays('2026-11-07T15:00:00Z', 0, TZ, { weekdaysOnly: true }), TZ)).toBe('2026-11-09')
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
