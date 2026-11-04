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
import { readJsonl, rowFingerprint } from './jsonl.ts'
import { idFile } from './layout.ts'
import { errorFrom, LOCAL_API_BASE, LOCAL_API_HEADER, STALE_ROWS_STATUS, type LocalStatus } from './localApi.ts'
import { emptyProgress, StaleDataError, type Repo } from './repo.ts'

function client(baseUrl: string) {
  // The fingerprint of each row as this tab last read or wrote it, sent with every save.
  const seen = new Map<string, string>()
  const seenKey = (file: string, id: string) => `${file}\n${id}`
  const call = (path: string, init: RequestInit = {}, query = '') => {
    const headers = new Headers(init.headers)
    headers.set(LOCAL_API_HEADER, '1')
    // The middleware answers with cache-control: no-store, so nothing here is cached.
    return fetch(`${baseUrl}/${path.split('/').map(encodeURIComponent).join('/')}${query}`, { ...init, headers })
  }
  const ok = async (response: Response): Promise<Response> => {
    if (!response.ok) throw await errorFrom(response)
    return response
  }
  return {
    /** Null when the file does not exist yet. */
    async readText(file: string): Promise<string | null> {
      const response = await call(`files/${file}`, {}, '?optional')
      return response.status === 204 || response.status === 404 ? null : (await ok(response)).text()
    },
    async writeText(file: string, text: string): Promise<void> {
      await ok(await call(`files/${file}`, { method: 'PUT', body: text, headers: { 'content-type': 'text/plain' } }))
    },
    /** Rows by id, remembering each row's fingerprint so a later save can be checked against it. */
    readRows<T extends { id: string }>(file: string, text: string): T[] {
      const { rows, issues } = readJsonl<T>(text)
      if (issues.length > 0) console.warn(`[shortlist] Skipped ${issues.length} unreadable line(s) in ${file}; saves keep them as they are.`, issues)
      for (const row of rows) seen.set(seenKey(file, row.id), rowFingerprint(row))
      return rows
    },
    async upsertRows(file: string, rows: readonly { id: string }[]): Promise<void> {
      if (rows.length === 0) return
      const base = Object.fromEntries(
        rows.flatMap((row) => {
          const fingerprint = seen.get(seenKey(file, row.id))
          return fingerprint ? [[row.id, fingerprint]] : []
        }),
      )
      const response = await call(`rows/${file}`, { method: 'POST', body: JSON.stringify({ rows, base }), headers: { 'content-type': 'application/json' } })
      if (response.status === STALE_ROWS_STATUS) throw new StaleDataError((await errorFrom(response)).message)
      await ok(response)
      for (const row of rows) seen.set(seenKey(file, row.id), rowFingerprint(row))
    },
    async listIds(folder: string): Promise<string[]> {
      return (await ok(await call(`list/${folder}`))).json() as Promise<string[]>
    },
    async status(): Promise<LocalStatus> {
      return (await ok(await call('status'))).json() as Promise<LocalStatus>
    },
  }
}

/** Asks the dev middleware for the data folder, creating its layout on the first call. */
export function fetchLocalStatus({ baseUrl = LOCAL_API_BASE }: { baseUrl?: string } = {}): Promise<LocalStatus> {
  return client(baseUrl).status()
}

/**
 * The repo for `npm run dev`: every call goes to the middleware in vite.config.ts, which reads
 * and writes the data folder (COPILOT_DATA_DIR, default .private/) on this machine.
 */
export function createLocalApiRepo({ baseUrl = LOCAL_API_BASE }: { baseUrl?: string } = {}): Repo {
  const api = client(baseUrl)
  const readJson = async <T>(file: string, fallback: T): Promise<T> => {
    const text = await api.readText(file)
    return text === null ? fallback : (JSON.parse(text) as T)
  }
  const writeJson = (file: string, value: unknown) => api.writeText(file, `${JSON.stringify(value, null, 2)}\n`)
  const readRows = async <T extends { id: string }>(file: string): Promise<T[]> => api.readRows<T>(file, (await api.readText(file)) ?? '')
  const getDeck = async (id: string) => readJson<PracticeDeck | null>(idFile('practice/decks', id), null)

  return {
    getProfile: () => readJson<Profile | null>('profile.json', null),
    saveProfile: (profile) => writeJson('profile.json', profile),
    listJobs: () => readRows<Job>('jobs.jsonl'),
    saveJob: (job) => api.upsertRows('jobs.jsonl', [job]),
    saveJobs: (jobs) => api.upsertRows('jobs.jsonl', jobs),
    listApplications: () => readRows<Application>('applications.jsonl'),
    saveApplication: (application) => api.upsertRows('applications.jsonl', [application]),
    async listDecks() {
      const ids = await api.listIds('practice/decks')
      const decks = await Promise.all(
        ids.map((id) =>
          getDeck(id).catch((error: unknown) => {
            // One broken deck file should not hide the others.
            console.warn(`[shortlist] Could not read practice/decks/${id}.json:`, error)
            return null
          }),
        ),
      )
      return decks.filter((deck) => deck !== null)
    },
    getDeck,
    listExercises: () => readJson<Exercise[]>('practice/exercises.json', []),
    listStories: () => readJson<StarStory[]>('practice/stories.json', []),
    getProgress: () => readJson<PracticeProgress>('practice/progress.json', emptyProgress()),
    saveProgress: (progress) => writeJson('practice/progress.json', progress),
    listCompanies: () => readJson<Company[]>('companies.json', []),
    getCoverLetter: async (applicationId) => api.readText(idFile('covers', applicationId)),
    saveCoverLetter: async (applicationId, markdown) => api.writeText(idFile('covers', applicationId), markdown),
  }
}
