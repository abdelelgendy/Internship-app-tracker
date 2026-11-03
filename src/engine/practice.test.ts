import { describe, expect, it } from 'vitest'
import { TZ } from './fixtures.ts'
import { BOX_INTERVAL_DAYS, currentStreak, deckStats, dueCards, emptyProgress, grade, nextBox, type Box, type Grade } from './practice.ts'
import type { PracticeCard, PracticeProgress } from './types.ts'

// Tuesday November 3, 2026, 10:00 in Toronto.
const NOW = '2026-11-03T15:00:00.000Z'
const at = (days: number, hourUtc = 15) => new Date(Date.parse(NOW) + days * 86_400_000 + (hourUtc - 15) * 3_600_000).toISOString()

const card = (id: string): PracticeCard => ({ id, kind: 'concept', prompt: `Prompt ${id}`, answer: 'Answer', keyPoints: ['one'], difficulty: 1, tags: [] })
const CARDS = ['a', 'b', 'c', 'd'].map(card)

describe('nextBox', () => {
  it.each<[Box, Grade, Box]>([
    [1, 'again', 1], [3, 'again', 1], [5, 'again', 1],
    [1, 'hard', 1], [3, 'hard', 3], [5, 'hard', 5],
    [1, 'good', 2], [4, 'good', 5], [5, 'good', 5],
    [1, 'easy', 3], [4, 'easy', 5], [5, 'easy', 5],
  ])('box %s, %s -> box %s', (box, result, expected) => {
    expect(nextBox(box, result)).toBe(expected)
  })
})

describe('grade', () => {
  it.each<[Grade, Box, number]>([
    ['again', 1, 0],
    ['hard', 1, 0],
    ['good', 2, 1],
    ['easy', 3, 3],
  ])('a new card graded %s goes to box %s, due in %s days', (result, box, days) => {
    const progress = grade(emptyProgress(), 'a', result, NOW, TZ)
    expect(progress.cards.a).toEqual({ box, dueAt: at(days), lastGrade: result, reviews: 1, lastReviewedAt: NOW })
  })

  it('uses the 0/1/3/7/21 day intervals', () => {
    expect(BOX_INTERVAL_DAYS).toEqual({ 1: 0, 2: 1, 3: 3, 4: 7, 5: 21 })
    let progress = emptyProgress()
    const boxes: number[] = []
    for (let i = 0; i < 5; i += 1) {
      progress = grade(progress, 'a', 'good', NOW, TZ)
      boxes.push(progress.cards.a.box)
    }
    expect(boxes).toEqual([2, 3, 4, 5, 5])
    expect(progress.cards.a.dueAt).toBe(at(21))
    expect(progress.cards.a.reviews).toBe(5)
  })

  it('does not change the progress it was given', () => {
    const before = emptyProgress()
    grade(before, 'a', 'good', NOW, TZ)
    expect(before).toEqual(emptyProgress())
  })

  it('rejects an invalid date', () => {
    expect(() => grade(emptyProgress(), 'a', 'good', 'soon', TZ)).toThrow(RangeError)
  })
})

describe('streak', () => {
  it('counts consecutive local days', () => {
    let progress = grade(emptyProgress(), 'a', 'good', NOW, TZ)
    expect(progress.streak).toEqual({ current: 1, best: 1, lastDay: '2026-11-03' })
    progress = grade(progress, 'b', 'good', at(0, 20), TZ) // later the same day
    expect(progress.streak.current).toBe(1)
    progress = grade(progress, 'a', 'good', at(1), TZ)
    progress = grade(progress, 'a', 'good', at(2), TZ)
    expect(progress.streak).toEqual({ current: 3, best: 3, lastDay: '2026-11-05' })
    progress = grade(progress, 'a', 'good', at(4), TZ) // skipped a day
    expect(progress.streak).toEqual({ current: 1, best: 3, lastDay: '2026-11-07' })
  })

  it('uses the local day, not UTC', () => {
    // 23:30 in Toronto on the 3rd is already the 4th in UTC.
    const lateNight = '2026-11-04T04:30:00.000Z'
    const progress = grade(grade(emptyProgress(), 'a', 'good', NOW, TZ), 'b', 'good', lateNight, TZ)
    expect(progress.streak).toEqual({ current: 1, best: 1, lastDay: '2026-11-03' })
  })

  it('ignores a clock that moved backwards', () => {
    const progress = grade(grade(emptyProgress(), 'a', 'good', at(2), TZ), 'b', 'good', NOW, TZ)
    expect(progress.streak).toEqual({ current: 1, best: 1, lastDay: '2026-11-05' })
  })

  it('shows 0 once a day has been missed', () => {
    const progress = grade(emptyProgress(), 'a', 'good', NOW, TZ)
    expect(currentStreak(progress, NOW, TZ)).toBe(1)
    expect(currentStreak(progress, at(1), TZ)).toBe(1)
    expect(currentStreak(progress, at(2), TZ)).toBe(0)
    expect(currentStreak(emptyProgress(), NOW, TZ)).toBe(0)
  })
})

describe('dueCards and deckStats', () => {
  const progress: PracticeProgress = {
    ...emptyProgress(),
    cards: {
      a: { box: 3, dueAt: at(-2), reviews: 2, lastReviewedAt: at(-5) },
      b: { box: 1, dueAt: at(0, 23), reviews: 1, lastReviewedAt: NOW }, // later today
      c: { box: 5, dueAt: at(10), reviews: 6, lastReviewedAt: at(-11) },
    },
  }

  it('lists due reviews, most overdue first, then unseen cards', () => {
    expect(dueCards(CARDS, progress, NOW, TZ).map((entry) => entry.id)).toEqual(['a', 'b', 'd'])
  })

  it('caps unseen cards', () => {
    expect(dueCards(CARDS, progress, NOW, TZ, 0).map((entry) => entry.id)).toEqual(['a', 'b'])
  })

  it("counts boxes, due cards and today's reviews", () => {
    expect(deckStats({ cards: CARDS }, progress, NOW, TZ)).toEqual({
      total: 4,
      unseen: 1,
      due: 2,
      learning: 1,
      reviewing: 1,
      mastered: 1,
      byBox: { 1: 1, 2: 0, 3: 1, 4: 0, 5: 1 },
      reviewedToday: 1,
    })
  })

  it('handles an empty deck', () => {
    expect(deckStats({ cards: [] }, emptyProgress(), NOW, TZ)).toMatchObject({ total: 0, due: 0, unseen: 0 })
    expect(dueCards([], emptyProgress(), NOW, TZ)).toEqual([])
  })
})
