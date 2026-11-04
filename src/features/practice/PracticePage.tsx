import { Link, useSearchParams } from 'react-router'
import { currentStreak, deckStats } from '@/engine/practice.ts'
import type { PracticeDeck, PracticeProgress } from '@/engine/types.ts'
import { Badge } from '@/ui/Badge.tsx'
import { Card } from '@/ui/Card.tsx'
import { cx } from '@/ui/cx.ts'
import { EmptyState } from '@/ui/EmptyState.tsx'
import { PageHeader } from '@/ui/PageHeader.tsx'
import { Skeleton, SkeletonText } from '@/ui/Skeleton.tsx'
import { buttonClass } from '@/ui/styles.ts'
import { Tabs } from '@/ui/Tabs.tsx'
import { BoxLadder } from './BoxLadder.tsx'
import { ExerciseBoard } from './ExerciseBoard.tsx'
import { ExerciseView } from './ExerciseView.tsx'
import { plural } from './labels.ts'
import { LoadError } from './LoadError.tsx'
import { ReviewSession } from './ReviewSession.tsx'
import { dueSummary } from './session.ts'
import { StoryLibrary } from './StoryLibrary.tsx'
import { usePracticeData, type PracticeData } from './usePractice.ts'

const TABS = ['decks', 'exercises', 'stories'] as const
type Tab = (typeof TABS)[number]

/**
 * /practice shows the decks, exercises and stories. Two views live on the same route as search
 * parameters, so they need no routes of their own: ?review=due is today's review across every
 * deck, and ?exercise=<id> opens one exercise.
 */
export function PracticePage() {
  const [params, setParams] = useSearchParams()
  const { data, error, reload } = usePracticeData()

  if (!data) {
    return error ? <LoadError title="Practice" error={error} onRetry={reload} /> : <PracticeSkeleton />
  }

  if (params.get('review') === 'due') {
    return (
      <ReviewSession
        title="Today's review"
        decks={data.decks}
        progress={data.progress}
        scope={{ kind: 'due' }}
        backTo="/practice"
        backLabel="Back to practice"
      />
    )
  }

  const exerciseId = params.get('exercise')
  if (exerciseId !== null) {
    const exercise = data.exercises.find((candidate) => candidate.id === exerciseId)
    return exercise ? (
      <ExerciseView exercise={exercise} progress={data.progress} backTo="/practice?tab=exercises" />
    ) : (
      <>
        <PageHeader title="Exercise not found" />
        <EmptyState
          title="There is no exercise with this id"
          description={<span className="font-mono break-all">{exerciseId}</span>}
          action={
            <Link to="/practice?tab=exercises" className={buttonClass()}>
              All exercises
            </Link>
          }
        />
      </>
    )
  }

  const tab: Tab = TABS.find((name) => name === params.get('tab')) ?? 'decks'
  return (
    <PracticeHome
      data={data}
      tab={tab}
      onTab={(next) => setParams(next === 'decks' ? {} : { tab: next }, { replace: true, preventScrollReset: true })}
    />
  )
}

function PracticeHome({ data, tab, onTab }: { data: PracticeData; tab: Tab; onTab: (tab: Tab) => void }) {
  const now = new Date()
  const { due, fresh } = dueSummary(data.decks, data.progress, now)
  const waiting = due + fresh
  const streak = currentStreak(data.progress, now)
  const reviewedToday = data.decks.reduce((sum, deck) => sum + deckStats(deck, data.progress, now).reviewedToday, 0)

  return (
    <>
      <PageHeader
        title="Practice"
        description="Explain your own projects out loud, rebuild small pieces without AI, and keep true stories ready for behavioral questions."
        actions={
          waiting > 0 ? (
            <Link to="/practice?review=due" className={buttonClass({ variant: 'primary' })}>
              Today's review
              <span className="rounded bg-surface/20 px-1 font-mono text-xs tabular-nums">{waiting}</span>
            </Link>
          ) : null
        }
      />

      <dl className="mb-6 grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-4">
        <Stat label="Due now" value={String(due)} note={fresh > 0 ? `plus ${fresh} new` : 'cards to review'} highlight={due > 0} />
        <Stat label="Streak" value={String(streak)} unit={streak === 1 ? 'day' : 'days'} note={`best ${plural(data.progress.streak.best, 'day')}`} />
        <Stat label="Reviewed today" value={String(reviewedToday)} note="cards" />
        <Stat label="Exercises done" value={`${Object.values(data.progress.exercises).filter((entry) => entry.status === 'done').length}/${data.exercises.length}`} note="rebuilt without AI" />
      </dl>

      <Tabs
        label="Practice sections"
        value={tab}
        onChange={(id) => onTab(id as Tab)}
        items={[
          { id: 'decks', label: 'Decks', count: data.decks.length, content: <DeckList decks={data.decks} progress={data.progress} now={now} /> },
          { id: 'exercises', label: 'Exercises', count: data.exercises.length, content: <ExerciseBoard exercises={data.exercises} progress={data.progress} /> },
          { id: 'stories', label: 'Stories', count: data.stories.length, content: <StoryLibrary stories={data.stories} /> },
        ]}
      />
    </>
  )
}

