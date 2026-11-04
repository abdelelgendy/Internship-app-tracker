import { describe, expect, it } from 'vitest'
import { experienceBand } from './experience.ts'
import { makeJob, TZ } from './fixtures.ts'
import { byQueueOrder, dailyCapFor, queueStatusFor, recencyGate, tierOf } from './gates.ts'
import type { JobFacts, ScoreResult } from './types.ts'

const NOW = '2026-11-04T12:00:00.000Z'
const hoursAgo = (hours: number) => new Date(Date.parse(NOW) - hours * 3_600_000).toISOString()

describe('recencyGate', () => {
  it.each([
    // [age in hours, score, verdict]
    [0, 65, 'apply'],
    [0, 64, 'skip'],
    [11.99, 65, 'apply'],
    [12, 65, 'skip'],
    [12, 70, 'apply'],
    [23.99, 70, 'apply'],
    [24, 70, 'skip'],
    [24, 75, 'apply'],
    [47.99, 75, 'apply'],
    [48, 75, 'skip'],
    [48, 85, 'apply'],
    [71.99, 85, 'apply'],
    [72, 100, 'skip'],
    [168, 100, 'skip'],
  ] as const)('age %sh, score %s -> %s', (age, score, verdict) => {
    expect(recencyGate(score, hoursAgo(age), NOW, 'Northwind Apps').verdict).toBe(verdict)
  })

  it.each([
    [72, 85, 'apply'],
    [72, 84, 'skip'],
    [168, 85, 'apply'],
    [168.01, 100, 'skip'],
  ] as const)('exception company at %sh, score %s -> %s', (age, score, verdict) => {
    expect(recencyGate(score, hoursAgo(age), NOW, 'Shopify Inc.').verdict).toBe(verdict)
  })

  it('takes a custom exception list', () => {
    expect(recencyGate(90, hoursAgo(100), NOW, 'Northwind Apps', ['Northwind Apps']).verdict).toBe('apply')
  })

  it('holds a job whose age is unknown, with a reason', () => {
    const gate = recencyGate(99, null, NOW, 'Northwind Apps')
    expect(gate.verdict).toBe('hold')
    expect(gate.reason).toMatch(/date unknown/i)
    expect(recencyGate(99, '', NOW, 'Northwind Apps').verdict).toBe('hold')
    expect(recencyGate(99, 'last Tuesday', NOW, 'Northwind Apps').reason).toMatch(/can't be read/)
  })

  it.each([[20], [64]])('skips a score of %s with no date, since no date could make it pass', (score) => {
    for (const postedAt of [null, '', 'last Tuesday', hoursAgo(-2)]) {
      const gate = recencyGate(score, postedAt, NOW, 'Shopify')
      expect(gate.verdict).toBe('skip')
      expect(gate.reason).toMatch(/lowest any posting age needs/)
    }
  })

  it('still holds a score of 65 with no date, since a fresh date would pass it', () => {
    expect(recencyGate(65, null, NOW, 'Northwind Apps').verdict).toBe('hold')
  })

  it('treats a small clock skew as fresh and a future date as bad data', () => {
    expect(recencyGate(65, hoursAgo(-0.5), NOW, 'Northwind Apps').verdict).toBe('apply')
    expect(recencyGate(65, hoursAgo(-2), NOW, 'Northwind Apps').verdict).toBe('hold')
  })

  it('explains the decision in plain words', () => {
    expect(recencyGate(72, hoursAgo(30), NOW, 'Northwind Apps').reason).toBe(
      'Posted 30 hours ago. Score 72 is below the 75 needed at 24 to 48 hours.',
    )
    expect(recencyGate(90, hoursAgo(80), NOW, 'Northwind Apps').reason).toBe('Posted 3 days ago. That is past the 72-hour window.')
    expect(recencyGate(90, hoursAgo(80), NOW, 'Shopify').reason).toBe(
      'Posted 3 days ago. Shopify is on the exception list, open for 7 days at 85. Score 90 meets it.',
    )
    expect(recencyGate(90, hoursAgo(200), NOW, 'Shopify').reason).toBe('Posted 8 days ago. That is past the 7-day window, even for Shopify.')
  })
})

describe('experienceBand and tierOf', () => {
  it.each<[JobFacts, number, number, number, 1 | 2 | 3, boolean]>([
    // facts, base, bonus, penalty, tier, stretch
    [{ level: 'new_grad' }, 15, 10, 0, 1, false],
    [{ level: 'junior' }, 15, 10, 0, 1, false],
    [{ level: 'intern' }, 15, 8, 0, 1, false],
    [{ level: 'unknown', yearsMin: 0, yearsMax: 2 }, 15, 10, 0, 1, false],
    [{ level: 'unknown', yearsMin: 1, yearsMax: null }, 8, 0, 0, 2, false],
    [{ level: 'unknown', yearsMin: 1, yearsMax: 3 }, 12, 5, 0, 2, false],
    [{ level: 'unknown', yearsMin: 2, yearsMax: 3 }, 12, 5, 0, 2, false],
    [{ level: 'unknown', yearsMin: 2, yearsMax: null }, 8, 0, 0, 2, false],
    [{ level: 'unknown', yearsMin: 2, yearsMax: 4 }, 8, 0, 0, 2, false],
    [{ level: 'unknown', yearsMin: 1, yearsMax: 5 }, 8, 0, 0, 2, false],
    [{ level: 'unknown', yearsMin: 3, yearsMax: 5 }, 4, 0, -5, 3, true],
    [{ level: 'unknown', yearsMin: 3, yearsMax: null }, 2, 0, -5, 3, false],
    [{ level: 'unknown', yearsMin: 5, yearsMax: null }, 2, 0, -5, 3, false],
    [{ level: 'unknown' }, 2, 0, 0, 2, false],
    [{ level: 'junior', yearsMin: 3, yearsMax: 5 }, 15, 10, -5, 1, true],
  ])('%j', (facts, base, bonus, penalty, tier, stretch) => {
    const band = experienceBand(facts)
    expect([band.base, band.bonus, band.penalty, band.tier, band.stretch]).toEqual([base, bonus, penalty, tier, stretch])
    expect(tierOf(facts)).toBe(tier)
  })

  it('never ranks an open range above the closed range it contains', () => {
    const points = (yearsMin: number, yearsMax: number | null) => {
      const band = experienceBand({ level: 'unknown', yearsMin, yearsMax })
      return band.base + band.bonus + band.penalty
    }
    expect(points(1, null)).toBeLessThan(points(1, 3))
    expect(points(2, null)).toBeLessThanOrEqual(points(2, 4))
    expect(points(3, null)).toBeLessThanOrEqual(points(3, 5))
  })
})

function scored(tier: 1 | 2 | 3 | null, total: number): ScoreResult {
  return { total, parts: [], tier, disqualifiers: [], gate: { verdict: 'apply', reason: '' }, rubricVersion: 'test' }
}

describe('byQueueOrder', () => {
  it('sorts by tier, then newest, then score, with unscored and disqualified last', () => {
    const jobs = [
      makeJob({ id: 'unscored', postedAt: hoursAgo(1) }),
      makeJob({ id: 'dq', score: scored(null, 0), postedAt: hoursAgo(1) }),
      makeJob({ id: 't2-new', score: scored(2, 70), postedAt: hoursAgo(2) }),
      makeJob({ id: 't1-old', score: scored(1, 90), postedAt: hoursAgo(40) }),
      makeJob({ id: 't1-new', score: scored(1, 66), postedAt: hoursAgo(3) }),
      makeJob({ id: 't1-undated', score: scored(1, 99), postedAt: null }),
      makeJob({ id: 't1-new-higher', score: scored(1, 80), postedAt: hoursAgo(3) }),
    ]
    expect([...jobs].sort(byQueueOrder).map((job) => job.id)).toEqual([
      't1-new-higher', 't1-new', 't1-old', 't1-undated', 't2-new', 'dq', 'unscored',
    ])
  })
})

describe('dailyCapFor', () => {
  it.each([
    ['2026-11-01T17:00:00Z', 0], // Sunday
    ['2026-11-02T17:00:00Z', 10], // Monday
    ['2026-11-06T17:00:00Z', 10], // Friday
    ['2026-11-07T17:00:00Z', 0], // Saturday
    ['2026-11-07T03:00:00Z', 10], // still Friday evening in Toronto
  ])('%s -> %s', (now, cap) => {
    expect(dailyCapFor(now, undefined, TZ)).toBe(cap)
  })

  it('uses the caps from settings', () => {
    expect(dailyCapFor('2026-11-07T17:00:00Z', [1, 2, 3, 4, 5, 6, 7], TZ)).toBe(7)
  })
})

describe('queueStatusFor', () => {
  const base = scored(1, 80)
  it.each([
    [base, { duplicate: true }, 'skipped_duplicate'],
    [{ ...base, disqualifiers: ['Not a software role.'] }, {}, 'skipped_dealbreaker'],
    [base, { ghost: 'Says "talent pool".' }, 'skipped_ghost'],
    [{ ...base, gate: { verdict: 'skip' as const, reason: '' } }, {}, 'skipped_age'],
    [{ ...base, gate: { verdict: 'hold' as const, reason: '' } }, {}, 'queued'],
    [base, {}, 'queued'],
  ])('%#', (result, signals, status) => {
    expect(queueStatusFor(result, signals)).toBe(status)
  })
})
