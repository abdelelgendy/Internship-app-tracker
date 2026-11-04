/// <reference types="vitest/config" />
import { readdir, readFile, realpath } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react-swc'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import { createLayout, gitWouldCommit, loadData, withFileLock, writeAtomic } from './scripts/lib/data-dir.ts'
import { existingFrom } from './scripts/lib/jobhunter-import.ts'
import { aiDraftPlugin } from './src/data/ai-middleware.ts'
import { createImportHandler } from './src/data/import-middleware.ts'
import { changedSince, rowsProblem, upsertJsonl } from './src/data/jsonl.ts'
import { contentProblem, dataFileFormat, ID_FOLDERS, isFileId, isIdFolder } from './src/data/layout.ts'
import { LOCAL_API_BASE, localRequestRefusal, STALE_ROWS_MESSAGE, STALE_ROWS_STATUS, type LocalStatus } from './src/data/localApi.ts'
import { folderReader } from './src/jobhunter/plan.ts'

const repoRoot = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig(({ mode }) => {
  // COPILOT_DATA_DIR can come from the shell or from .env.local; relative paths start at the repo.
  const env = loadEnv(mode, repoRoot, ['COPILOT_', 'ANTHROPIC_'])
  const dataDir = path.resolve(repoRoot, env.COPILOT_DATA_DIR || '.private')
  // Both plugins mount under /__local; the draft API goes first so the data API's catch-all doesn't answer it.
  const devApis = [aiDraftPlugin({ apiKey: env.ANTHROPIC_API_KEY }), localDataPlugin({ dataDir, repoRoot })]
  return {
    plugins: [react(), tailwindcss(), ...(process.env.VITEST ? [] : devApis)],
    resolve: {
      alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
    },
    test: {
      projects: [
        {
          extends: true,
          test: {
            name: 'dom',
            environment: 'jsdom',
            include: ['src/**/*.test.tsx'],
            setupFiles: ['./src/test/setup.ts'],
          },
        },
        {
          extends: true,
          test: {
            name: 'node',
            environment: 'node',
            include: ['src/**/*.test.ts', 'scripts/**/*.test.ts', 'server/**/*.test.ts'],
          },
        },
      ],
    },
  }
})

// ---------- Local data API: dev server only (see src/data/localApi.ts for the protocol) ----------

const MAX_BODY_BYTES = 10 * 1024 * 1024