function Stat({ label, value, unit, note, highlight = false }: { label: string; value: string; unit?: string; note: string; highlight?: boolean }) {
  return (
    <div className="min-w-0 bg-surface px-4 py-3">
      <dt className="text-xs text-fg-muted">{label}</dt>
      <dd className="mt-0.5">
        <span className={cx('font-mono text-xl font-semibold text-fg tabular-nums', highlight ? 'mark-swipe' : null)}>{value}</span>
        {unit ? <span className="ml-1 text-sm text-fg-muted">{unit}</span> : null}
        <span className="block text-xs text-fg-subtle">{note}</span>
      </dd>
    </div>
  )
}

function DeckList({ decks, progress, now }: { decks: PracticeDeck[]; progress: PracticeProgress; now: Date }) {
  if (decks.length === 0) {
    return (
      <EmptyState
        title="No decks yet"
        description="Decks hold interview questions about your projects, with model answers grounded in the code. Import them from your job-hunter folder."
        action={
          <Link to="/import" className={buttonClass()}>
            Go to Import
          </Link>
        }
      />
    )
  }
  return (
    <ul className="grid gap-3 md:grid-cols-2">
      {decks.map((deck) => {
        const stats = deckStats(deck, progress, now)
        return (
          <li key={deck.id} className="min-w-0">
            <Card className="flex h-full flex-col p-4">
              <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
                <h2 className="min-w-0 font-semibold break-words text-fg">
                  <Link to={`/practice/${encodeURIComponent(deck.id)}`} className="hover:underline hover:underline-offset-2">
                    {deck.title}
                  </Link>
                </h2>
                {deck.project ? <Badge>{deck.project}</Badge> : null}
              </div>
              <p className="mt-1 text-[0.8125rem] break-words text-fg-muted">{deck.description}</p>
              <div className="mt-auto pt-4">
                <BoxLadder stats={stats} />
                <div className="mt-3 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[0.8125rem] text-fg-muted">
                    <span className={cx('font-mono tabular-nums', stats.due > 0 ? 'font-semibold text-fg' : null)}>{stats.due}</span> due ·{' '}
                    <span className="font-mono tabular-nums">{stats.total}</span> cards · <span className="font-mono tabular-nums">{stats.mastered}</span>{' '}
                    mastered
                  </p>
                  {stats.due + stats.unseen > 0 ? (
                    <Link to={`/practice/${encodeURIComponent(deck.id)}?review=due`} className={buttonClass({ size: 'sm' })}>
                      Review<span className="sr-only"> {deck.title}</span>
                    </Link>
                  ) : null}
                </div>
              </div>
            </Card>
          </li>
        )
      })}
    </ul>
  )
}

export function PracticeSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading practice">
      <div className="mb-6 space-y-2">
        <Skeleton className="h-7 w-32" />
        <Skeleton className="h-4 w-full max-w-prose" />
      </div>
      <Skeleton className="mb-6 h-[4.5rem] w-full" />
      <Skeleton className="mb-4 h-9 w-72 max-w-full" />
      <div className="grid gap-3 md:grid-cols-2">
        {[0, 1, 2, 3].map((index) => (
          <div key={index} className="rounded-lg border border-line bg-surface p-4">
            <Skeleton className="mb-2 h-5 w-1/2" />
            <SkeletonText lines={2} />
            <Skeleton className="mt-4 h-12 w-full" />
          </div>
        ))}
      </div>
    </div>
  )
}
