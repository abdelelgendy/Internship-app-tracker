/// <reference types="vitest/config" />
import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir, open, readdir, readFile, realpath, rename, rm, writeFile } from 'node:fs/promises'
import type { IncomingMessage, ServerResponse } from 'node:http'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react-swc'
import { defineConfig, loadEnv, type Plugin } from 'vite'
import { rowsProblem, upsertJsonl } from './src/data/jsonl.ts'
import { contentProblem, dataFileFormat, ID_FOLDERS, INITIAL_FILES, INITIAL_FOLDERS, isFileId } from './src/data/layout.ts'
import { LOCAL_API_BASE, LOCAL_API_HEADER, type LocalStatus } from './src/data/localApi.ts'

const repoRoot = fileURLToPath(new URL('.', import.meta.url))

export default defineConfig(({ mode }) => {
  // COPILOT_DATA_DIR can come from the shell or from .env.local; relative paths start at the repo.
  const dataDir = path.resolve(repoRoot, loadEnv(mode, repoRoot, 'COPILOT_').COPILOT_DATA_DIR || '.private')
  return {
    plugins: [react(), tailwindcss(), ...(process.env.VITEST ? [] : [localDataPlugin({ dataDir, repoRoot })])],
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
const LOOPBACK_ADDRESSES = new Set(['127.0.0.1', '::1', '::ffff:127.0.0.1'])
const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])
const run = promisify(execFile)

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

/**
 * Answers only this computer, under its own host name, from its own pages. The loopback check
 * stops other machines when the server runs with --host; the Host check stops DNS rebinding
 * (Vite checks Host too, before this runs); the Origin check and the custom header stop other
 * websites open in the same browser, including other dev servers on localhost, which Vite's
 * default CORS policy lets through a preflight.
 */
function refusal(req: IncomingMessage): string | null {
  if (!LOOPBACK_ADDRESSES.has(req.socket.remoteAddress ?? '')) return 'The local data API only answers this computer.'
  const host = req.headers.host ?? ''
  if (!LOOPBACK_HOSTS.has(host.replace(/:\d+$/, ''))) return 'The local data API only answers localhost.'
  const origin = req.headers.origin
  if (origin && origin !== 'null') {
    try {
      if (new URL(origin).host !== host) return 'Cross-origin requests are refused.'
    } catch {
      return 'Cross-origin requests are refused.'
    }
  }
  if (req.headers[LOCAL_API_HEADER] !== '1') return `Requests need the ${LOCAL_API_HEADER} header.`
  return null
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

/** Writes beside the target and renames over it, so a reader never sees half a file. */
async function writeAtomic(file: string, text: string) {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 })
  const temp = `${file}.${process.pid}.${randomUUID()}.tmp`
  try {
    const handle = await open(temp, 'w', 0o600)
    try {
      await handle.writeFile(text, 'utf8')
      await handle.sync()
    } finally {
      await handle.close()
    }
    await rename(temp, file)
  } catch (error) {
    await rm(temp, { force: true })
    throw error
  }
}

/** Creates the contract's folders and empty files without touching anything that exists. */
async function createLayout(dataDir: string): Promise<string[]> {
  const created: string[] = []
  await mkdir(dataDir, { recursive: true, mode: 0o700 })
  for (const folder of INITIAL_FOLDERS) {
    if (await mkdir(path.join(dataDir, folder), { recursive: true, mode: 0o700 })) created.push(`${folder}/`)
  }
  for (const [file, text] of Object.entries(INITIAL_FILES)) {
    try {
      await writeFile(path.join(dataDir, file), text, { flag: 'wx', mode: 0o600 })
      created.push(file)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
  }
  return created
}

/** Refuses a data folder inside the repo that git would commit. Outside the repo, or without git, there is nothing to check. */
async function gitWouldCommit(dataDir: string, root: string): Promise<boolean> {
  const relative = path.relative(root, dataDir)
  if (relative.startsWith('..') || path.isAbsolute(relative)) return false
  if (relative === '') return true
  try {
    const { stdout } = await run('git', ['ls-files', '--', relative], { cwd: root })
    if (stdout.trim() !== '') return true
    await run('git', ['check-ignore', '-q', '--', `${relative.split(path.sep).join('/')}/`], { cwd: root })
    return false
  } catch (error) {
    return (error as { code?: unknown }).code === 1
  }
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

/** Resolves a contract file inside the data folder, following symlinks to be sure it stays there. */
async function inside(dataDir: string, file: string): Promise<string> {
  const target = path.resolve(dataDir, file)
  assertWithin(await realpath(dataDir), await realpath(path.dirname(target)))
  return target
}

function createLocalDataHandler({ dataDir, repoRoot: root }: { dataDir: string; repoRoot: string }) {
  let guard: Promise<boolean> | undefined
  const locks = new Map<string, Promise<unknown>>()

  /** Runs writes to the same file one after another, so concurrent upserts never lose a row. */
  function withLock<T>(key: string, task: () => Promise<T>): Promise<T> {
    const result = (locks.get(key) ?? Promise.resolve()).then(task, task)
    const settled = result.catch(() => {})
    locks.set(key, settled)
    void settled.then(() => {
      if (locks.get(key) === settled) locks.delete(key)
    })
    return result
  }

  async function handle(req: IncomingMessage, res: ServerResponse) {
    const refused = refusal(req)
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
      const extension = ID_FOLDERS[target as keyof typeof ID_FOLDERS]
      if (!extension) throw new HttpError(404, `No such folder: ${target}`)
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
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') throw new HttpError(404, `${target} does not exist yet.`)
        throw error
      }
    }

    if (route === 'files' && format && method === 'PUT') {
      const text = await readBody(req)
      const problem = contentProblem(format, text)
      if (problem) throw new HttpError(400, `${target}: ${problem}.`)
      const file = await inside(dataDir, target)
      await withLock(file, () => writeAtomic(file, text))
      return send(res, 200, { saved: target })
    }

    if (route === 'rows' && format === 'jsonl' && method === 'POST') {
      let rows: unknown
      try {
        rows = JSON.parse(await readBody(req))
      } catch (error) {
        if (error instanceof HttpError) throw error
        throw new HttpError(400, 'Body is not valid JSON.')
      }
      const problem = rowsProblem(rows)
      if (problem) throw new HttpError(400, `${target}: ${problem}.`)
      const file = await inside(dataDir, target)
      await withLock(file, async () => {
        const existing = await readFile(file, 'utf8').catch(() => '')
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
      server.middlewares.use(LOCAL_API_BASE, createLocalDataHandler(options))
    },
  }
}
