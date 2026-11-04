import type { Company, Exercise, PracticeDeck, PracticeProgress, Profile, StarStory } from '../engine/types.ts'
import { readJsonl } from './jsonl.ts'
import { emptyProgress, ReadOnlyRepoError, type Repo } from './repo.ts'

/**
 * The fictional demo data in sample-data/, bundled into its own chunk at build time.
 * Only the contract files are included: sample-data/README.md is not data.
 */
const PREFIX = '../../sample-data/'
const bundled: Record<string, string> = Object.fromEntries(
  Object.entries(
    import.meta.glob<string>(
      ['../../sample-data/*.{json,jsonl}', '../../sample-data/practice/**/*.json', '../../sample-data/covers/*.md'],
      { query: '?raw', import: 'default', eager: true },
    ),
  ).map(([path, text]) => [path.slice(PREFIX.length), text]),
)

/**
 * The moment the sample data was written for. Reads move every timestamp by the time since
 * then, so a visitor always sees postings from "3 hours ago" and follow-ups due "tomorrow".
 */
export const SAMPLE_ANCHOR = '2026-11-03T17:00:00.000Z'

const DAY_MS = 86_400_000
// Whole half hours, so a demo interview reads "9:00 PM" on every visit, not 9:15, then 9:17.
const SHIFT_STEP_MS = 30 * 60_000
const DATETIME = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z$/
const DATE = /^\d{4}-\d{2}-\d{2}$/

function shiftDates(value: unknown, ms: number, days: number): unknown {
  if (typeof value === 'string') {
    if (DATETIME.test(value)) return new Date(Date.parse(value) + ms).toISOString()
    if (DATE.test(value)) return new Date(Date.parse(`${value}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10)
    return value
  }
  if (Array.isArray(value)) return value.map((item) => shiftDates(item, ms, days))
  if (value !== null && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, shiftDates(item, ms, days)]))
  }
  return value
}

/** Moves full UTC timestamps by the elapsed time in whole half hours, and dates by the elapsed calendar days. */
export function shiftSampleDates<T>(value: T, now: Date, anchor = new Date(SAMPLE_ANCHOR)): T {
  const ms = Math.floor((now.getTime() - anchor.getTime()) / SHIFT_STEP_MS) * SHIFT_STEP_MS
  const days = Math.floor(now.getTime() / DAY_MS) - Math.floor(anchor.getTime() / DAY_MS)
  return ms === 0 && days === 0 ? value : (shiftDates(value, ms, days) as T)
}

/** Read-only access to the bundled sample data, with dates moved to `now`. Saves reject. */
export function createSampleRepo({ now = new Date() }: { now?: Date } = {}): Repo {
  const shift = <T>(value: T): T => shiftSampleDates(value, now)
  const json = <T>(path: string, fallback: T): T => {
    const text = bundled[path]
    return text === undefined ? fallback : shift(JSON.parse(text) as T)
  }
  const rows = <T extends { id: string }>(path: string): T[] => shift(readJsonl<T>(bundled[path] ?? '').rows)
  const decks = (): PracticeDeck[] =>
    Object.entries(bundled)
      .filter(([path]) => path.startsWith('practice/decks/'))
      .map(([, text]) => shift(JSON.parse(text) as PracticeDeck))
  const readOnly = async (): Promise<never> => {
    throw new ReadOnlyRepoError('The bundled sample data is read-only.')
  }

  return {
    getProfile: async () => json<Profile | null>('profile.json', null),
    saveProfile: readOnly,
    listJobs: async () => rows('jobs.jsonl'),
    saveJob: readOnly,
    saveJobs: readOnly,
    listApplications: async () => rows('applications.jsonl'),
    saveApplication: readOnly,
    listDecks: async () => decks(),
    getDeck: async (id) => decks().find((deck) => deck.id === id) ?? null,
    listExercises: async () => json<Exercise[]>('practice/exercises.json', []),
    listStories: async () => json<StarStory[]>('practice/stories.json', []),
    getProgress: async () => json<PracticeProgress>('practice/progress.json', emptyProgress()),
    saveProgress: readOnly,
    listCompanies: async () => json<Company[]>('companies.json', []),
    getCoverLetter: async (applicationId) => bundled[`covers/${applicationId}.md`] ?? null,
    saveCoverLetter: readOnly,
  }
}
