import { useEffect, useId, useState } from 'react'
import { Link } from 'react-router'
import type { Exercise, PracticeProgress } from '@/engine/types.ts'
import { Badge } from '@/ui/Badge.tsx'
import { Button } from '@/ui/Button.tsx'
import { Card, CardBody, CardHeader } from '@/ui/Card.tsx'
import { cx } from '@/ui/cx.ts'
import { PageHeader } from '@/ui/PageHeader.tsx'
import { Textarea } from '@/ui/Textarea.tsx'
import { useToast } from '@/ui/toast-context.ts'
import { clockLabel, EXERCISE_COLUMNS, exerciseStatus, withExerciseNotes, withExerciseStatus, type ExerciseStatus } from './exercises.ts'
import { minutesLabel } from './labels.ts'
import { Markdown } from './Markdown.tsx'
import { useProgressWriter } from './usePractice.ts'

const STATUS_TONE = { todo: 'muted', doing: 'warn', done: 'success' } as const

export function ExerciseView({ exercise, progress, backTo }: { exercise: Exercise; progress: PracticeProgress; backTo: string }) {
  const toast = useToast()
  const writeProgress = useProgressWriter()
  const status = exerciseStatus(progress, exercise.id)
  const label = EXERCISE_COLUMNS.find((column) => column.status === status)?.label

  async function save(next: PracticeProgress, title: string): Promise<boolean> {
    try {
      await writeProgress(next)
      toast.show({ title, tone: 'success' })
      return true
    } catch (error) {
      toast.show({ title: "Couldn't save", description: error instanceof Error ? error.message : String(error), tone: 'danger' })
      return false
    }
  }

  function move(to: ExerciseStatus, title: string) {
    return save(withExerciseStatus(progress, exercise.id, to, new Date()), title)
  }

  return (
    <>
      <Link to={backTo} className="mb-3 inline-block text-[0.8125rem] text-fg-muted underline-offset-2 hover:text-fg hover:underline">
        All exercises
      </Link>
      <PageHeader
        title={exercise.title}
        description={exercise.goal}
        actions={
          <>
            {status === 'todo' ? (
              <Button variant="primary" onClick={() => move('doing', 'Started')}>
                Start
              </Button>
            ) : null}
            {status === 'doing' ? (
              <>
                <Button onClick={() => move('todo', 'Moved to To do')}>Move to To do</Button>
                <Button variant="primary" onClick={() => move('done', 'Marked done')}>
                  Mark done
                </Button>
              </>
            ) : null}
            {status === 'done' ? <Button onClick={() => move('doing', 'Reopened')}>Reopen</Button> : null}
          </>
        }
      />
      <div className="mb-5 flex flex-wrap items-center gap-2 text-[0.8125rem] text-fg-muted">
        <Badge tone={STATUS_TONE[status]}>{label}</Badge>
        {exercise.project ? <Badge>{exercise.project}</Badge> : null}
        <span>Timebox {minutesLabel(exercise.timeboxMinutes)}</span>
      </div>

      <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-4">
          <Card>
            <CardHeader title="What to build" description="From scratch and without AI help: the point is to rebuild the skill yourself." />
            <CardBody>
              <Markdown>{exercise.spec}</Markdown>
            </CardBody>
          </Card>
          <Acceptance checks={exercise.acceptance} />
          {exercise.hints && exercise.hints.length > 0 ? (
            <details className="group rounded-lg border border-line bg-surface">
              <summary className="cursor-pointer px-4 py-3 text-sm font-semibold text-fg select-none">
                Hints <span className="font-mono font-normal text-fg-subtle">{exercise.hints.length}</span>
                <span className="ml-2 font-normal text-fg-muted group-open:hidden">Try without them first.</span>
              </summary>
              <ul className="list-disc space-y-1 border-t border-line py-3 pr-4 pl-9 text-fg">
                {exercise.hints.map((hint, index) => (
                  <li key={index} className="break-words">
                    <Markdown className="space-y-1">{hint}</Markdown>
                  </li>
                ))}
              </ul>
            </details>
          ) : null}
        </div>
        <div className="min-w-0 space-y-4">
          <Timer
            minutes={exercise.timeboxMinutes}
            onStart={() => {
              if (status === 'todo') void move('doing', 'Started')
            }}
          />
          <Notes
            key={exercise.id}
            initial={progress.exercises[exercise.id]?.notes ?? ''}
            onSave={(notes) => save(withExerciseNotes(progress, exercise.id, notes), 'Notes saved')}
          />
        </div>
      </div>
    </>
  )
}

