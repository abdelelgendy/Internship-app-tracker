import { toIso } from '@/engine/dates.ts'
import type { Exercise, PracticeProgress } from '@/engine/types.ts'

export type ExerciseStatus = PracticeProgress['exercises'][string]['status']
export type ExerciseEntry = PracticeProgress['exercises'][string]

export const EXERCISE_COLUMNS: readonly { status: ExerciseStatus; label: string }[] = [
  { status: 'todo', label: 'To do' },
  { status: 'doing', label: 'In progress' },
  { status: 'done', label: 'Done' },
]

export function exerciseStatus(progress: PracticeProgress, id: string): ExerciseStatus {
  return progress.exercises[id]?.status ?? 'todo'
}

export function groupExercises(exercises: readonly Exercise[], progress: PracticeProgress): Record<ExerciseStatus, Exercise[]> {
  const groups: Record<ExerciseStatus, Exercise[]> = { todo: [], doing: [], done: [] }
  for (const exercise of exercises) groups[exerciseStatus(progress, exercise.id)].push(exercise)
  return groups
}

/**
 * Progress with an exercise moved to `status`. Starting records when work began (once), finishing
 * records when it was done, and reopening a finished exercise clears the finish time.
 */
export function withExerciseStatus(progress: PracticeProgress, id: string, status: ExerciseStatus, now: Date): PracticeProgress {
  const previous: ExerciseEntry = progress.exercises[id] ?? { status: 'todo' }
  const entry: ExerciseEntry = { ...previous, status }
  if (status !== 'todo' && !entry.startedAt) entry.startedAt = toIso(now.getTime())
  if (status === 'done') entry.doneAt = toIso(now.getTime())
  else delete entry.doneAt
  return { ...progress, exercises: { ...progress.exercises, [id]: entry } }
}

export function withExerciseNotes(progress: PracticeProgress, id: string, notes: string): PracticeProgress {
  const previous: ExerciseEntry = progress.exercises[id] ?? { status: 'todo' }
  const entry: ExerciseEntry = { ...previous }
  if (notes.trim() === '') delete entry.notes
  else entry.notes = notes
  return { ...progress, exercises: { ...progress.exercises, [id]: entry } }
}

/** "12:05" for time left, "-3:20" once the timebox has run out. */
export function clockLabel(ms: number): string {
  const sign = ms < 0 ? '-' : ''
  const total = Math.floor(Math.abs(ms) / 1000)
  const hours = Math.floor(total / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const seconds = String(total % 60).padStart(2, '0')
  return hours > 0 ? `${sign}${hours}:${String(minutes).padStart(2, '0')}:${seconds}` : `${sign}${minutes}:${seconds}`
}
