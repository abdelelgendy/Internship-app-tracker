import { useEffect, useEffectEvent, useId, useRef, useState } from 'react'
import { Link } from 'react-router'
import { currentStreak, grade, type Box, type Grade } from '@/engine/practice.ts'
import type { PracticeDeck, PracticeProgress } from '@/engine/types.ts'
import { Badge } from '@/ui/Badge.tsx'
import { Button } from '@/ui/Button.tsx'
import { Card } from '@/ui/Card.tsx'
import { cx } from '@/ui/cx.ts'
import { EmptyState } from '@/ui/EmptyState.tsx'
import { Kbd } from '@/ui/Kbd.tsx'
import { PageHeader } from '@/ui/PageHeader.tsx'
import { buttonClass } from '@/ui/styles.ts'
import { Textarea } from '@/ui/Textarea.tsx'
import { useToast } from '@/ui/toast-context.ts'
import { CARD_KIND_LABEL, DIFFICULTY_LABEL, plural } from './labels.ts'
import { Markdown } from './Markdown.tsx'
import {
  afterGrade,
  buildQueue,
  GRADES,
  intervalLabel,
  nextDueLabel,
  suggestedGrade,
  type SessionCard,
  type SessionScope,
} from './session.ts'
import { useProgressWriter } from './usePractice.ts'

type Stage = 'prompt' | 'explain' | 'revealed'

/** Number keys belong to a text field while it has focus; a ticked checkbox does not take them. */
function isTyping(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target instanceof HTMLInputElement) return !['checkbox', 'radio', 'button', 'submit', 'reset'].includes(target.type)
  return target.isContentEditable || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT'
}

export interface ReviewSessionProps {
  title: string
  decks: PracticeDeck[]
  progress: PracticeProgress
  scope: SessionScope
  /** Where "End session" and "Back" go. */
  backTo: string
  backLabel: string
  /** Offered when nothing is due, e.g. a link to review every card in the deck. */
  emptyAction?: { to: string; label: string }
}

/**
 * One review session. The queue is fixed when the session starts, so saving progress (which
 * reloads the page's data) never reshuffles the cards in front of you. Each grade is saved
 * straight away, so ending early loses nothing.
 */
