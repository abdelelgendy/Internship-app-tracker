import { execFileSync } from 'node:child_process'
import { mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { createServer, request, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createServer as createViteServer, type ViteDevServer } from 'vite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import type { Job } from '../src/engine/types.ts'
import { LOCAL_API_HEADER } from '../src/data/localApi.ts'
import { createLocalApiRepo, fetchLocalStatus } from '../src/data/localApiRepo.ts'
import { StaleDataError } from '../src/data/repo.ts'
import { saveRows } from './lib/data-dir.ts'
import { localDataPlugin } from '../vite.config.ts'

interface Running {
  vite: ViteDevServer
  http: Server
  origin: string
}

async function start(dataDir: string, repoRoot: string): Promise<Running> {
  const vite = await createViteServer({
    configFile: false,
    root: repoRoot,
    logLevel: 'silent',
    server: { middlewareMode: true, hmr: false, ws: false },
    plugins: [localDataPlugin({ dataDir, repoRoot })],
  })
  const http = createServer(vite.middlewares)
  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve))
  return { vite, http, origin: `http://127.0.0.1:${(http.address() as AddressInfo).port}` }
}

async function stop({ vite, http }: Running) {
  await new Promise((resolve) => http.close(resolve))
  await vite.close()
}

/** A request with full control over headers, which fetch() does not allow for Host. */
function raw(origin: string, method: string, url: string, headers: Record<string, string> = {}, body?: string) {
  return new Promise<{ status: number; body: string; headers: Record<string, unknown> }>((resolve, reject) => {
    // Options instead of a URL string: a URL would normalize "%2e%2e" before it is sent.
    const { hostname, port } = new URL(origin)
    const options = { hostname, port, path: url, method, headers: { [LOCAL_API_HEADER]: '1', ...headers } }
    const req = request(options, (res) => {
      let text = ''
      res.on('data', (chunk) => (text += chunk))
      res.on('end', () => resolve({ status: res.statusCode ?? 0, body: text, headers: res.headers }))
    })
    req.on('error', reject)
    req.end(body)
  })
}

const job = (id: string, title = 'Junior Developer'): Job => ({
  id,
  source: 'manual',
  company: 'Example Co',
  title,
  location: 'Remote, Canada',
  workplace: 'remote',
  url: `https://boards.greenhouse.io/example-co/jobs/${id}`,
  postedAt: null,
  postedAtSource: 'unknown',
  discoveredAt: '2026-11-01T12:00:00.000Z',
  status: 'queued',
})

