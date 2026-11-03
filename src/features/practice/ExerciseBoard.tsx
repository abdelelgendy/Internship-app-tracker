import { Link } from 'react-router'
import type { Exercise, PracticeProgress } from '@/engine/types.ts'
import { Badge } from '@/ui/Badge.tsx'
import { EmptyState } from '@/ui/EmptyState.tsx'
import { EXERCISE_COLUMNS, groupExercises } from './exercises.ts'
import { minutesLabel } from './labels.ts'

export function ExerciseBoard({ exercises, progress }: { exercises: Exercise[]; progress: PracticeProgress }) {
  if (exercises.length === 0) {
    return (
      <EmptyState
        title="No exercises yet"
        description="Exercises are small things to rebuild from scratch, without AI, so you can explain your own projects. Import them from your job-hunter folder."
        action={
          <Link to="/import" className="text-sm font-medium text-fg underline underline-offset-2">
            Go to Import
          </Link>
        }
      />
    )
  }
  const groups = groupExercises(exercises, progress)
  return (
    <div className="grid gap-4 xl:grid-cols-3">
      {EXERCISE_COLUMNS.map((column) => (
        <section key={column.status} aria-labelledby={`exercises-${column.status}`} className="min-w-0 rounded-lg bg-surface-2/60 p-2">
          <h3 id={`exercises-${column.status}`} className="flex items-center gap-2 px-2 pt-1 pb-2 text-[0.8125rem] font-semibold text-fg">
            {column.label}
            <span className="font-mono text-xs font-normal text-fg-subtle tabular-nums">{groups[column.status].length}</span>
          </h3>
          {groups[column.status].length === 0 ? (
            <p className="px-2 pb-2 text-[0.8125rem] text-fg-muted">{column.status === 'done' ? 'Nothing finished yet.' : 'Nothing here.'}</p>
          ) : (
            <ul className="space-y-2">
              {groups[column.status].map((exercise) => (
                <li key={exercise.id}>
                  <Link
                    to={`/practice?exercise=${encodeURIComponent(exercise.id)}`}
                    className="block rounded-md border border-line bg-surface px-3 py-2.5 transition-colors hover:border-line-strong"
                  >
                    <span className="block font-medium break-words text-fg">{exercise.title}</span>
                    <span className="mt-0.5 block text-[0.8125rem] break-words text-fg-muted">{exercise.goal}</span>
                    <span className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-fg-subtle">
                      {exercise.project ? <Badge>{exercise.project}</Badge> : null}
                      <span className="font-mono">{minutesLabel(exercise.timeboxMinutes)}</span>
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </section>
      ))}
    </div>
  )
}
