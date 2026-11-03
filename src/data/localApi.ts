/**
 * The protocol between the dev-server middleware (vite.config.ts) and the local repo.
 *
 *   GET  /__local/status              { dataDir, created }; creates the layout on first call
 *   GET  /__local/files/<file>        raw file text, or 404
 *   PUT  /__local/files/<file>        atomic replace (JSON and Markdown files)
 *   POST /__local/rows/<file>.jsonl   upsert a JSON array of rows by id
 *   GET  /__local/list/<folder>       ids of the files in practice/decks or covers
 *
 * Every request must carry LOCAL_API_HEADER and, when the browser sends an Origin, come from
 * the dev server's own origin. Another website open in the same browser can neither send the
 * header without a CORS preflight nor pass the Origin check, so it cannot read or write the
 * data folder.
 */
export const LOCAL_API_BASE = '/__local'
export const LOCAL_API_HEADER = 'x-shortlist-local'

export interface LocalStatus {
  dataDir: string
  /** Contract files and folders created by this call, empty after the first run. */
  created: string[]
}

export class LocalApiError extends Error {
  name = 'LocalApiError'
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

/** The middleware answers errors as { error: message }. */
export async function errorFrom(response: Response): Promise<LocalApiError> {
  let message = `The local data API answered ${response.status}.`
  try {
    const body: unknown = await response.json()
    if (body && typeof body === 'object' && typeof (body as { error?: unknown }).error === 'string') {
      message = (body as { error: string }).error
    }
  } catch {
    // Not JSON: keep the status message.
  }
  return new LocalApiError(response.status, message)
}