describe('local data API', () => {
  let root: string
  let dataDir: string
  let server: Running

  beforeAll(async () => {
    root = await mkdtemp(path.join(tmpdir(), 'shortlist-api-'))
    dataDir = path.join(root, 'data')
    server = await start(dataDir, root)
  })
  afterAll(async () => {
    await stop(server)
    await rm(root, { recursive: true, force: true })
  })

  it('creates the contract layout on the first status call, privately, and only once', async () => {
    const first = await fetchLocalStatus({ baseUrl: `${server.origin}/__local` })
    expect(first.dataDir).toBe(dataDir)
    expect(first.created).toEqual(
      expect.arrayContaining([
        'practice/',
        'practice/decks/',
        'covers/',
        '.gitignore',
        'jobs.jsonl',
        'applications.jsonl',
        'companies.json',
        'practice/exercises.json',
        'practice/stories.json',
        'practice/progress.json',
        'denylist.txt',
      ]),
    )
    expect(first.created).not.toContain('profile.json')
    expect((await stat(dataDir)).mode & 0o777).toBe(0o700)
    expect((await stat(path.join(dataDir, 'jobs.jsonl'))).mode & 0o777).toBe(0o600)
    expect(await readFile(path.join(dataDir, '.gitignore'), 'utf8')).toMatch(/^\*$/m)

    const second = await fetchLocalStatus({ baseUrl: `${server.origin}/__local` })
    expect(second.created).toEqual([])
  })

  it('round-trips every repo method through the data folder', async () => {
    const repo = createLocalApiRepo({ baseUrl: `${server.origin}/__local` })
    expect(await repo.getProfile()).toBeNull()
    expect(await repo.getProgress()).toEqual({ cards: {}, exercises: {}, streak: { current: 0, best: 0 } })

    await repo.saveJob(job('a'))
    await repo.saveJobs([job('b'), job('a', 'Junior Software Developer')])
    expect((await repo.listJobs()).map((row) => [row.id, row.title])).toEqual([
      ['a', 'Junior Software Developer'],
      ['b', 'Junior Developer'],
    ])

    const progress = { cards: {}, exercises: { e1: { status: 'doing' as const } }, streak: { current: 1, best: 1, lastDay: '2026-11-03' } }
    await repo.saveProgress(progress)
    expect(await repo.getProgress()).toEqual(progress)

    await repo.saveCoverLetter('app-1', '# Draft\n')
    expect(await repo.getCoverLetter('app-1')).toBe('# Draft\n')
    expect(await repo.getCoverLetter('app-2')).toBeNull()
    await expect(repo.getCoverLetter('../profile')).rejects.toThrow('Not a valid file id')

    await writeFile(path.join(dataDir, 'practice/decks/basics.json'), JSON.stringify({ id: 'basics', title: 'Basics', description: '', cards: [] }))
    await writeFile(path.join(dataDir, 'practice/decks/broken.json'), '{ not json')
    expect((await repo.listDecks()).map((deck) => deck.id)).toEqual(['basics'])
    expect(await repo.getDeck('missing')).toBeNull()

    expect(await readdir(dataDir)).not.toContainEqual(expect.stringMatching(/\.tmp$/))
  })

  it('keeps unreadable lines and treats the last copy of an id as current', async () => {
    const file = path.join(dataDir, 'applications.jsonl')
    await writeFile(file, '{"id":"x","status":"applied"}\nthis line is not JSON\n{"id":"x","status":"reviewing"}\n')
    const repo = createLocalApiRepo({ baseUrl: `${server.origin}/__local` })
    expect((await repo.listApplications()).map((row) => row.status)).toEqual(['reviewing'])

    await repo.saveApplication({ ...(await repo.listApplications())[0], status: 'rejected' })
    expect(await readFile(file, 'utf8')).toBe('{"id":"x","status":"rejected"}\nthis line is not JSON\n')
  })

  it('never loses a row when saves arrive at the same time', async () => {
    const repo = createLocalApiRepo({ baseUrl: `${server.origin}/__local` })
    await Promise.all(Array.from({ length: 25 }, (_, index) => repo.saveJob(job(`parallel-${index}`))))
    const ids = (await repo.listJobs()).map((row) => row.id)
    expect(ids.filter((id) => id.startsWith('parallel-'))).toHaveLength(25)
  })

  it('refuses to save over a row that a script changed after the app loaded it', async () => {
    const repo = createLocalApiRepo({ baseUrl: `${server.origin}/__local` })
    await repo.saveJob(job('stale-1'))
    const [loaded] = (await repo.listJobs()).filter((row) => row.id === 'stale-1')
    // A script (npm run score, npm run prefill) writes the row behind the app's back.
    await saveRows(dataDir, 'jobs.jsonl', [{ ...loaded, notes: 'written by a script' }])
    await expect(repo.saveJob({ ...loaded, status: 'shortlisted' })).rejects.toBeInstanceOf(StaleDataError)
    const [kept] = (await repo.listJobs()).filter((row) => row.id === 'stale-1')
    expect(kept).toMatchObject({ notes: 'written by a script', status: 'queued' })
    // Once the app has the current copy, the save goes through, and so does an undo of it.
    await repo.saveJob({ ...kept, status: 'shortlisted' })
    await repo.saveJob(kept)
    expect((await repo.listJobs()).find((row) => row.id === 'stale-1')).toMatchObject({ notes: 'written by a script', status: 'queued' })
  })

  it('refuses requests that do not come from this app on this computer', async () => {
    const { origin } = server
    expect((await raw(origin, 'GET', '/__local/status', { [LOCAL_API_HEADER]: '' })).status).toBe(403)
    expect((await raw(origin, 'GET', '/__local/status', { host: 'attacker.example:80' })).status).toBe(403)
    expect((await raw(origin, 'GET', '/__local/status', { origin: 'https://attacker.example' })).status).toBe(403)
    // Vite answers preflights itself; what matters is that it never approves a foreign origin.
    const preflight = await raw(origin, 'OPTIONS', '/__local/files/profile.json', {
      origin: 'https://attacker.example',
      'access-control-request-method': 'PUT',
      'access-control-request-headers': LOCAL_API_HEADER,
    })
    expect(preflight.headers['access-control-allow-origin']).toBeUndefined()
    expect((await raw(origin, 'GET', '/__local/status', { origin: origin.replace('127.0.0.1', 'localhost') })).status).toBe(403)
    expect((await raw(origin, 'GET', '/__local/status', { origin })).status).toBe(200)
  })

  it('serves only contract files, inside the data folder', async () => {
    const { origin } = server
    for (const url of [
      '/__local/files/..%2F..%2Fetc%2Fpasswd',
      '/__local/files/%2e%2e/secret.json',
      '/__local/files/practice/decks/..%5Cprofile.json',
      '/__local/files/denylist.txt',
      '/__local/files/.gitignore',
      '/__local/files/practice/decks/a.b.json',
    ]) {
      expect((await raw(origin, 'GET', url)).status, url).toBe(400)
    }
    expect((await raw(origin, 'GET', '/__local/list/practice')).status).toBe(404)
    // Object.prototype names are not contract files or folders.
    for (const name of ['constructor', 'valueOf', 'toString', 'hasOwnProperty', '__proto__']) {
      expect((await raw(origin, 'PUT', `/__local/files/${name}`, {}, '{"anything":"goes"}')).status, name).toBe(400)
      expect((await raw(origin, 'GET', `/__local/list/${name}`)).status, name).toBe(404)
    }
    expect((await readdir(dataDir)).filter((name) => ['constructor', 'valueOf', 'toString'].includes(name))).toEqual([])
    expect((await raw(origin, 'GET', '/__local/files/profile.json')).status).toBe(404)
    expect((await raw(origin, 'GET', '/__local/files/profile.json?optional')).status).toBe(204)
  })

  it('rejects bodies that are too big or would corrupt a file', async () => {
    const { origin } = server
    const huge = 'x'.repeat(10 * 1024 * 1024 + 1)
    expect((await raw(origin, 'PUT', '/__local/files/covers/big.md', {}, huge)).status).toBe(413)
    expect((await raw(origin, 'PUT', '/__local/files/profile.json', {}, '{ nope')).status).toBe(400)
    expect((await raw(origin, 'PUT', '/__local/files/companies.json', {}, '{}')).status).toBe(400)
    expect((await raw(origin, 'PUT', '/__local/files/jobs.jsonl', {}, '')).status).toBe(400)
    expect((await raw(origin, 'POST', '/__local/rows/jobs.jsonl', {}, '[{"title":"no id"}]')).status).toBe(400)
    expect((await raw(origin, 'POST', '/__local/rows/companies.json', {}, '[]')).status).toBe(400)
  })

  it('is left out of production builds and of vite preview', () => {
    const plugin = localDataPlugin({ dataDir, repoRoot: root })
    expect(plugin.apply).toBe('serve')
    expect(plugin).not.toHaveProperty('configurePreviewServer')
  })
})

describe('data folder inside a git repo', () => {
  it('refuses a folder that git would commit', async () => {
    const repoRoot = await mkdtemp(path.join(tmpdir(), 'shortlist-git-'))
    try {
      execFileSync('git', ['init', '-q'], { cwd: repoRoot })
      await writeFile(path.join(repoRoot, '.gitignore'), '.private/\n')

      const unsafe = await start(path.join(repoRoot, 'my-data'), repoRoot)
      const refused = await raw(unsafe.origin, 'GET', '/__local/status')
      await stop(unsafe)
      expect(refused.status).toBe(409)
      expect(JSON.parse(refused.body).error).toContain('would be committed by git')
      await expect(stat(path.join(repoRoot, 'my-data'))).rejects.toThrow()

      const safe = await start(path.join(repoRoot, '.private'), repoRoot)
      const allowed = await raw(safe.origin, 'GET', '/__local/status')
      await stop(safe)
      expect(allowed.status).toBe(200)
    } finally {
      await rm(repoRoot, { recursive: true, force: true })
    }
  })
})
