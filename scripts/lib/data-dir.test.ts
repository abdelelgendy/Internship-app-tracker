import { execFile } from 'node:child_process'
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { envFileValue, gitWouldCommit, loadData, prepareDataDir, resolveDataDir, saveRows } from './data-dir.ts'

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
    ['# COPILOT_DATA_DIR=commented', undefined],
    ['OTHER=1', undefined],
  ])('reads %s', (line, value) => {
    expect(envFileValue(`A=1\n${line}\n`, 'COPILOT_DATA_DIR')).toBe(value)
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

  it('names a broken JSON file instead of guessing', async () => {
    await writeFile(path.join(work, 'profile.json'), '{ nope')
    await expect(loadData(work)).rejects.toThrow(/profile\.json .* is not valid JSON/)
  })
})