export function ReviewSession({ title, decks, progress: initialProgress, scope, backTo, backLabel, emptyAction }: ReviewSessionProps) {
  const toast = useToast()
  const writeProgress = useProgressWriter()
  const [queue, setQueue] = useState(() => buildQueue(decks, initialProgress, scope, new Date()))
  const [progress, setProgress] = useState(initialProgress)
  const [index, setIndex] = useState(0)
  const [stage, setStage] = useState<Stage>('prompt')
  const [explanation, setExplanation] = useState('')
  const [explained, setExplained] = useState(false)
  const [ticked, setTicked] = useState<ReadonlySet<number>>(new Set())
  const [tally, setTally] = useState<Record<Grade, number>>({ again: 0, hard: 0, good: 0, easy: 0 })
  const promptRef = useRef<HTMLHeadingElement>(null)
  const answerRef = useRef<HTMLHeadingElement>(null)

  const current: SessionCard | undefined = queue[index]

  useEffect(() => {
    promptRef.current?.focus({ preventScroll: index === 0 })
  }, [index])

  useEffect(() => {
    if (stage === 'revealed') answerRef.current?.focus()
  }, [stage])

  function gradeCurrent(result: Grade) {
    if (!current) return
    const next = grade(progress, current.card.id, result, new Date())
    setProgress(next)
    setQueue(afterGrade(queue, index, result))
    setIndex(index + 1)
    setStage('prompt')
    setExplanation('')
    setExplained(false)
    setTicked(new Set())
    setTally((counts) => ({ ...counts, [result]: counts[result] + 1 }))
    writeProgress(next).catch((error: unknown) => {
      toast.show({
        title: "Couldn't save your review",
        description: `${error instanceof Error ? error.message : String(error)} Your next grade saves everything again.`,
        tone: 'danger',
      })
    })
  }

  const onKeyDown = useEffectEvent((event: KeyboardEvent) => {
    if (stage !== 'revealed' || event.repeat || event.metaKey || event.ctrlKey || event.altKey) return
    if (isTyping(event.target) || document.querySelector('dialog[open]')) return
    const choice = GRADES.find((entry) => entry.key === event.key)
    if (!choice) return
    event.preventDefault()
    gradeCurrent(choice.grade)
  })

  useEffect(() => {
    const listener = (event: KeyboardEvent) => onKeyDown(event)
    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
  }, [])

  if (queue.length === 0) {
    const next = nextDueLabel(progress, new Set(decks.flatMap((deck) => deck.cards.map((card) => card.id))), new Date())
    return (
      <>
        <PageHeader title={title} />
        <EmptyState
          title="Nothing to review right now"
          description={next ? `The next card comes back ${next}.` : 'There are no cards here yet. Import a deck to start practising.'}
          action={
            <div className="flex flex-wrap justify-center gap-2">
              {emptyAction ? (
                <Link to={emptyAction.to} className={buttonClass({ variant: 'primary' })}>
                  {emptyAction.label}
                </Link>
              ) : null}
              <Link to={backTo} className={buttonClass()}>
                {backLabel}
              </Link>
            </div>
          }
        />
      </>
    )
  }

  if (!current) {
    return <SessionSummary title={title} tally={tally} progress={progress} decks={decks} backTo={backTo} backLabel={backLabel} />
  }

  const { card, deck } = current
  const box = progress.cards[card.id]?.box
  const suggestion = explained ? suggestedGrade(ticked.size, card.keyPoints.length) : null

  return (
    <>
      <PageHeader
        title={title}
        actions={
          <Link to={backTo} className={buttonClass({ variant: 'ghost', size: 'sm' })}>
            End session
          </Link>
        }
      />
      <SessionProgress position={index + 1} total={queue.length} />

      <Card className="mt-4">
        <div className="border-b border-line px-4 py-4 md:px-6 md:py-5">
          <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[0.8125rem] text-fg-muted">
            <span className="min-w-0 break-words">{deck.title}</span>
            <span aria-hidden="true">·</span>
            <Badge>{CARD_KIND_LABEL[card.kind]}</Badge>
            <Badge tone="muted">{DIFFICULTY_LABEL[card.difficulty]}</Badge>
            {box ? <span className="font-mono text-xs text-fg-subtle">box {box}</span> : <Badge tone="accent">New</Badge>}
          </div>
          <h2 ref={promptRef} tabIndex={-1} className="text-lg leading-snug font-semibold text-balance text-fg outline-none md:text-xl">
            {card.prompt}
          </h2>
        </div>

        {stage === 'prompt' ? (
          <div className="flex flex-wrap gap-2 px-4 py-4 md:px-6">
            <Button variant="primary" onClick={() => setStage('explain')}>
              Explain it back
            </Button>
            <Button onClick={() => setStage('revealed')}>Show answer</Button>
          </div>
        ) : null}

        {stage === 'explain' ? (
          <ExplainForm
            value={explanation}
            onChange={setExplanation}
            onCompare={() => {
              setExplained(explanation.trim() !== '')
              setStage('revealed')
            }}
            onSkip={() => setStage('revealed')}
          />
        ) : null}

        {stage === 'revealed' ? (
          <div className="px-4 py-4 md:px-6 md:py-5">
            <div className={cx('grid gap-4', explained ? 'md:grid-cols-2' : null)}>
              {explained ? (
                <section aria-labelledby="your-answer" className="min-w-0">
                  <h3 id="your-answer" className="mb-2 text-xs font-semibold tracking-wide text-fg-muted uppercase">
                    Your answer
                  </h3>
                  <p className="rounded-md bg-surface-2 px-3 py-2.5 whitespace-pre-wrap break-words text-fg">{explanation}</p>
                </section>
              ) : null}
              <section aria-labelledby="model-answer" className="min-w-0">
                <h3 id="model-answer" ref={answerRef} tabIndex={-1} className="mb-2 text-xs font-semibold tracking-wide text-fg-muted uppercase outline-none">
                  Model answer
                </h3>
                <Markdown>{card.answer}</Markdown>
                {card.source ? (
                  <p className="mt-3 text-xs text-fg-muted">
                    Source: <span className="font-mono break-all text-fg">{card.source}</span>
                  </p>
                ) : null}
              </section>
            </div>

            {card.keyPoints.length > 0 ? (
              <KeyPoints points={card.keyPoints} ticked={ticked} onChange={setTicked} />
            ) : null}

            <GradeButtons box={box} suggestion={suggestion} onGrade={gradeCurrent} />
          </div>
        ) : null}
      </Card>
    </>
  )
}

