import type { JobFacts } from './types.ts'

/**
 * How a posting's experience requirement maps onto the rubric. The old rubric matched literal
 * phrases ("1-2 years"); this reads the extracted level and year range instead, so "1 to 2 years"
 * and "1\u20132 years" (an en dash) land in the same band. The bands keep the old points:
 *
 *   new grad, entry level, junior, or 0-2 years   base 15, bonus +10, tier 1
 *   intern or co-op                               base 15, bonus +8,  tier 1
 *   1-3 or 2-3 years                              base 12, bonus +5,  tier 2
 *   2-4 years (or a wide range starting at 2)     base 8,             tier 2
 *   3-5 years (a "stretch" range)                 base 4,  penalty -5, tier 3
 *   any other range starting at 3+ years          base 2,  penalty -5, tier 3
 *   not stated                                    base 2,             tier 2
 */
export interface ExperienceBand {
  base: number
  bonus: number
  penalty: number
  tier: 1 | 2 | 3
  /** A 3-to-N year range: allowed past maxYears, but only at a score of 80 or more after the penalty. */
  stretch: boolean
  /** Plain description of what the posting asks for. */
  summary: string
}

export const STRETCH_MIN_SCORE = 80
const STRETCH_START_YEARS = 3

function yearsText(min: number, max: number | null): string {
  if (max === null) return `${min}+ years`
  if (min === max) return `${min} years`
  return `${min} to ${max} years`
}

export function experienceBand(facts: JobFacts): ExperienceBand {
  const min = facts.yearsMin ?? null
  const max = facts.yearsMax ?? null
  const stated = min !== null || max !== null
  const lo = min ?? 0
  const hi = max ?? lo
  const stretch = min === STRETCH_START_YEARS && max !== null && max > STRETCH_START_YEARS
  const penalty = min !== null && min >= STRETCH_START_YEARS ? -5 : 0
  const years = stated ? yearsText(lo, max) : ''

  if (facts.level === 'new_grad' || facts.level === 'junior') {
    const summary = facts.level === 'new_grad' ? 'New-grad or entry-level role' : 'Junior role'
    return { base: 15, bonus: 10, penalty, tier: 1, stretch, summary: years ? `${summary}, asks for ${years}` : summary }
  }
  if (facts.level === 'intern') {
    return { base: 15, bonus: 8, penalty, tier: 1, stretch, summary: 'Internship or co-op' }
  }
  if (!stated) return { base: 2, bonus: 0, penalty: 0, tier: 2, stretch: false, summary: 'Experience not stated' }
  const summary = `Asks for ${years}`
  if (lo <= 1 && hi <= 2) return { base: 15, bonus: 10, penalty, tier: 1, stretch, summary }
  if (lo <= 2 && hi <= 3) return { base: 12, bonus: 5, penalty, tier: 2, stretch, summary }
  if (lo <= 2) return { base: 8, bonus: 0, penalty, tier: 2, stretch, summary }
  if (stretch) return { base: 4, bonus: 0, penalty, tier: 3, stretch, summary }
  return { base: 2, bonus: 0, penalty, tier: 3, stretch, summary }
}
