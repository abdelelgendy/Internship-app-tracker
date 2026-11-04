import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, stat, utimes, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { rescoreJobs } from './rescore.ts'
import type { Job, Profile } from '../../src/engine/types.ts'
import { envFileValue, gitWouldCommit, isInside, loadData, prepareDataDir, resolveDataDir, saveRows, updateRows, withFileLock } from './data-dir.ts'

const run = promisify(execFile)
let work: string

beforeEach(async () => {
  work = await mkdtemp(path.join(tmpdir(), 'shortlist-data-'))
})

afterEach(async () => {
  await rm(work, { recursive: true, force: true })
})

describe('envFileValue', () => {
  it.each([
    ['COPILOT_DATA_DIR=../data', '../data'],
    ['export COPILOT_DATA_DIR="/tmp/my data"', '/tmp/my data'],
    ["COPILOT_DATA_DIR='x' ", 'x'],
    ['COPILOT_DATA_DIR=x # where it lives', 'x'],
    ['COPILOT_DATA_DIR="x y" # quoted, then a comment', 'x y'],
    ['export COPILOT_DATA_DIR=private-data # my real data', 'private-data'],
    ['# COPILOT_DATA_DIR=commented', undefined],
    ['OTHER=1', undefined],
  ])('reads %s', (line, value) => {
    expect(envFileValue(`A=1\n${line}\n`, 'COPILOT_DATA_DIR')).toBe(value)
  })
})

describe('isInside', () => {
  it.each([
    ['/repo', '/repo', true],
    ['/repo', '/repo/.private', true],
    ['/repo', '/repo/..private', true],
    ['/repo', '/repo/..data/x', true],
    ['/repo', '/elsewhere', false],
    ['/repo', '/repo/../x', false],
  ])('%s holds %s: %s', (parent, child, expected) => {
    expect(isInside(parent, child)).toBe(expected)
  })
})

describe('resolveDataDir', () => {
  it('prefers the flag, then the environment, then .env.local, then .private', async () => {
    expect(await resolveDataDir('/abs/flag', { COPILOT_DATA_DIR: 'env' }, work)).toBe('/abs/flag')
    expect(await resolveDataDir(undefined, { COPILOT_DATA_DIR: 'env' }, work)).toBe(path.join(work, 'env'))
    await writeFile(path.join(work, '.env.local'), 'COPILOT_DATA_DIR=from-file\n')
    expect(await resolveDataDir(undefined, {}, work)).toBe(path.join(work, 'from-file'))
    await rm(path.join(work, '.env.local'))
    expect(await resolveDataDir(undefined, {}, work)).toBe(path.join(work, '.private'))
  })
})

describe('prepareDataDir', () => {
  it('refuses a folder git would commit and accepts an ignored one', async () => {
    await run('git', ['init', '-q'], { cwd: work })
    await writeFile(path.join(work, '.gitignore'), '.private/\n')
    expect(await gitWouldCommit(path.join(work, 'tracked'), work)).toBe(true)
    await expect(prepareDataDir(path.join(work, 'tracked'), work)).rejects.toThrow(/would be committed by git/)
    expect(await gitWouldCommit(path.join(work, '.private'), work)).toBe(false)
    expect(await gitWouldCommit(path.join(tmpdir(), 'elsewhere'), work)).toBe(false)
  })

  it('treats a folder whose name starts with two dots as inside the repo', async () => {
    await run('git', ['init', '-q'], { cwd: work })
    await writeFile(path.join(work, '.gitignore'), '.private/\n')
    for (const name of ['..private', '..data']) {
      expect(await gitWouldCommit(path.join(work, name), work)).toBe(true)
      await expect(prepareDataDir(path.join(work, name), work)).rejects.toThrow(/would be committed by git/)
    }
  })

  it('creates the layout with private permissions and keeps existing files', async () => {
    const dir = path.join(work, 'data')
    await mkdir(dir)
    await writeFile(path.join(dir, 'jobs.jsonl'), '{"id":"keep"}\n')
    const created = await prepareDataDir(dir, work)
    expect(created).toEqual(expect.arrayContaining(['practice/', 'covers/', 'applications.jsonl', '.gitignore']))
    expect(created).not.toContain('jobs.jsonl')
    expect(await readFile(path.join(dir, 'jobs.jsonl'), 'utf8')).toBe('{"id":"keep"}\n')
    expect((await stat(path.join(dir, 'applications.jsonl'))).mode & 0o777).toBe(0o600)
  })
})

