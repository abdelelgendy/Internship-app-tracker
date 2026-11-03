import { DAY_MS, daysBetweenDays, defaultTimeZone, localDay, toIso, toMillis, type Instant } from './dates.ts'
import type { PracticeCard, PracticeDeck, PracticeProgress } from './types.ts'

/**
 * Leitner-box spaced repetition. Each card sits in box 1 to 5; a correct answer moves it up and
 * spaces the next review further out, a miss sends it back to box 1.
 *
 *   again  back to box 1        box 1: due again today
 *   hard   stays in its box     box 2: 1 day
 *   good   up one box           box 3: 3 days
 *   easy   up two boxes         box 4: 7 days
 *                               box 5: 21 days
 *
 * "Due" compares local calendar days, so a card due tomorrow shows up any time tomorrow.
 */

export type Grade = 'again' | 'hard' | 'good' | 'easy'
export type Box = 1 | 2 | 3 | 4 | 5

export const BOX_INTERVAL_DAYS: Record<Box, number> = { 1: 0, 2: 1, 3: 3, 4: 7, 5: 21 }

export function emptyProgress(): PracticeProgress {
  return { cards: {}, exercises: {}, streak: { current: 0, best: 0 } }
}

export function nextBox(box: Box, grade: Grade): Box {
  switch (grade) {
    case 'again':
      return 1
    case 'hard':
      return box
    case 'good':
      return Math.min(5, box + 1) as Box
    case 'easy':
      return Math.min(5, box + 2) as Box
  }
}

function updatedStreak(streak: PracticeProgress['streak'], today: string): PracticeProgress['streak'] {
  if (!streak.lastDay) return { current: 1, best: Math.max(1, streak.best), lastDay: today }
  const gap = daysBetweenDays(streak.lastDay, today)
  // Same day, or a clock that moved backwards: nothing new to count.
  if (gap <= 0) return streak
  const current = gap === 1 ? streak.current + 1 : 1
  return { current, best: Math.max(streak.best, current), lastDay: today }
}

/** Records one review and returns new progress. The input is not changed. A card never seen starts in box 1. */
export function grade(
  progress: PracticeProgress,
  cardId: string,
  result: Grade,
  now: Instant,
  timeZone: string = defaultTimeZone(),
): PracticeProgress {
  const nowMs = toMillis(now)
  if (nowMs === null) throw new RangeError(`Not a valid date: ${String(now)}`)
  const previous = progress.cards[cardId]
  const box = nextBox(previous?.box ?? 1, result)
  return {
    ...progress,
    cards: {
      ...progress.cards,
      [cardId]: {
        box,
        dueAt: toIso(nowMs + BOX_INTERVAL_DAYS[box] * DAY_MS),
        lastGrade: result,
        reviews: (previous?.reviews ?? 0) + 1,
        lastReviewedAt: toIso(nowMs),
      },
    },
    streak: updatedStreak(progress.streak, localDay(nowMs, timeZone)),
  }
}

function isDue(dueAt: string, today: string, timeZone: string): boolean {
  return toMillis(dueAt) === null || localDay(dueAt, timeZone) <= today
}

/**
 * Cards to study now: reviews that are due (most overdue first, then lower boxes), then cards
 * never seen, in deck order. `newLimit` caps how many unseen cards are added.
 */
export function dueCards(
  cards: readonly PracticeCard[],
  progress: PracticeProgress,
  now: Instant,
  timeZone: string = defaultTimeZone(),
  newLimit: number = Infinity,
): PracticeCard[] {
  const today = localDay(now, timeZone)
  const reviews = cards
    .filter((card) => progress.cards[card.id] && isDue(progress.cards[card.id].dueAt, today, timeZone))
    .sort((a, b) => {
      const pa = progress.cards[a.id]
      const pb = progress.cards[b.id]
      return (toMillis(pa.dueAt) ?? 0) - (toMillis(pb.dueAt) ?? 0) || pa.box - pb.box
    })
  const unseen = cards.filter((card) => !progress.cards[card.id]).slice(0, newLimit)
  return [...reviews, ...unseen]
}

export interface DeckStats {
  total: number
  unseen: number
  due: number
  /** Seen cards in boxes 1-2, 3-4 and 5. */
  learning: number
  reviewing: number
  mastered: number
  byBox: Record<Box, number>
  reviewedToday: number
}

export function deckStats(
  deck: Pick<PracticeDeck, 'cards'>,
  progress: PracticeProgress,
  now: Instant,
  timeZone: string = defaultTimeZone(),
): DeckStats {
  const today = localDay(now, timeZone)
  const byBox: Record<Box, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 }
  let unseen = 0
  let due = 0
  let reviewedToday = 0
  for (const card of deck.cards) {
    const entry = progress.cards[card.id]
    if (!entry) {
      unseen += 1
      continue
    }
    byBox[entry.box] += 1
    if (isDue(entry.dueAt, today, timeZone)) due += 1
    if (entry.lastReviewedAt && toMillis(entry.lastReviewedAt) !== null && localDay(entry.lastReviewedAt, timeZone) === today) {
      reviewedToday += 1
    }
  }
  return {
    total: deck.cards.length,
    unseen,
    due,
    learning: byBox[1] + byBox[2],
    reviewing: byBox[3] + byBox[4],
    mastered: byBox[5],
    byBox,
    reviewedToday,
  }
}

/** The streak to display: still alive if the last practice was today or yesterday, otherwise 0. */
export function currentStreak(progress: PracticeProgress, now: Instant, timeZone: string = defaultTimeZone()): number {
  const { lastDay, current } = progress.streak
  if (!lastDay) return 0
  return daysBetweenDays(lastDay, localDay(now, timeZone)) <= 1 ? current : 0
}
