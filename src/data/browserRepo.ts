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
import type { Contents, DocStore, Entries } from './docStore.ts'
import { emptyProgress, wrapRepo, type Repo } from './repo.ts'

/** Marks a store as seeded; its absence means a first visit. */
const SEED_KEY = 'seed'

export interface BrowserRepo {
  repo: Repo
  /** Settles once the store holds data: right away on a return visit, after seeding on the first. */
  ready: Promise<void>
  /** Replaces everything in the store with a fresh copy of the seed. */
  reset(): Promise<void>
}

const byId = <T extends { id: string }>(rows: readonly T[]): Entries => rows.map((row) => [row.id, row])

/** Copies everything a repo holds into store contents. */
async function snapshot(source: Repo): Promise<Contents> {
  const [profile, jobs, applications, decks, exercises, stories, progress, companies] = await Promise.all([
    source.getProfile(),
    source.listJobs(),
    source.listApplications(),
    source.listDecks(),
    source.listExercises(),
    source.listStories(),
    source.getProgress(),
    source.listCompanies(),
  ])
  const covers = await Promise.all(applications.map(async ({ id }) => [id, await source.getCoverLetter(id)] as const))
  const docs: [string, unknown][] = [
    ['exercises', exercises],
    ['stories', stories],
    ['progress', progress],
    ['companies', companies],
    [SEED_KEY, { seededAt: new Date().toISOString() }],
  ]
  if (profile) docs.push(['profile', profile])
  return {
    jobs: byId(jobs),
    applications: byId(applications),
    decks: byId(decks),
    covers: covers.filter(([, text]) => text !== null),
    docs,
  }
}

/**
 * A writable repo over a DocStore, seeded from `loadSeed` on first use. In the public demo
 * the store is IndexedDB, so a visitor's changes stay in their own browser and nowhere else.
 * Every call waits for seeding, so the repo can be handed out before `ready` settles.
 */
export function createBrowserRepo(store: DocStore, loadSeed: () => Promise<Repo>): BrowserRepo {
  const reset = async () => store.replaceAll(await snapshot(await loadSeed()))
  const ready = (async () => {
    if ((await store.get('docs', SEED_KEY)) === undefined) await reset()
  })()
  // A failed seed reaches every caller through `ready`; this only stops it being reported as unhandled.
  ready.catch(() => {})

  const getDoc = async <T>(key: string, fallback: T): Promise<T> => ((await store.get('docs', key)) as T | undefined) ?? fallback
  const putDoc = (key: string, value: unknown) => store.putMany('docs', [[key, value]])

  const repo: Repo = {
    getProfile: () => getDoc<Profile | null>('profile', null),
    saveProfile: (profile) => putDoc('profile', profile),
    listJobs: async () => (await store.getAll('jobs')) as Job[],
    saveJob: (job) => store.putMany('jobs', byId([job])),
    saveJobs: (jobs) => store.putMany('jobs', byId(jobs)),
    listApplications: async () => (await store.getAll('applications')) as Application[],
    saveApplication: (application) => store.putMany('applications', byId([application])),
    listDecks: async () => (await store.getAll('decks')) as PracticeDeck[],
    getDeck: async (id) => ((await store.get('decks', id)) as PracticeDeck | undefined) ?? null,
    listExercises: () => getDoc<Exercise[]>('exercises', []),
    listStories: () => getDoc<StarStory[]>('stories', []),
    getProgress: () => getDoc<PracticeProgress>('progress', emptyProgress()),
    saveProgress: (progress) => putDoc('progress', progress),
    listCompanies: () => getDoc<Company[]>('companies', []),
    getCoverLetter: async (applicationId) => ((await store.get('covers', applicationId)) as string | undefined) ?? null,
    saveCoverLetter: (applicationId, markdown) => store.putMany('covers', [[applicationId, markdown]]),
  }

  return {
    ready,
    reset: async () => {
      await ready.catch(() => {})
      await reset()
    },
    repo: wrapRepo(repo, async (_name, call) => {
      await ready
      return call()
    }),
  }
}
