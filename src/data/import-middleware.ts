/**
 * The import preview for `npm run dev`: reads a job-hunter folder (read-only), compares it with
 * the data folder, and answers with the plan from src/jobhunter/plan.ts, the same planner the
 * import-jobhunter script uses. It never writes: the Import page applies a plan through the
 * local data API, so every write goes through the same atomic, one-at-a-time saves as the rest
 * of the app.
 *
 *   GET /__local/import/preview?folder=<path>   ImportPreview; a relative path starts at the repo
 *
 * File access comes from vite.config.ts because code under src/ is type-checked without Node's
 * types. It registers this handler before the main local data handler, which answers
 * everything else under /__local.
 */
import type { ExistingData, SourceReader } from '../jobhunter/map.ts'
import { buildImport, type ImportResult } from '../jobhunter/plan.ts'
import { localRequestRefusal, type LocalRequestInfo } from './localApi.ts'

export const IMPORT_PREVIEW_PATH = 'import/preview'

export interface ImportPreview extends ImportResult {
  /** The folder that was read, as an absolute path. */
  folder: string
}

export interface ImportHandlerOptions {
  /** Turns the folder the user typed into an absolute path. */
  resolveFolder(asked: string): string
  /** Read-only access to the chosen folder. */
  readerFor(folder: string): SourceReader
  /** What Shortlist already holds, read from the data folder. */
  loadExisting(): Promise<ExistingData>
  now?: () => Date
}

/** The parts of Node's request and response the handler uses. */
export interface ImportRequest extends LocalRequestInfo {
  method?: string
  url?: string
}

export interface ImportResponse {
  statusCode: number
  setHeader(name: string, value: string): unknown
  end(body: string): unknown
}

class HttpError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
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

    const folder = options.resolveFolder(asked)
    const result = await buildImport(options.readerFor(folder), await options.loadExisting(), now())
    if (result === null) {
      throw new HttpError(404, `No job-hunter data in ${folder}. Point at the job-hunter folder (it has data/ and copilot-data/) or at copilot-data itself.`)
    }
    const preview: ImportPreview = { folder, ...result }
    send(res, 200, preview)
  }

  return (req: ImportRequest, res: ImportResponse) => {
    handle(req, res).catch((error: unknown) => {
      send(res, error instanceof HttpError ? error.status : 500, { error: error instanceof Error ? error.message : String(error) })
    })
  }
}