function SessionProgress({ position, total }: { position: number; total: number }) {
  return (
    <div className="flex items-center gap-3">
      <p className="shrink-0 font-mono text-xs text-fg-muted tabular-nums">
        Card {position} of {total}
      </p>
      <div
        role="progressbar"
        aria-label="Session progress"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={position - 1}
        className="h-1.5 min-w-0 flex-1 overflow-hidden rounded-full bg-surface-2"
      >
        <div className="h-full rounded-full bg-fg transition-[width] motion-reduce:transition-none" style={{ width: `${((position - 1) / total) * 100}%` }} />
      </div>
    </div>
  )
}

function ExplainForm({
  value,
  onChange,
  onCompare,
  onSkip,
}: {
  value: string
  onChange: (value: string) => void
  onCompare: () => void
  onSkip: () => void
}) {
  const id = useId()
  return (
    <form
      className="px-4 py-4 md:px-6"
      onSubmit={(event) => {
        event.preventDefault()
        onCompare()
      }}
    >
      <label htmlFor={id} className="mb-1 block text-[0.8125rem] font-medium text-fg">
        Explain it in your own words
      </label>
      <p id={`${id}-hint`} className="mb-2 text-xs text-fg-muted">
        Answer as you would out loud in an interview. Nothing you type here is saved.
      </p>
      <Textarea
        id={id}
        aria-describedby={`${id}-hint`}
        rows={6}
        autoFocus
        value={value}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && (event.metaKey || event.ctrlKey)) {
            event.preventDefault()
            onCompare()
          }
        }}
      />
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button type="submit" variant="primary" disabled={value.trim() === ''}>
          Compare with the model answer
        </Button>
        <Button variant="ghost" onClick={onSkip}>
          Show answer
        </Button>
        <span className="hidden text-xs text-fg-subtle sm:inline">
          <Kbd>Ctrl</Kbd> <Kbd>Enter</Kbd> compares
        </span>
      </div>
    </form>
  )
}

function KeyPoints({ points, ticked, onChange }: { points: string[]; ticked: ReadonlySet<number>; onChange: (next: ReadonlySet<number>) => void }) {
  return (
    <fieldset className="mt-5 min-w-0 rounded-md border border-line px-3 pt-1 pb-3">
      <legend className="px-1 text-xs font-semibold tracking-wide text-fg-muted uppercase">
        Key points <span className="font-mono normal-case tabular-nums">{ticked.size}/{points.length}</span>
      </legend>
      <p className="mb-2 text-xs text-fg-muted">Tick each one your answer covered.</p>
      <ul className="space-y-1.5">
        {points.map((point, position) => {
          const checked = ticked.has(position)
          return (
            <li key={position}>
              <label className="flex cursor-pointer items-start gap-2.5 rounded px-1 py-1 hover:bg-surface-2">
                <input
                  type="checkbox"
                  className="mt-0.5 size-4 shrink-0"
                  checked={checked}
                  onChange={() => {
                    const next = new Set(ticked)
                    if (checked) next.delete(position)
                    else next.add(position)
                    onChange(next)
                  }}
                />
                <span className={cx('min-w-0 break-words', checked ? 'text-fg' : 'text-fg-muted')}>{point}</span>
              </label>
            </li>
          )
        })}
      </ul>
    </fieldset>
  )
}