describe('saveRows and loadData', () => {
  it('replaces rows by id and keeps lines it cannot read', async () => {
    await writeFile(path.join(work, 'jobs.jsonl'), '{"id":"a","n":1}\nnot json\n{"id":"b","n":1}\n')
    await saveRows(work, 'jobs.jsonl', [{ id: 'b', n: 2 }, { id: 'c', n: 1 }])
    expect(await readFile(path.join(work, 'jobs.jsonl'), 'utf8')).toBe('{"id":"a","n":1}\nnot json\n{"id":"b","n":2}\n{"id":"c","n":1}\n')
    const data = await loadData(work)
    expect(data.jobs.map((job) => job.id)).toEqual(['a', 'b', 'c'])
    expect(data.issues).toEqual([{ file: 'jobs.jsonl', line: 2, message: 'Not valid JSON' }])
    expect(data.profile).toBeNull()
  })

  it('keeps an edit made in the app while a script was working', async () => {
    const profile = JSON.parse(await readFile(path.join(import.meta.dirname, '../../sample-data/profile.json'), 'utf8')) as Profile
    const job: Job = {
      id: 'job-1', source: 'manual', company: 'Northwind Labs', title: 'Junior Software Developer', location: 'Toronto, ON',
      workplace: 'hybrid', url: 'https://jobs.lever.co/northwind/1', postedAt: '2026-11-03T10:00:00Z', postedAtSource: 'manual',
      discoveredAt: '2026-11-03T10:00:00Z', status: 'queued', jdText: 'Junior role. 0-2 years of React and TypeScript.',
    }
    await saveRows(work, 'jobs.jsonl', [job])
    const snapshot = await loadData(work)
    // The app shortlists the job and adds a note while the script is still busy.
    await saveRows(work, 'jobs.jsonl', [{ ...job, status: 'shortlisted', notes: 'Ask about the team.' }])
    // What npm run score does: score the rows as they are now, not the snapshot.
    await updateRows<Job>(work, 'jobs.jsonl', (current) => rescoreJobs(current, snapshot.applications, profile, new Date('2026-11-03T12:00:00Z'), { setStatus: true }).jobs)
    const [saved] = (await loadData(work)).jobs
    expect(saved).toMatchObject({ status: 'shortlisted', notes: 'Ask about the team.' })
    expect(saved.score?.total).toBeGreaterThan(0)
  })

  it('never loses an update when writers overlap', async () => {
    await saveRows(work, 'jobs.jsonl', [{ id: 'counter', n: 0 }])
    await Promise.all(
      Array.from({ length: 20 }, () =>
        updateRows<{ id: string; n: number }>(work, 'jobs.jsonl', async (rows) => {
          const row = rows.find((candidate) => candidate.id === 'counter')!
          await new Promise((resolve) => setTimeout(resolve, 1))
          return [{ ...row, n: row.n + 1 }]
        }),
      ),
    )
    expect((await loadData(work)).jobs).toEqual([{ id: 'counter', n: 20 }])
  })

  it('removes a lock left behind by a crash', async () => {
    const file = path.join(work, 'jobs.jsonl')
    await writeFile(`${file}.lock`, '')
    const old = new Date(Date.now() - 60_000)
    await utimes(`${file}.lock`, old, old)
    expect(await withFileLock(file, async () => 'ran')).toBe('ran')
    await expect(stat(`${file}.lock`)).rejects.toThrow()
  })

  it('names a broken JSON file instead of guessing', async () => {
    await writeFile(path.join(work, 'profile.json'), '{ nope')
    await expect(loadData(work)).rejects.toThrow(/profile\.json .* is not valid JSON/)
  })
})
