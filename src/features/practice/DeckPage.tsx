import { Link, useParams, useSearchParams } from 'react-router'
import { deckStats } from '@/engine/practice.ts'
import type { PracticeDeck, PracticeProgress } from '@/engine/types.ts'
import { Badge } from '@/ui/Badge.tsx'
import { Card } from '@/ui/Card.tsx'
import { cx } from '@/ui/cx.ts'
import { EmptyState } from '@/ui/EmptyState.tsx'
import { PageHeader } from '@/ui/PageHeader.tsx'
import { Skeleton, SkeletonText } from '@/ui/Skeleton.tsx'
import { buttonClass } from '@/ui/styles.ts'
import { BoxLadder } from './BoxLadder.tsx'
import { CARD_KIND_LABEL, DIFFICULTY_LABEL, plural } from './labels.ts'
import { LoadError } from './LoadError.tsx'
import { ReviewSession } from './ReviewSession.tsx'
import { usePracticeData } from './usePractice.ts'

/** /practice/:deckId: the deck's cards and where each one stands. ?review=due or ?review=all runs a session. */
export function DeckPage() {
  const { deckId = '' } = useParams()
  const [params] = useSearchParams()
  const { data, error, reload } = usePracticeData()

  if (!data) return error ? <LoadError title="Deck" error={error} onRetry={reload} /> : <DeckSkeleton />

  const deck = data.decks.find((candidate) => candidate.id === deckId)
  if (!deck) {
    return (
      <>
        <PageHeader
          title="Deck"
          description={
            <>
              There is no deck called <span className="font-mono break-all">{deckId}</span> in your data.
            </>
          }
        />
        <EmptyState
          title="Deck not found"
          description="It may have been renamed in your job-hunter folder. Import again to bring in the latest decks."
          action={
            <Link to="/practice" className={buttonClass()}>
              All decks
            </Link>
          }
        />
      </>
    )
  }

  const review = params.get('review')
  const deckPath = `/practice/${encodeURIComponent(deck.id)}`
  if (review === 'due' || review === 'all') {
    return (
      <ReviewSession
        key={review}
        title={deck.title}
        decks={[deck]}
        progress={data.progress}
        scope={{ kind: review }}
        backTo={deckPath}
        backLabel="Back to the deck"
        emptyAction={review === 'due' ? { to: `${deckPath}?review=all`, label: 'Practise every card anyway' } : undefined}
      />
    )
  }

  return <DeckOverview deck={deck} progress={data.progress} deckPath={deckPath} />
}

function DeckOverview({ deck, progress, deckPath }: { deck: PracticeDeck; progress: PracticeProgress; deckPath: string }) {
  const now = new Date()
  const stats = deckStats(deck, progress, now)
  return (
    <>
      <Link to="/practice" className="mb-3 inline-block text-[0.8125rem] text-fg-muted underline-offset-2 hover:text-fg hover:underline">
        All decks
      </Link>
      <PageHeader
        title={deck.title}
        description={deck.description}
        actions={
          <>
            <Link to={`${deckPath}?review=all`} className={buttonClass()}>
              Practise every card
            </Link>
            {stats.due + stats.unseen > 0 ? (
              <Link to={`${deckPath}?review=due`} className={buttonClass({ variant: 'primary' })}>
                Review due cards
              </Link>
            ) : null}
          </>
        }
      />
      <Card className="mb-6 grid gap-4 p-4 sm:grid-cols-[minmax(0,1fr)_16rem] sm:items-end">
        <p className="text-fg-muted">
          <span className="font-mono text-fg tabular-nums">{stats.due}</span> due now,{' '}
          <span className="font-mono text-fg tabular-nums">{stats.unseen}</span> not seen yet,{' '}
          <span className="font-mono text-fg tabular-nums">{stats.mastered}</span> of {plural(stats.total, 'card')} in box 5.
          {deck.project ? (
            <>
              {' '}
              Project: <Badge>{deck.project}</Badge>
            </>
          ) : null}
        </p>
        <BoxLadder stats={stats} />
      </Card>

      <h2 className="mb-2 text-sm font-semibold text-fg">Cards</h2>
      <ol className="divide-y divide-line overflow-hidden rounded-lg border border-line bg-surface">
        {deck.cards.map((card) => {
          const entry = progress.cards[card.id]
          return (
            <li key={card.id} className="flex flex-col gap-1.5 px-4 py-3 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
              <div className="min-w-0">
                <p className="break-words text-fg">{card.prompt}</p>
                <p className="mt-1 flex flex-wrap gap-1.5">
                  <Badge>{CARD_KIND_LABEL[card.kind]}</Badge>
                  <Badge tone="muted">{DIFFICULTY_LABEL[card.difficulty]}</Badge>
                </p>
              </div>
              <p className={cx('shrink-0 font-mono text-xs tabular-nums sm:text-right', entry ? 'text-fg-muted' : 'text-fg-subtle')}>
                {entry ? (
                  <>
                    box {entry.box} · due {new Date(entry.dueAt).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                  </>
                ) : (
                  'new'
                )}
              </p>
            </li>
          )
        })}
      </ol>
    </>
  )
}

function DeckSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading deck">
      <Skeleton className="mb-3 h-4 w-16" />
      <div className="mb-6 space-y-2">
        <Skeleton className="h-7 w-64 max-w-full" />
        <SkeletonText lines={2} className="max-w-prose" />
      </div>
      <Skeleton className="mb-6 h-20 w-full" />
      <div className="divide-y divide-line rounded-lg border border-line bg-surface">
        {[0, 1, 2, 3, 4].map((index) => (
          <div key={index} className="px-4 py-3">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="mt-2 h-4 w-32" />
          </div>
        ))}
      </div>
    </div>
  )
}