function GradeButtons({ box, suggestion, onGrade }: { box: Box | undefined; suggestion: Grade | null; onGrade: (grade: Grade) => void }) {
  return (
    <div className="mt-5">
      <p id="grade-label" className="mb-2 text-[0.8125rem] font-medium text-fg">
        How well did you know it?{' '}
        {suggestion ? (
          <span className="font-normal text-fg-muted">From your key points: {GRADES.find((entry) => entry.grade === suggestion)?.label}.</span>
        ) : null}
      </p>
      <div role="group" aria-labelledby="grade-label" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {GRADES.map((entry) => (
          <button
            key={entry.grade}
            type="button"
            onClick={() => onGrade(entry.grade)}
            aria-label={`${entry.label}, back ${intervalLabel(box, entry.grade)}`}
            aria-keyshortcuts={entry.key}
            className={cx(
              'flex min-h-14 flex-col items-start justify-center gap-0.5 rounded-md border px-3 py-2 text-left transition-colors',
              entry.grade === suggestion ? 'border-fg bg-accent-soft hover:bg-accent-soft/70' : 'border-line-strong bg-surface hover:bg-surface-2',
            )}
          >
            <span className="flex w-full items-center justify-between gap-2 text-sm font-medium text-fg">
              {entry.label}
              <Kbd>{entry.key}</Kbd>
            </span>
            <span className="text-xs text-fg-muted">Back {intervalLabel(box, entry.grade)}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

function SessionSummary({
  title,
  tally,
  progress,
  decks,
  backTo,
  backLabel,
}: {
  title: string
  tally: Record<Grade, number>
  progress: PracticeProgress
  decks: PracticeDeck[]
  backTo: string
  backLabel: string
}) {
  const now = new Date()
  const reviewed = tally.again + tally.hard + tally.good + tally.easy
  const streak = currentStreak(progress, now)
  const next = nextDueLabel(progress, new Set(decks.flatMap((deck) => deck.cards.map((card) => card.id))), now)
  const headingRef = useRef<HTMLHeadingElement>(null)
  useEffect(() => headingRef.current?.focus(), [])
  return (
    <>
      <PageHeader title={title} />
      <Card className="px-4 py-6 md:px-6">
        <h2 ref={headingRef} tabIndex={-1} className="text-lg font-semibold text-fg outline-none">
          Session done
        </h2>
        <p className="mt-1 text-fg-muted">
          You reviewed {plural(reviewed, 'card')}.{next ? ` The next one comes back ${next}.` : null}
        </p>
        <dl className="mt-5 grid grid-cols-2 gap-3 sm:grid-cols-5">
          {GRADES.map((entry) => (
            <div key={entry.grade} className="rounded-md bg-surface-2 px-3 py-2">
              <dt className="text-xs text-fg-muted">{entry.label}</dt>
              <dd className="font-mono text-lg font-semibold text-fg tabular-nums">{tally[entry.grade]}</dd>
            </div>
          ))}
          <div className="rounded-md bg-accent-soft px-3 py-2">
            <dt className="text-xs text-fg-muted">Streak</dt>
            <dd className="font-mono text-lg font-semibold text-fg tabular-nums">{plural(streak, 'day')}</dd>
          </div>
        </dl>
        <Link to={backTo} className={cx(buttonClass({ variant: 'primary' }), 'mt-6')}>
          {backLabel}
        </Link>
      </Card>
    </>
  )
}
