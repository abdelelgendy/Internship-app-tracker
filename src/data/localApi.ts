/**
 * The protocol between the dev-server middleware (vite.config.ts) and the local repo.
 *
 *   GET  /__local/status              { dataDir, created }; creates the layout on first call
 *   GET  /__local/files/<file>        raw file text, or 404 (204 with ?optional)
 *   PUT  /__local/files/<file>        atomic replace (JSON and Markdown files)
 *   POST /__local/rows/<file>.jsonl   upsert rows by id: a JSON array, or { rows, base } where
 *                                     base maps ids to the fingerprint the app read; 412 when a
 *                                     row changed since (a script or another tab saved it)
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

/** Precondition Failed: the save was built on a row that has changed since it was read. */
export const STALE_ROWS_STATUS = 412
export const STALE_ROWS_MESSAGE =
  'This changed outside the app since the page loaded, for example by a script. Shortlist reloaded it; make your change again.'

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

/** The parts of a Node request the refusal check reads, so this file needs no Node types. */
export interface LocalRequestInfo {
  headers: Record<string, string | string[] | undefined>
  socket: { remoteAddress?: string }
}

const LOOPBACK_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

/**
 * Why a dev-server request is refused, or null. Every /__local handler (data, import, draft) uses
 * it. The loopback check stops other machines when the server runs with --host; the Host check
 * stops DNS rebinding; the Origin check and the custom header stop other websites open in the
 * same browser, including other dev servers on localhost, which Vite's CORS policy lets through
 * a preflight.
 */
export function localRequestRefusal(req: LocalRequestInfo, service = 'The local data API'): string | null {
  if (!LOOPBACK_ADDRESSES.has(req.socket.remoteAddress ?? '')) return `${service} only answers this computer.`
  const host = typeof req.headers.host === 'string' ? req.headers.host : ''
  if (!LOOPBACK_HOSTS.has(host.replace(/:\d+$/, ''))) return `${service} only answers localhost.`
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
