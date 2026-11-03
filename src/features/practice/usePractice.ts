import { useRef } from 'react'
import { useRepo, useRepoData } from '@/data/data-context.ts'
import type { Exercise, PracticeDeck, PracticeProgress, StarStory } from '@/engine/types.ts'

export interface PracticeData {
  decks: PracticeDeck[]
  exercises: Exercise[]
  stories: StarStory[]
  progress: PracticeProgress
}

const byTitle = <T extends { title: string }>(a: T, b: T) => a.title.localeCompare(b.title)

/** Everything the practice pages show, loaded in parallel and again after any save. */
export function usePracticeData() {
  return useRepoData<PracticeData>('practice', async (repo) => {
    const [decks, exercises, stories, progress] = await Promise.all([
      repo.listDecks(),
      repo.listExercises(),
      repo.listStories(),
      repo.getProgress(),
    ])
    return { decks: decks.toSorted(byTitle), exercises, stories, progress }
  })
}

/**
 * Saves practice progress one write at a time, in the order they were made, so a fast run of
 * grades can never land out of order and leave an older copy on disk.
 */
export function useProgressWriter(): (progress: PracticeProgress) => Promise<void> {
  const repo = useRepo()
  const queue = useRef<Promise<unknown>>(Promise.resolve())
  return (progress) => {
    const write = queue.current.then(() => repo.saveProgress(progress))
    queue.current = write.catch(() => {})
    return write
  }
}
