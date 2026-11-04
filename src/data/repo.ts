import type {
  Application,
  Company,
  Exercise,
  Job,
  PracticeDeck,
  PracticeProgress,
  Profile,
  StarStory,
} from '../engine/types.ts'

/**
 * Everything the app reads and writes, over the data contract in src/engine/types.ts.
 * Saves are upserts by id. Lists come back in no particular order; pages sort for display.
 *
 * Implementations are plain objects of closures (no `this`), so a method can be passed
 * around or wrapped on its own.
 */
export interface Repo {
  /** Null until a profile exists: the demo ships one, a new data folder does not. */
  getProfile(): Promise<Profile | null>
  saveProfile(profile: Profile): Promise<void>
  listJobs(): Promise<Job[]>
  saveJob(job: Job): Promise<void>
  saveJobs(jobs: readonly Job[]): Promise<void>
  listApplications(): Promise<Application[]>
  saveApplication(application: Application): Promise<void>
  listDecks(): Promise<PracticeDeck[]>
  getDeck(id: string): Promise<PracticeDeck | null>
  listExercises(): Promise<Exercise[]>
  listStories(): Promise<StarStory[]>
  /** An empty record when nothing has been practised yet. */
  getProgress(): Promise<PracticeProgress>
  saveProgress(progress: PracticeProgress): Promise<void>
  listCompanies(): Promise<Company[]>
  /** The Markdown draft for an application, or null when there is none. */
  getCoverLetter(applicationId: string): Promise<string | null>
  saveCoverLetter(applicationId: string, markdown: string): Promise<void>
}

/** Thrown by a repo that cannot save, such as the bundled sample data itself. */
export class ReadOnlyRepoError extends Error {
  name = 'ReadOnlyRepoError'
}

/** Thrown when a save was built on data that changed since it was loaded; the views reload. */
export class StaleDataError extends Error {
  name = 'StaleDataError'
}

export function isWriteMethod(name: keyof Repo): boolean {
  return name.startsWith('save')
}

/** A repo whose every call runs through `around`: to wait for setup first, or to report saves. */
export function wrapRepo(repo: Repo, around: (name: keyof Repo, call: () => Promise<unknown>) => Promise<unknown>): Repo {
  const wrapped: Partial<Record<keyof Repo, unknown>> = {}
  for (const name of Object.keys(repo) as (keyof Repo)[]) {
    const method = repo[name] as (...args: unknown[]) => Promise<unknown>
    wrapped[name] = (...args: unknown[]) => around(name, () => method(...args))
  }
  return wrapped as unknown as Repo
}

export function emptyProgress(): PracticeProgress {
  return { cards: {}, exercises: {}, streak: { current: 0, best: 0 } }
}
