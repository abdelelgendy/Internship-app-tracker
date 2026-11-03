import { createBrowserRepo } from './browserRepo.ts'
import { createMemoryStore } from './docStore.ts'
import { openIndexedDbStore } from './indexedDbStore.ts'
import type { Repo } from './repo.ts'

/** Where the app's data comes from. Chosen once at startup and shown in the banner. */
export type DataMode =
  | { kind: 'local'; dataDir: string }
  | {
      kind: 'sample'
      /** "browser": changes are kept in this browser's IndexedDB. "memory": kept until reload. */
      storage?: 'browser' | 'memory'
      /** Why sample data is showing when local data was expected. */
      notice?: string
    }

export interface DataSource {
  mode: DataMode
  repo: Repo
  /** Sample modes only: puts the sample data back the way it shipped. */
  resetSampleData?: () => Promise<void>
}

const DEV_SWITCH_KEY = 'shortlist:data'

/** Dev server only: `?data=sample` shows the demo data in this tab, `?data=local` switches back. */
function devPrefersSample(): boolean {
  const asked = new URLSearchParams(window.location.search).get('data')
  try {
    if (asked === 'sample' || asked === 'local') sessionStorage.setItem(DEV_SWITCH_KEY, asked)
    return (asked ?? sessionStorage.getItem(DEV_SWITCH_KEY)) === 'sample'
  } catch {
    return asked === 'sample'
  }
}

async function openLocal(): Promise<DataSource> {
  const { createLocalApiRepo, fetchLocalStatus } = await import('./localApiRepo.ts')
  const { dataDir } = await fetchLocalStatus()
  return { mode: { kind: 'local', dataDir }, repo: createLocalApiRepo() }
}

/** The demo: sample data copied into IndexedDB on the first visit, or into memory if the browser refuses. */
async function openSample(notice?: string): Promise<DataSource> {
  const loadSeed = () => import('./sampleRepo.ts').then((module) => module.createSampleRepo())
  try {
    const browser = createBrowserRepo(await openIndexedDbStore(), loadSeed)
    await browser.ready
    return { mode: { kind: 'sample', storage: 'browser', notice }, repo: browser.repo, resetSampleData: browser.reset }
  } catch (error) {
    console.warn('[shortlist] IndexedDB is unavailable, so changes last until reload:', error)
    const browser = createBrowserRepo(createMemoryStore(), loadSeed)
    await browser.ready
    return { mode: { kind: 'sample', storage: 'memory', notice }, repo: browser.repo, resetSampleData: browser.reset }
  }
}

/**
 * Picks the data source. `npm run dev` uses the local data folder through the dev middleware;
 * the production build has no middleware (that branch is removed at build time) and always
 * runs the demo.
 */
export async function openDataSource(): Promise<DataSource> {
  if (import.meta.env.DEV) {
    if (devPrefersSample()) return openSample('Dev server showing sample data. Add ?data=local to the address to use your data folder.')
    try {
      return await openLocal()
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error)
      return openSample(`Your data folder could not be opened, so this is sample data. ${reason}`)
    }
  }
  return openSample()
}
