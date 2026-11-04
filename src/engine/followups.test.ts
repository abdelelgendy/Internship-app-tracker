import { describe, expect, it } from 'vitest'
import { makeApplication, TZ } from './fixtures.ts'
import { followUpDue, nextAction } from './followups.ts'
import { localDay, localDaysBetween } from './dates.ts'
import type { Application } from './types.ts'

// November 2026: the 2nd is a Monday. Toronto is on EST (UTC-5) from November 1.
const APPLIED = '2026-11-02T14:00:00.000Z' // Monday 9:00 in Toronto
const dayAfterApplying = (days: number, hourUtc = 17) =>
  new Date(Date.UTC(2026, 10, 2 + days, hourUtc)).toISOString()

describe('followUpDue', () => {
  it.each([
    ['2026-11-02T14:00:00.000Z', '2026-11-09T14:00:00.000Z'], // Monday -> Monday
    ['2026-11-07T15:00:00.000Z', '2026-11-16T15:00:00.000Z'], // Saturday -> the next Monday, not Saturday
    ['2026-11-08T15:00:00.000Z', '2026-11-16T15:00:00.000Z'], // Sunday -> Monday
    ['2026-11-07T04:30:00.000Z', '2026-11-14T04:30:00.000Z'], // Friday 23:30 in Toronto stays Friday
  ])('applied %s -> due %s', (appliedAt, due) => {
    expect(followUpDue({ appliedAt }, TZ)).toBe(due)
  })

  it.each([
    ['2026-10-28T04:30:00.000Z', '2026-10-28', '2026-11-04'], // Wed 00:30 EDT, due after the switch to EST
    ['2026-03-05T04:30:00.000Z', '2026-03-04', '2026-03-11'], // Wed 23:30 EST, due after the switch to EDT
  ])('lands exactly 7 local days later across a DST change: %s', (appliedAt, appliedDay, dueDay) => {
    const due = followUpDue({ appliedAt }, TZ)
    expect(due).not.toBeNull()
    expect(localDay(appliedAt, TZ)).toBe(appliedDay)
    expect(localDay(due!, TZ)).toBe(dueDay)
    expect(localDaysBetween(appliedAt, due!, TZ)).toBe(7)
  })

  it('is null before there is an applied date', () => {
    expect(followUpDue({ appliedAt: undefined }, TZ)).toBeNull()
    expect(followUpDue({ appliedAt: 'not a date' }, TZ)).toBeNull()
  })
})

const applied = (overrides: Partial<Application> = {}) =>
  makeApplication({ appliedAt: APPLIED, history: [{ status: 'applied', at: APPLIED, by: 'me' }], ...overrides })
const sent = { followUp: { dueAt: '2026-11-09T14:00:00.000Z', sentAt: '2026-11-09T15:00:00.000Z' } }

describe('nextAction while waiting for a reply', () => {
  it.each<[number, Partial<Application>, string]>([
    [6, {}, 'wait'],
    [7, {}, 'follow_up'],
    [13, sent, 'wait'],
    [14, sent, 'no_reply_flag'],
    [14, {}, 'follow_up'],
    [29, sent, 'no_reply_flag'],
    [30, sent, 'mark_ghosted'],
    [30, {}, 'mark_ghosted'],
  ])('day %s %j -> %s', (days, overrides, kind) => {
    expect(nextAction(applied(overrides), dayAfterApplying(days), TZ).kind).toBe(kind)
  })

  it('is due on day 7 from the start of that local day', () => {
    // 6:00 in Toronto on day 7, before the hour the application was sent.
    expect(nextAction(applied(), dayAfterApplying(7, 11), TZ).kind).toBe('follow_up')
    expect(nextAction(applied(), dayAfterApplying(7, 4), TZ).kind).toBe('wait') // still day 6 in Toronto
  })

  it('says when the follow-up is due while waiting', () => {
    expect(nextAction(applied(), dayAfterApplying(3), TZ)).toEqual({
      kind: 'wait',
      label: 'Wait. A follow-up is scheduled.',
      dueAt: '2026-11-09T14:00:00.000Z',
    })
  })

  it('respects a follow-up date set by hand', () => {
    const app = applied({ followUp: { dueAt: '2026-11-04T14:00:00.000Z' } })
    expect(nextAction(app, dayAfterApplying(2), TZ).kind).toBe('follow_up')
  })

  it('counts quiet days from the latest activity', () => {
    const app = applied({
      ...sent,
      status: 'reviewing',
      history: [
        { status: 'applied', at: APPLIED, by: 'me' },
        { status: 'reviewing', at: dayAfterApplying(20), by: 'inbox-rule' },
      ],
    })
    expect(nextAction(app, dayAfterApplying(35), TZ).kind).toBe('no_reply_flag')
    expect(nextAction(app, dayAfterApplying(50), TZ).kind).toBe('mark_ghosted')
  })

  it('asks for the applied date when it is missing', () => {
    expect(nextAction(makeApplication({ appliedAt: undefined, history: [] }), dayAfterApplying(3), TZ).kind).toBe('add_applied_date')
  })
})

describe('nextAction by status', () => {
  it.each<[Application['status'], string]>([
    ['draft', 'finish_draft'],
    ['prepared', 'submit'],
    ['assessment_pending', 'complete_assessment'],
    ['offer', 'review_offer'],
    ['rejected', 'none'],
    ['ghosted', 'none'],
    ['withdrawn', 'none'],
  ])('%s -> %s', (status, kind) => {
    expect(nextAction(applied({ status }), dayAfterApplying(3), TZ).kind).toBe(kind)
  })

  it('points at the next interview', () => {
    const app = applied({
      status: 'interview_scheduled',
      interviews: [
        { at: dayAfterApplying(1), kind: 'phone screen' },
        { at: dayAfterApplying(9), kind: 'technical' },
        { at: dayAfterApplying(5), kind: 'onsite' },
      ],
    })
    expect(nextAction(app, dayAfterApplying(3), TZ)).toEqual({
      kind: 'prepare_interview',
      label: 'Prepare for the interview.',
      dueAt: dayAfterApplying(5),
    })
    expect(nextAction(applied({ status: 'interview_scheduled' }), dayAfterApplying(3), TZ).dueAt).toBeUndefined()
  })
})
