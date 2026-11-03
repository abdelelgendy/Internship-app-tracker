import { defaultTimeZone, localDaysBetween, toMillis, type Instant } from '@/engine/dates.ts'
import { BOX_INTERVAL_DAYS, deckStats, dueCards, nextBox, type Box, type Grade } from '@/engine/practice.ts'
import type { PracticeCard, PracticeDeck, PracticeProgress } from '@/engine/types.ts'

/** Cards a review adds that were never seen before, so a big new deck arrives a few at a time. */
export const NEW_CARDS_PER_SESSION = 10

/** A card graded "again" comes back later in the same session, up to this many showings. */
export const MAX_SHOWINGS = 3

export const GRADES: readonly { grade: Grade; label: string; key: string }[] = [
  { grade: 'again', label: 'Again', key: '1' },
  { grade: 'hard', label: 'Hard', key: '2' },
  { grade: 'good', label: 'Good', key: '3' },
  { grade: 'easy', label: 'Easy', key: '4' },
]

export interface SessionCard {
  card: PracticeCard
  deck: Pick<PracticeDeck, 'id' | 'title'>
}

export type SessionScope = { kind: 'due' } | { kind: 'all' }

/**
 * The cards for one review session. "due" is what the scheduler says to study now plus up to
 * NEW_CARDS_PER_SESSION unseen cards; "all" is every card in deck order, for a full run-through.
 */
export function buildQueue(
  decks: readonly PracticeDeck[],
  progress: PracticeProgress,
  scope: SessionScope,
  now: Instant,
  timeZone: string = defaultTimeZone(),
): SessionCard[] {
  const deckOf = new Map<string, Pick<PracticeDeck, 'id' | 'title'>>()
  const cards: PracticeCard[] = []
  for (const deck of decks) {
    for (const card of deck.cards) {
      // Card ids are unique across decks by contract; if two collide, the first deck keeps it.
      if (deckOf.has(card.id)) continue
      deckOf.set(card.id, { id: deck.id, title: deck.title })
      cards.push(card)
    }
  }
  const chosen = scope.kind === 'all' ? cards : dueCards(cards, progress, now, timeZone, NEW_CARDS_PER_SESSION)
  return chosen.map((card) => ({ card, deck: deckOf.get(card.id) as Pick<PracticeDeck, 'id' | 'title'> }))
}

/** How many cards a "due" session would hold right now: reviews that are due, and new cards up to the limit. */
export function dueSummary(
  decks: readonly PracticeDeck[],
  progress: PracticeProgress,
  now: Instant,
  timeZone: string = defaultTimeZone(),
): { due: number; fresh: number } {
  let due = 0
  let unseen = 0
  for (const deck of decks) {
    const stats = deckStats(deck, progress, now, timeZone)
    due += stats.due
    unseen += stats.unseen
  }
  return { due, fresh: Math.min(unseen, NEW_CARDS_PER_SESSION) }
}

/** The queue after grading the card at `index`: an "again" card is shown once more at the end. */
export function afterGrade(queue: readonly SessionCard[], index: number, result: Grade): SessionCard[] {
  const current = queue[index]
  if (result !== 'again' || !current) return [...queue]
  const showings = queue.filter((entry) => entry.card.id === current.card.id).length
  return showings < MAX_SHOWINGS ? [...queue, current] : [...queue]
}

/** "today", "tomorrow", "in 3 days": when a card in `box` comes back after this grade. */
export function intervalLabel(box: Box | undefined, result: Grade): string {
  const days = BOX_INTERVAL_DAYS[nextBox(box ?? 1, result)]
  if (days === 0) return 'today'
  return days === 1 ? 'tomorrow' : `in ${days} days`
}

/** A grade to suggest after "Explain it back", from the share of key points the learner ticked. */
export function suggestedGrade(ticked: number, total: number): Grade {
  if (total === 0) return 'good'
  const share = ticked / total
  if (share >= 1) return 'good'
  return share >= 0.5 ? 'hard' : 'again'
}

/** "tomorrow" or "in 3 days": when the next of these cards comes due, by local calendar day. Null when none is scheduled. */
export function nextDueLabel(
  progress: PracticeProgress,
  cardIds: ReadonlySet<string>,
  now: Instant,
  timeZone: string = defaultTimeZone(),
): string | null {
  let soonest: number | null = null
  for (const [id, entry] of Object.entries(progress.cards)) {
    const due = toMillis(entry.dueAt)
    if (cardIds.has(id) && due !== null && (soonest === null || due < soonest)) soonest = due
  }
  if (soonest === null) return null
  const days = localDaysBetween(now, soonest, timeZone)
  if (days <= 0) return 'today'
  return days === 1 ? 'tomorrow' : `in ${days} days`
}
