import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { createServer as createViteServer, type Plugin, type ViteDevServer } from 'vite'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createImportHandler, type ImportPreview } from '../src/data/import-middleware.ts'
import { LOCAL_API_HEADER } from '../src/data/localApi.ts'
import { applyImportPlan } from '../src/features/import/applyImport.ts'
import { DEMO_JOBHUNTER_SOURCE } from '../src/features/import/demoJobHunter.ts'
import { localDataPlugin } from '../vite.config.ts'
import { planHasChanges } from './lib/jobhunter-map.ts'

let base: string
let dataDir: string
let jobHunter: string
let vite: ViteDevServer
let http: Server
let origin: string

/** The same registration vite.config.ts needs: the import handler first, then the main local API. */
function importPlugin(): Plugin {
  return {
    name: 'test-import',
    configureServer(server) {
      server.middlewares.use('/__local/import', createImportHandler({ dataDir, repoRoot: base, fs: { readFile, readdir }, path }))
    },
  }
}

async function writeSource(root: string) {
  const files = [
    DEMO_JOBHUNTER_SOURCE.queue,
    DEMO_JOBHUNTER_SOURCE.applications,
    DEMO_JOBHUNTER_SOURCE.companies,
    ...DEMO_JOBHUNTER_SOURCE.decks,
    ...DEMO_JOBHUNTER_SOURCE.exercises,
    ...DEMO_JOBHUNTER_SOURCE.stories,
  ]
  for (const file of files) {
    if (!file) continue
    await mkdir(path.dirname(path.join(root, file.path)), { recursive: true })
    await writeFile(path.join(root, file.path), file.text)
  }
}

const preview = (folder: string, headers: Record<string, string> = { [LOCAL_API_HEADER]: '1' }) =>
  fetch(`${origin}/__local/import/preview?folder=${encodeURIComponent(folder)}`, { headers })

beforeAll(async () => {
  base = await mkdtemp(path.join(tmpdir(), 'shortlist-import-'))
  dataDir = path.join(base, 'data')
  jobHunter = path.join(base, 'job-hunter')
  await writeSource(jobHunter)
  vite = await createViteServer({
    configFile: false,
    root: base,
    logLevel: 'silent',
    server: { middlewareMode: true, hmr: false, ws: false },
    plugins: [importPlugin(), localDataPlugin({ dataDir, repoRoot: base })],
  })
  http = createServer(vite.middlewares)
  await new Promise<void>((resolve) => http.listen(0, '127.0.0.1', resolve))
  origin = `http://127.0.0.1:${(http.address() as AddressInfo).port}`
})

afterAll(async () => {
  await new Promise((resolve) => http.close(resolve))
  await vite.close()
  await rm(base, { recursive: true, force: true })
})

describe('import preview endpoint', () => {
  it('refuses requests without the local header', async () => {
    const response = await preview(jobHunter, {})
    expect(response.status).toBe(403)
  })

  it('asks for a folder, and says when a folder holds no job-hunter data', async () => {
    expect((await fetch(`${origin}/__local/import/preview`, { headers: { [LOCAL_API_HEADER]: '1' } })).status).toBe(400)
    const missing = await preview(path.join(base, 'nowhere'))
    expect(missing.status).toBe(404)
    expect(((await missing.json()) as { error: string }).error).toContain('No job-hunter data')
  })

  it('previews without writing, resolves relative folders from the repo, and applies through the local API', async () => {
    const response = await preview('job-hunter')
    expect(response.status).toBe(200)
    const { folder, plan } = (await response.json()) as ImportPreview
    expect(folder).toBe(jobHunter)
    expect(plan.jobs.add).toHaveLength(7)
    expect(plan.applications.add).toHaveLength(5)
    expect(plan.setAside).toHaveLength(2)
    expect(await readFile(path.join(dataDir, 'jobs.jsonl'), 'utf8').catch(() => '')).toBe('')

    // Opening the data folder once creates its layout, as the app does at startup.
    await fetch(`${origin}/__local/status`, { headers: { [LOCAL_API_HEADER]: '1' } })
    const written = await applyImportPlan(plan, { profile: false }, { baseUrl: `${origin}/__local` })
    expect(written).toEqual(['2 watchlist companies', 'the Notes from the old tool deck', '1 exercise', '1 story', '7 jobs', '5 applications'])

    const jobs = (await readFile(path.join(dataDir, 'jobs.jsonl'), 'utf8')).trim().split('\n')
    expect(jobs).toHaveLength(7)
    const deck = JSON.parse(await readFile(path.join(dataDir, 'practice/decks/sam-old-notes.json'), 'utf8')) as { cards: unknown[] }
    expect(deck.cards).toHaveLength(1)

    const again = (await (await preview(jobHunter)).json()) as ImportPreview
    expect(planHasChanges(again.plan)).toBe(false)
    expect(again.plan.applications.already).toBe(5)
  })

  it('never writes to the job-hunter folder', async () => {
    const before = await readFile(path.join(jobHunter, 'data/job_queue.jsonl'), 'utf8')
    await preview(jobHunter)
    expect(await readFile(path.join(jobHunter, 'data/job_queue.jsonl'), 'utf8')).toBe(before)
    expect((await readdir(jobHunter)).sort()).toEqual(['copilot-data', 'data'])
  })
})
