import { execFile } from 'node:child_process'
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { readJsonl } from '../src/data/jsonl.ts'
import type { Job } from '../src/engine/types.ts'
import { REPO_ROOT } from './lib/data-dir.ts'

const run = promisify(execFile)
let data: string

/** Runs a script the way npm does, against a copy of the fictional sample data. */
function script(name: string, ...args: string[]) {
  return run(process.execPath, ['--experimental-strip-types', '--no-warnings', `scripts/${name}.ts`, '--data', data, '--tz', 'America/Toronto', ...args], { cwd: REPO_ROOT })
}

beforeAll(async () => {
  data = path.join(await mkdtemp(path.join(tmpdir(), 'shortlist-daily-')), 'data')
  await cp(path.join(REPO_ROOT, 'sample-data'), data, { recursive: true })
})

afterAll(async () => {
  await rm(path.dirname(data), { recursive: true, force: true })
})

describe('score, digest and export-csv on the sample data', () => {
  it('score --dry-run writes nothing; score stores a score on every job', async () => {
    const before = await readFile(path.join(data, 'jobs.jsonl'), 'utf8')
    const dry = await script('score', '--dry-run')
    expect(dry.stdout).toMatch(/^Would score 40 jobs: \d+ to apply to now, \d+ on hold, \d+ skipped\./)
    expect(await readFile(path.join(data, 'jobs.jsonl'), 'utf8')).toBe(before)

    const real = await script('score')
    expect(real.stdout).toMatch(/^Scored 40 jobs/)
    const jobs = readJsonl<Job>(await readFile(path.join(data, 'jobs.jsonl'), 'utf8')).rows
    expect(jobs.every((job) => job.score && job.score.parts.reduce((sum, part) => sum + part.points, 0) === job.score.total)).toBe(true)
  })

  it('digest prints Markdown or writes digest.md', async () => {
    const printed = await script('digest', '--stdout')
    expect(printed.stdout).toMatch(/^# Today, /)
    expect(printed.stdout).toContain('## Worth applying to')
    const written = await script('digest')
    expect(written.stdout.trim()).toBe(`Wrote ${path.join(data, 'digest.md')}`)
    expect(await readFile(path.join(data, 'digest.md'), 'utf8')).toMatch(/^# Today, /)
  })

  it('export-csv writes one row per application and refuses a file git would commit', async () => {
    const { stdout } = await script('export-csv')
    expect(stdout).toContain(`Wrote 14 applications to ${path.join(data, 'applications.csv')}`)
    const csv = await readFile(path.join(data, 'applications.csv'), 'utf8')
    expect(csv.split('\r\n').filter(Boolean)).toHaveLength(15)

    await expect(script('export-csv', '--out', path.join(REPO_ROOT, 'applications.csv'))).rejects.toMatchObject({
      stderr: expect.stringContaining('is a file git would commit'),
    })
  })

  it('score explains what it needs when there is no profile', async () => {
    await rm(path.join(data, 'profile.json'))
    await expect(script('score')).rejects.toMatchObject({ stderr: expect.stringContaining('No profile.json in') })
  })
})
