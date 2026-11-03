/**
 * The import preview for `npm run dev`: reads a job-hunter folder (read-only), compares it with
 * the data folder, and answers with the plan from scripts/lib/jobhunter-map.ts. It never writes:
 * the Import page applies a plan through the local data API, so every write goes through the
 * same atomic, one-at-a-time saves as the rest of the app.
 *
 *   GET /__local/import/preview?folder=<path>   { folder, plan }; a relative path starts at the repo
 *
 * File access is passed in (node:fs/promises and node:path in vite.config.ts) because code under
 * src/ is type-checked without Node's types. Register it before the main local data handler,
 * which answers everything else under /__local:
 *
 *   server.middlewares.use(`${LOCAL_API_BASE}/import`, createImportHandler({ ...options, fs: { readFile, readdir }, path }))
 */
import { planImport, readJobHunterSource, type ExistingData, type ImportPlan, type SourceReader } from '../../scripts/lib/jobhunter-map.ts'
import type { Application, Company, Exercise, Job, PracticeDeck, Profile, StarStory } from '../engine/types.ts'
import { readJsonl } from './jsonl.ts'
import { ID_FOLDERS, isFileId } from './layout.ts'
import { LOCAL_API_HEADER } from './localApi.ts'

export const IMPORT_PREVIEW_PATH = 'import/preview'

export interface ImportPreview {
  /** The folder that was read, as an absolute path. */
  folder: string
  plan: ImportPlan
}

export interface ImportFs {
  readFile(file: string, encoding: 'utf8'): Promise<string>
  readdir(folder: string): Promise<string[]>
}

export interface ImportPath {
  resolve(...parts: string[]): string
  join(...parts: string[]): string
}

export interface ImportHandlerOptions {
  dataDir: string
  /** Relative folders start here. */
  repoRoot: string
  fs: ImportFs
  path: ImportPath
  now?: () => Date
}

/** The parts of Node's request and response the handler uses. */
export interface ImportRequest {
  method?: string
  url?: string
  headers: Record<string, string | string[] | undefined>
  socket: { remoteAddress?: string }
}

export interface ImportResponse {
  statusCode: number
  setHeader(name: string, value: string): unknown
  end(body: string): unknown
}

const MAX_FILE_BYTES = 10 * 1024 * 1024
const LOOPBACK_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

class HttpError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

/**
 * The same rule as the main local data API: only this computer, under a localhost name, from the
 * dev server's own pages, with the custom header that other websites cannot send without asking.
 */
export function localRequestRefusal(req: ImportRequest): string | null {
  if (!LOOPBACK_ADDRESSES.has(req.socket.remoteAddress ?? '')) return 'The local data API only answers this computer.'
  const host = typeof req.headers.host === 'string' ? req.headers.host : ''
  if (!LOOPBACK_HOSTS.has(host.replace(/:\d+$/, ''))) return 'The local data API only answers localhost.'
  const origin = req.headers.origin
  if (typeof origin === 'string' && origin !== 'null') {
    try {
      if (new URL(origin).host !== host) return 'Cross-origin requests are refused.'
    } catch {
      return 'Cross-origin requests are refused.'
    }
  }
  if (req.headers[LOCAL_API_HEADER] !== '1') return `Requests need the ${LOCAL_API_HEADER} header.`
  return null
}

function errorCode(error: unknown): unknown {
  return typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined
}

/** File access under one folder that answers null for anything missing, and refuses huge files. */
function readerAt(root: string, { fs, path }: Pick<ImportHandlerOptions, 'fs' | 'path'>): SourceReader {
  return {
    async list(folder) {
      try {
        return await fs.readdir(path.join(root, folder))
      } catch (error) {
        if (['ENOENT', 'ENOTDIR'].includes(errorCode(error) as string)) return null
        throw error
      }
    },
    async read(file) {
      let text: string
      try {
        text = await fs.readFile(path.join(root, file), 'utf8')
      } catch (error) {
        if (['ENOENT', 'EISDIR', 'ENOTDIR'].includes(errorCode(error) as string)) return null
        throw error
      }
      if (text.length > MAX_FILE_BYTES) throw new HttpError(413, `${file} is larger than 10 MB, so it was not read.`)
      return text
    },
  }
}

/** What Shortlist already holds, read from the data folder. Missing or unreadable files count as empty. */
async function readExisting(reader: SourceReader): Promise<ExistingData> {
  const json = async <T>(file: string, fallback: T): Promise<T> => {
    const text = await reader.read(file)
    if (text === null) return fallback
    try {
      return JSON.parse(text) as T
    } catch {
      return fallback
    }
  }
  const rows = async <T extends { id: string }>(file: string) => readJsonl<T>((await reader.read(file)) ?? '').rows
  const deckIds = ((await reader.list('practice/decks')) ?? [])
    .filter((name) => name.endsWith(ID_FOLDERS['practice/decks']))
    .map((name) => name.slice(0, -ID_FOLDERS['practice/decks'].length))
    .filter(isFileId)
  const [jobs, applications, profile, decks, exercises, stories, companies] = await Promise.all([
    rows<Job>('jobs.jsonl'),
    rows<Application>('applications.jsonl'),
    json<Profile | null>('profile.json', null),
    Promise.all(deckIds.map((id) => json<PracticeDeck | null>(`practice/decks/${id}.json`, null))),
    json<Exercise[]>('practice/exercises.json', []),
    json<StarStory[]>('practice/stories.json', []),
    json<Company[]>('companies.json', []),
  ])
  return { jobs, applications, profile, decks: decks.filter((deck) => deck !== null), exercises, stories, companies }
}

function send(res: ImportResponse, status: number, body: unknown) {
  res.statusCode = status
  res.setHeader('content-type', 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.setHeader('x-content-type-options', 'nosniff')
  res.end(JSON.stringify(body))
}

export function createImportHandler(options: ImportHandlerOptions) {
  const now = options.now ?? (() => new Date())

  async function handle(req: ImportRequest, res: ImportResponse) {
    const refused = localRequestRefusal(req)
    if (refused) throw new HttpError(403, refused)
    const [pathname, query = ''] = (req.url ?? '/').split('?')
    if (pathname.replace(/^\/+|\/+$/g, '') !== 'preview' || req.method !== 'GET') {
      throw new HttpError(404, `No ${req.method ?? 'GET'} /__local/import${pathname}. The import API has GET /__local/${IMPORT_PREVIEW_PATH}.`)
    }
    const asked = new URLSearchParams(query).get('folder')?.trim()
    if (!asked) throw new HttpError(400, 'Say which folder to read: the job-hunter folder or its copilot-data folder.')

    const folder = options.path.resolve(options.repoRoot, asked)
    const source = await readJobHunterSource(readerAt(folder, options))
    if (source === null) {
      throw new HttpError(404, `No job-hunter data in ${folder}. Point at the job-hunter folder (it has data/ and copilot-data/) or at copilot-data itself.`)
    }
    const existing = await readExisting(readerAt(options.dataDir, options))
    const preview: ImportPreview = { folder, plan: planImport(source, existing, { now: now() }) }
    send(res, 200, preview)
  }

  return (req: ImportRequest, res: ImportResponse) => {
    handle(req, res).catch((error: unknown) => {
      send(res, error instanceof HttpError ? error.status : 500, { error: error instanceof Error ? error.message : String(error) })
    })
  }
}