class HttpError extends Error {
  readonly status: number

  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

function send(res: ServerResponse, status: number, body: unknown) {
  const text = typeof body === 'string'
  res.statusCode = status
  res.setHeader('content-type', text ? 'text/plain; charset=utf-8' : 'application/json; charset=utf-8')
  res.setHeader('cache-control', 'no-store')
  res.setHeader('x-content-type-options', 'nosniff')
  res.end(text ? body : JSON.stringify(body))
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    if (Number(req.headers['content-length'] ?? 0) > MAX_BODY_BYTES) {
      reject(new HttpError(413, `Bodies are capped at ${MAX_BODY_BYTES} bytes.`))
      req.resume()
      return
    }
    const chunks: Buffer[] = []
    let size = 0
    req.on('data', (chunk: Buffer) => {
      size += chunk.length
      if (size <= MAX_BODY_BYTES) {
        chunks.push(chunk)
        return
      }
      req.removeAllListeners('data')
      req.resume()
      reject(new HttpError(413, `Bodies are capped at ${MAX_BODY_BYTES} bytes.`))
    })
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

/**
 * Splits /<route>/<a>/<b> into decoded segments, refusing anything that could leave the folder.
 * Parsed by hand: URL() would quietly resolve an encoded "%2e%2e" instead of rejecting it.
 */
function segments(url: string): string[] {
  const parts = url.split('?')[0].split('/').filter(Boolean)
  return parts.map((part) => {
    let decoded: string
    try {
      decoded = decodeURIComponent(part)
    } catch {
      throw new HttpError(400, 'Malformed path.')
    }
    if (decoded === '.' || decoded === '..' || /[/\\\0]/.test(decoded)) throw new HttpError(400, 'Paths may not leave the data folder.')
    return decoded
  })
}

function assertWithin(root: string, real: string) {
  if (real !== root && !real.startsWith(root + path.sep)) throw new HttpError(400, 'Paths may not leave the data folder.')
}

/** A rows body is a plain array, or { rows, base } with the fingerprint of each row as the app read it. */
function rowsRequest(body: unknown): { rows: unknown; base: Record<string, string> } {
  if (Array.isArray(body) || body === null || typeof body !== 'object') return { rows: body, base: {} }
  const { rows, base } = body as { rows?: unknown; base?: unknown }
  const valid = base !== null && typeof base === 'object' && !Array.isArray(base) && Object.values(base).every((value) => typeof value === 'string')
  if (base !== undefined && !valid) throw new HttpError(400, 'base must map row ids to fingerprints.')
  return { rows, base: (base as Record<string, string> | undefined) ?? {} }
}

/** Resolves a contract file inside the data folder, following symlinks to be sure it stays there. */
async function inside(dataDir: string, file: string): Promise<string> {
  const target = path.resolve(dataDir, file)
  assertWithin(await realpath(dataDir), await realpath(path.dirname(target)))
  return target
}

function createLocalDataHandler({ dataDir, repoRoot: root }: { dataDir: string; repoRoot: string }) {
  let guard: Promise<boolean> | undefined

  async function handle(req: IncomingMessage, res: ServerResponse) {
    const refused = localRequestRefusal(req)
    if (refused) throw new HttpError(403, refused)
    if (await (guard ??= gitWouldCommit(dataDir, root))) {
      throw new HttpError(409, `The data folder ${dataDir} would be committed by git. Add it to .gitignore or set COPILOT_DATA_DIR to a folder outside the repo.`)
    }

    const [route, ...rest] = segments(req.url ?? '/')
    const target = rest.join('/')
    const method = req.method ?? 'GET'
    // Cheap enough to run every time, and it repairs the layout if a folder was deleted meanwhile.
    const created = await createLayout(dataDir)

    if (route === 'status' && rest.length === 0 && method === 'GET') {
      const status: LocalStatus = { dataDir, created }
      return send(res, 200, status)
    }

    if (route === 'list' && method === 'GET') {
      if (!isIdFolder(target)) throw new HttpError(404, `No such folder: ${target}`)
      const extension = ID_FOLDERS[target]
      const folder = await realpath(path.join(dataDir, target))
      assertWithin(await realpath(dataDir), folder)
      const ids = (await readdir(folder)).filter((name) => name.endsWith(extension)).map((name) => name.slice(0, -extension.length))
      return send(res, 200, ids.filter(isFileId).sort())
    }

    const format = dataFileFormat(target)
    if (route === 'files' && format && method === 'GET') {
      const file = await inside(dataDir, target)
      try {
        return send(res, 200, await readFile(file, 'utf8'))
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
        // The app reads with ?optional, which answers 204 so a browser console doesn't log every file not written yet.
        if (new URLSearchParams((req.url ?? '').split('?')[1] ?? '').has('optional')) return send(res, 204, '')
        throw new HttpError(404, `${target} does not exist yet.`)
      }
    }

    if (route === 'files' && format && method === 'PUT') {
      const text = await readBody(req)
      const problem = contentProblem(format, text)
      if (problem) throw new HttpError(400, `${target}: ${problem}.`)
      const file = await inside(dataDir, target)
      // The same lock file the scripts take, so a script and the app never interleave writes.
      await withFileLock(file, () => writeAtomic(file, text))
      return send(res, 200, { saved: target })
    }

    if (route === 'rows' && format === 'jsonl' && method === 'POST') {
      let body: unknown
      try {
        body = JSON.parse(await readBody(req))
      } catch (error) {
        if (error instanceof HttpError) throw error
        throw new HttpError(400, 'Body is not valid JSON.')
      }
      const { rows, base } = rowsRequest(body)
      const problem = rowsProblem(rows)
      if (problem) throw new HttpError(400, `${target}: ${problem}.`)
      const file = await inside(dataDir, target)
      await withFileLock(file, async () => {
        const existing = await readFile(file, 'utf8').catch(() => '')
        // A row a script (or another tab) changed after the app loaded it is not saved over.
        const stale = changedSince(existing, base)
        if (stale.length > 0) throw new HttpError(STALE_ROWS_STATUS, STALE_ROWS_MESSAGE)
        await writeAtomic(file, upsertJsonl(existing, rows as { id: string }[]))
      })
      return send(res, 200, { saved: (rows as unknown[]).length })
    }

    throw new HttpError(route === 'files' || route === 'rows' ? 400 : 404, `No ${method} ${LOCAL_API_BASE}/${[route, target].filter(Boolean).join('/')}.`)
  }

  return (req: IncomingMessage, res: ServerResponse) => {
    handle(req, res).catch((error: unknown) => {
      const status = error instanceof HttpError ? error.status : 500
      send(res, status, { error: error instanceof Error ? error.message : String(error) })
    })
  }
}

/**
 * Serves the data folder to the app during `npm run dev`. `apply: 'serve'` keeps it out of
 * `vite build`, and it registers no preview hook, so `vite preview` runs the public demo.
 */
export function localDataPlugin(options: { dataDir: string; repoRoot: string }): Plugin {
  return {
    name: 'shortlist-local-data',
    apply: 'serve',
    configureServer(server) {
      server.config.logger.info(`  Shortlist data folder: ${options.dataDir}`)
      // The import preview answers /__local/import/*, so it is mounted before the catch-all data API.
      server.middlewares.use(
        `${LOCAL_API_BASE}/import`,
        createImportHandler({
          resolveFolder: (asked) => path.resolve(options.repoRoot, asked),
          readerFor: (folder) => folderReader(folder, { readFile, readdir, join: path.join }),
          loadExisting: async () => existingFrom(await loadData(options.dataDir)),
        }),
      )
      server.middlewares.use(LOCAL_API_BASE, createLocalDataHandler(options))
    },
  }
}