function Acceptance({ checks }: { checks: string[] }) {
  const [ticked, setTicked] = useState<ReadonlySet<number>>(new Set())
  return (
    <Card>
      <CardHeader
        title="Acceptance checks"
        description={
          <>
            <span className="font-mono tabular-nums">
              {ticked.size}/{checks.length}
            </span>{' '}
            ticked. Ticks are for this visit only.
          </>
        }
      />
      <CardBody>
        <ul className="space-y-1.5">
          {checks.map((check, index) => {
            const checked = ticked.has(index)
            return (
              <li key={index}>
                <label className="flex cursor-pointer items-start gap-2.5 rounded px-1 py-1 hover:bg-surface-2">
                  <input
                    type="checkbox"
                    className="mt-0.5 size-4 shrink-0"
                    checked={checked}
                    onChange={() => {
                      const next = new Set(ticked)
                      if (checked) next.delete(index)
                      else next.add(index)
                      setTicked(next)
                    }}
                  />
                  <span className={cx('min-w-0 break-words', checked ? 'text-fg line-through decoration-fg-subtle' : 'text-fg')}>{check}</span>
                </label>
              </li>
            )
          })}
        </ul>
      </CardBody>
    </Card>
  )
}

/** A countdown for the timebox. It measures real elapsed time, so a background tab stays accurate. */
function Timer({ minutes, onStart }: { minutes: number; onStart: () => void }) {
  const budget = minutes * 60_000
  const [runningSince, setRunningSince] = useState<number | null>(null)
  const [banked, setBanked] = useState(0)
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    if (runningSince === null) return
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [runningSince])

  const elapsed = banked + (runningSince === null ? 0 : Math.max(0, now - runningSince))
  const left = budget - elapsed
  const over = left < 0

  return (
    <Card>
      <CardHeader title="Timebox" description={`${minutesLabel(minutes)}. When time runs out, stop and write down where you got stuck.`} headingLevel="h2" />
      <CardBody>
        <p className={cx('font-mono text-4xl font-semibold tracking-tight tabular-nums', over ? 'text-warn-ink' : 'text-fg')} aria-hidden="true">
          {clockLabel(left)}
        </p>
        <p role="status" className="mt-1 min-h-5 text-[0.8125rem] text-fg-muted">
          {over ? "Time's up. Note where you got stuck." : runningSince === null && elapsed > 0 ? 'Paused.' : null}
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {runningSince === null ? (
            <Button
              variant="primary"
              onClick={() => {
                const start = Date.now()
                setNow(start)
                setRunningSince(start)
                onStart()
              }}
            >
              {elapsed > 0 ? 'Resume timer' : 'Start timer'}
            </Button>
          ) : (
            <Button
              onClick={() => {
                setBanked(banked + Math.max(0, Date.now() - runningSince))
                setRunningSince(null)
              }}
            >
              Pause
            </Button>
          )}
          <Button
            variant="ghost"
            disabled={elapsed === 0 && runningSince === null}
            onClick={() => {
              setBanked(0)
              setRunningSince(null)
            }}
          >
            Reset
          </Button>
        </div>
      </CardBody>
    </Card>
  )
}

function Notes({ initial, onSave }: { initial: string; onSave: (notes: string) => Promise<boolean> }) {
  const id = useId()
  const [draft, setDraft] = useState(initial)
  const [saved, setSaved] = useState(initial)
  const [saving, setSaving] = useState(false)
  return (
    <Card>
      <CardHeader title="Notes" description="Where you got stuck, what you looked up, what to try next time." />
      <CardBody>
        <label htmlFor={id} className="sr-only">
          Notes
        </label>
        <Textarea id={id} rows={7} value={draft} onChange={(event) => setDraft(event.target.value)} />
        <Button
          className="mt-3"
          disabled={draft === saved || saving}
          onClick={async () => {
            setSaving(true)
            if (await onSave(draft)) setSaved(draft)
            setSaving(false)
          }}
        >
          Save notes
        </Button>
      </CardBody>
    </Card>
  )
}
