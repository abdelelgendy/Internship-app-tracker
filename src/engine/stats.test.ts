import { describe, expect, it } from 'vitest'
import { makeApplication } from './fixtures.ts'
import { compareRates, gotInterview, gotResponse, outcomeSummary, rateOf, segmentRates, wilsonInterval } from './stats.ts'
import type { AppStatus, Application } from './types.ts'

const round = (value: number) => Math.round(value * 10_000) / 10_000

describe('wilsonInterval', () => {
  it.each([
    [0, 10, 0, 0.2775],
    [10, 10, 0.7225, 1],
    [5, 10, 0.2366, 0.7634],
    [1, 20, 0.0089, 0.2361],
    [50, 100, 0.4038, 0.5962],
  ])('%s of %s -> %s to %s', (successes, n, low, high) => {
    const interval = wilsonInterval(successes, n)
    expect(round(interval.low)).toBe(low)
    expect(round(interval.high)).toBe(high)
  })

  it('is the whole range with no data', () => {
    expect(wilsonInterval(0, 0)).toEqual({ low: 0, high: 1 })
  })

  it.each([
    [-1, 10],
    [11, 10],
    [1.5, 10],
  ])('rejects %s of %s', (successes, n) => {
    expect(() => wilsonInterval(successes, n)).toThrow(RangeError)
  })
})

describe('rateOf', () => {
  it('shows no rate below 10', () => {
    expect(rateOf(3, 9)).toMatchObject({ rate: null, interval: null, shown: false, note: 'Only 9 so far. Rates show from 10.' })
    expect(rateOf(0, 0).rate).toBeNull()
  })

  it('shows a rate and range from 10 up', () => {
    const rate = rateOf(3, 10)
    expect(rate.shown).toBe(true)
    expect(rate.rate).toBe(0.3)
    expect(rate.note).toBe('3 of 10 (30%, likely between 10.8% and 60.3%).')
  })

  it('never returns NaN or Infinity', () => {
    for (const [s, n] of [[0, 0], [0, 10], [10, 10]]) {
      const rate = rateOf(s, n)
      for (const value of [rate.rate ?? 0, rate.interval?.low ?? 0, rate.interval?.high ?? 0]) expect(Number.isFinite(value)).toBe(true)
    }
  })
})

describe('compareRates', () => {
  it('needs both groups to have enough data', () => {
    expect(compareRates(rateOf(5, 9), rateOf(1, 50)).meaningful).toBe(false)
  })

  it('ignores differences under 5 points', () => {
    expect(compareRates(rateOf(52, 100), rateOf(49, 100))).toMatchObject({ differencePoints: 3, meaningful: false })
  })

  it('ignores 5+ points when the ranges overlap', () => {
    expect(compareRates(rateOf(4, 10), rateOf(3, 10))).toMatchObject({ differencePoints: 10, meaningful: false })
  })

  it('accepts a real difference', () => {
    expect(compareRates(rateOf(60, 100), rateOf(20, 100))).toMatchObject({ differencePoints: 40, meaningful: true })
  })
})

function appWith(status: AppStatus, past: AppStatus[] = [], source = 'company_site'): Application {
  return makeApplication({
    status,
    channel: source as Application['channel'],
    history: [...['applied' as const, ...past].map((s) => ({ status: s, at: '2026-11-01T12:00:00Z', by: 'me' as const }))],
  })
}

describe('outcomes', () => {
  it('counts only human replies as responses', () => {
    expect(gotResponse(appWith('confirmed'))).toBe(false)
    expect(gotResponse(appWith('reviewing'))).toBe(false)
    expect(gotResponse(appWith('rejected'))).toBe(true)
    expect(gotResponse(appWith('ghosted', ['interview_scheduled']))).toBe(true)
    expect(gotInterview(appWith('rejected', ['interview_scheduled']))).toBe(true)
    expect(gotInterview(appWith('assessment_pending'))).toBe(false)
  })

  it('summarizes submitted applications only', () => {
    const apps = [
      makeApplication({ status: 'draft', history: [] }),
      makeApplication({ status: 'prepared', history: [] }),
      ...Array.from({ length: 8 }, () => appWith('applied')),
      appWith('interview_scheduled'),
      appWith('rejected'),
    ]
    const summary = outcomeSummary(apps)
    expect(summary.submitted).toBe(10)
    expect(summary.awaitingReply).toBe(8)
    expect(summary.response.rate).toBe(0.2)
    expect(summary.interview.rate).toBe(0.1)
    expect(summary.offer.rate).toBe(0)
  })

  it('is safe with no applications', () => {
    const summary = outcomeSummary([])
    expect(summary.submitted).toBe(0)
    expect(summary.response.shown).toBe(false)
  })

  it('groups by any key, largest group first, skipping null keys', () => {
    const apps = [
      ...Array.from({ length: 12 }, (_, i) => appWith(i < 3 ? 'rejected' : 'applied', [], 'ats')),
      ...Array.from({ length: 4 }, () => appWith('rejected', [], 'referral')),
      appWith('applied', [], 'unknown'),
    ]
    const groups = segmentRates(apps, (app) => (app.channel === 'unknown' ? null : app.channel))
    expect(groups.map((group) => [group.key, group.rate.n, group.rate.rate])).toEqual([
      ['ats', 12, 0.25],
      ['referral', 4, null],
    ])
  })
})
