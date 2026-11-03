import { execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { copyFile, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEMO_JOBHUNTER_SOURCE } from '../src/features/import/demoJobHunter.ts'
import { loadData, REPO_ROOT } from './lib/data-dir.ts'
import { buildImport, describeImport, existingFrom, folderReader, overlapProblem, writeImport } from './lib/jobhunter-import.ts'

const run = promisify(execFile)
const NOW = new Date('2026-11-03T17:00:00Z')
const YAML_FIXTURE = new URL('./fixtures/jobhunter/config/profile.yaml', import.meta.url)

let work: string
let source: string
let data: string

/** Writes the fictional demo job-hunter folder (and optionally its old profile.yaml) to disk. */
async function writeSource(options: { yaml: boolean; copilotProfile: boolean }) {
  const files = [
    DEMO_JOBHUNTER_SOURCE.queue,
    DEMO_JOBHUNTER_SOURCE.applications,
    DEMO_JOBHUNTER_SOURCE.companies,
    ...DEMO_JOBHUNTER_SOURCE.decks,
    ...DEMO_JOBHUNTER_SOURCE.exercises,
    ...DEMO_JOBHUNTER_SOURCE.stories,
  ].filter((file) => file !== undefined)
  for (const file of files) {
    await mkdir(path.dirname(path.join(source, file.path)), { recursive: true })
    await writeFile(path.join(source, file.path), file.text)
  }
  if (options.copilotProfile) {
    // The sample persona's profile stands in for the corrected profile.json.
    await copyFile(path.join(REPO_ROOT, 'sample-data/profile.json'), path.join(source, 'copilot-data/profile.json'))
  }
  if (options.yaml) {
    await mkdir(path.join(source, 'config'), { recursive: true })
    await copyFile(YAML_FIXTURE, path.join(source, 'config/profile.yaml'))
  }
}

/** A fingerprint of every file in a folder, so a test can prove nothing in it changed. */
async function fingerprint(root: string): Promise<string> {
  const hash = createHash('sha256')
  const walk = async (folder: string) => {
    for (const name of (await readdir(folder)).sort()) {
      const full = path.join(folder, name)
      const info = await stat(full)
      if (info.isDirectory()) await walk(full)
      else hash.update(`${path.relative(root, full)}\0${info.mtimeMs}\0`).update(await readFile(full))
    }
  }
  await walk(root)
  return hash.digest('hex')
}

function cli(...args: string[]) {
  return run(process.execPath, ['--experimental-strip-types', '--no-warnings', 'scripts/import-jobhunter.ts', ...args], {
    cwd: REPO_ROOT,
    env: { ...process.env, COPILOT_DATA_DIR: '' },
  })
}

beforeEach(async () => {
  work = await mkdtemp(path.join(tmpdir(), 'shortlist-import-'))
  source = path.join(work, 'job-hunter')
  data = path.join(work, 'data')
})

afterEach(async () => {
  await rm(work, { recursive: true, force: true })
})

describe('import-jobhunter', () => {
  it('uses profile.yaml only as a fallback and warns about everything it imported unverified', async () => {
    await writeSource({ yaml: true, copilotProfile: false })
    const result = await buildImport(folderReader(source), existingFrom(await loadData(data)), NOW)
    expect(result?.yaml).not.toBeNull()
    expect(result?.plan.profile?.action).toBe('add')
    const report = describeImport(result!, { source, dataDir: data, replaceProfile: false, written: null })
    expect(report).toContain('WARNING: the profile came from config/profile.yaml')
    expect(report).toContain('Lead Engineer at Orbital Widgets (Jan 2024 to present)')
    expect(report).toContain('Shelfmate: Recorded each swap in one PostgreSQL transaction')
    expect(report).toContain('Years of experience with React -> 4')
    expect(report).not.toContain('Prefer not to say')
  })

  it('prefers the corrected copilot-data/profile.json when both exist', async () => {
    await writeSource({ yaml: true, copilotProfile: true })
    const result = await buildImport(folderReader(source), existingFrom(await loadData(data)), NOW)
    expect(result?.yaml).toBeNull()
    expect(result?.profileFile).toBe('copilot-data/profile.json')
    expect(result?.plan.profile?.profile.experience.every((job) => job.verified)).toBe(true)
    expect(describeImport(result!, { source, dataDir: data, replaceProfile: false, written: null })).not.toContain('WARNING')
  })

  it('writes the plan, never touches the source, and adds nothing the second time', async () => {
    await writeSource({ yaml: true, copilotProfile: false })
    const before = await fingerprint(source)

    const first = await cli('--from', source, '--data', data)
    expect(first.stdout).toMatch(/^Wrote .*jobs?.*applications?.*the profile\./m)
    const saved = await loadData(data)
    expect(saved.applications.length).toBeGreaterThan(0)
    expect(saved.applications.every((app) => saved.jobs.some((job) => job.id === app.jobId))).toBe(true)
    expect(saved.profile?.experience.every((job) => job.verified === false)).toBe(true)
    expect((await stat(data)).mode & 0o777).toBe(0o700)

    const second = await cli('--from', source, '--data', data)
    expect(second.stdout).toContain('Nothing new to import.')
    expect((await loadData(data)).jobs).toHaveLength(saved.jobs.length)
    expect(await fingerprint(source)).toBe(before)
  })

  it('keeps an existing profile unless asked to replace it', async () => {
    await writeSource({ yaml: true, copilotProfile: false })
    await cli('--from', source, '--data', data)
    const profileFile = path.join(data, 'profile.json')
    const edited = { ...JSON.parse(await readFile(profileFile, 'utf8')), preferredName: 'Sammy' }
    await writeFile(profileFile, JSON.stringify(edited))

    const kept = await cli('--from', source, '--data', data)
    expect(kept.stdout).toContain('Run again with --replace-profile')
    expect(JSON.parse(await readFile(profileFile, 'utf8')).preferredName).toBe('Sammy')

    await cli('--from', source, '--data', data, '--replace-profile')
    expect(JSON.parse(await readFile(profileFile, 'utf8')).preferredName).toBe('Sam')
  })

  it('writes nothing on a dry run, not even the data folder', async () => {
    await writeSource({ yaml: false, copilotProfile: false })
    const { stdout } = await cli('--from', source, '--data', data, '--dry-run')
    expect(stdout).toContain('Dry run: nothing was written.')
    await expect(stat(data)).rejects.toMatchObject({ code: 'ENOENT' })
  })

  it('refuses a data folder inside job-hunter and a folder with nothing to import', async () => {
    expect(overlapProblem('/work/job-hunter', '/work/job-hunter/.private')).toMatch(/never writes to job-hunter/)
    expect(overlapProblem('/work/data/job-hunter', '/work/data')).toMatch(/inside the data folder/)
    expect(overlapProblem('/work/job-hunter', '/work/data')).toBeNull()

    await mkdir(source, { recursive: true })
    await expect(cli('--from', source, '--data', data)).rejects.toMatchObject({ stderr: expect.stringContaining('No job-hunter data in') })
    await expect(cli('--from', source, '--data', path.join(source, 'data'))).rejects.toMatchObject({ stderr: expect.stringContaining('never writes to job-hunter') })
  })

  it('writes the same files as the plan describes', async () => {
    await writeSource({ yaml: false, copilotProfile: false })
    const result = await buildImport(folderReader(source), existingFrom(await loadData(data)), NOW)
    const written = await writeImport(data, result!.plan, { replaceProfile: false })
    expect(written).toEqual(expect.arrayContaining([`${result!.plan.jobs.add.length} jobs`, `${result!.plan.applications.add.length} applications`]))
  })
})
