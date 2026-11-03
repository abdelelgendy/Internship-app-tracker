import { describe, expect, it } from 'vitest'
import type { Job } from '../../src/engine/types.ts'
import { DEMO_JOBHUNTER_SOURCE } from '../../src/features/import/demoJobHunter.ts'
import { planHasChanges, planImport, readJobHunterSource, stableHash, type ExistingData, type ImportPlan, type SourceReader } from './jobhunter-map.ts'

const NOW = new Date('2026-11-03T17:00:00Z')
const EMPTY: ExistingData = { jobs: [], applications: [], profile: null, decks: [], exercises: [], stories: [], companies: [] }

function existingFrom(plan: ImportPlan): ExistingData {
  return {
    jobs: plan.jobs.add,
    applications: plan.applications.add,
    profile: plan.profile?.profile ?? null,
    decks: plan.decks.map((entry) => entry.deck),
    exercises: plan.exercises.merged,
    stories: plan.stories.merged,
    companies: plan.companies.merged,
  }
}

const job = (overrides: Partial<Job>): Job => ({
  id: 'existing',
  source: 'manual',
  company: 'Example Co',
  title: 'Junior Developer',
  location: 'Remote',
  workplace: 'remote',
  url: 'https://example.com/jobs/1',
  postedAt: null,
  postedAtSource: 'unknown',
  discoveredAt: '2026-10-01T00:00:00.000Z',
  status: 'queued',
  ...overrides,
})

describe('planImport from job-hunter files', () => {
  const plan = planImport(DEMO_JOBHUNTER_SOURCE, EMPTY, { now: NOW })

  it('maps statuses and reports how', () => {
    expect(plan.statusMapping).toEqual(
      expect.arrayContaining([
        { domain: 'application', from: 'submitted', to: 'applied', count: 5 },
        { domain: 'queue', from: 'tailored', to: 'shortlisted', count: 1 },
        { domain: 'queue', from: 'skipped_age', to: 'skipped_age', count: 1 },
        { domain: 'queue', from: 'priority_apply', to: 'queued', count: 1 },
      ]),
    )
    expect(plan.problems.map((problem) => problem.message)).toEqual(
      expect.arrayContaining([expect.stringContaining('Unknown status "priority_apply"'), 'Not valid JSON, so it was skipped.']),
    )
  })

  it('imports applications as applied, with history, channel and a job each', () => {
    expect(plan.applications.add).toHaveLength(5)
    const jobIds = new Set(plan.jobs.add.map((entry) => entry.id))
    for (const app of plan.applications.add) {
      expect(app.status).toBe('applied')
      expect(app.history).toEqual([{ status: 'applied', at: app.appliedAt, by: 'import' }])
      expect(jobIds.has(app.jobId)).toBe(true)
    }
    const tidewater = plan.applications.add.find((app) => app.company === 'Tidewater Robotics')
    expect(tidewater).toMatchObject({ appliedAt: '2026-04-22T20:37:17.000Z', channel: 'easy_apply', jobId: 'jh-q-0002', resumeVersion: 'Sam_Rivera_Resume.pdf' })
    expect(plan.applications.add.find((app) => app.company === 'Pinecrest Analytics')?.channel).toBe('company_site')
  })

  it('sets tailoring logs and undated unknown rows aside', () => {
    expect(plan.setAside.map((finding) => finding.line)).toEqual([1, 7])
    expect(plan.setAside[0].message).toBe('A tailoring log for Junior Software Developer at Tidewater Robotics, not an application. Left out.')
  })

  it('lists queue rows that never recorded the application, and fixes their status', () => {
    expect(plan.mismatches).toHaveLength(2)
    expect(plan.mismatches[0].message).toContain('still says "tailored"')
    expect(plan.mismatches[1].message).toContain('still says "queued"')
    const statuses = Object.fromEntries(plan.jobs.add.map((entry) => [entry.id, entry.status]))
    expect(statuses['jh-q-0002']).toBe('shortlisted')
    expect(statuses['jh-q-0003']).toBe('shortlisted')
  })

  it('finds duplicates, but not through a search page shared by different companies', () => {
    const messages = plan.duplicates.map((finding) => finding.message)
    expect(messages).toContain('Same posting as line 4 (Frontend Developer at Bluejay Transit), so it was skipped.')
    expect(messages).toContain('Applied to Junior Developer at Harbourlight Health again (first on line 5). Both are kept.')
    expect(plan.duplicates).toHaveLength(2)
    expect(plan.problems.some((problem) => problem.message.startsWith('2 postings at different companies share one link (lines 2, 3)'))).toBe(true)
    expect(plan.jobs.add.map((entry) => entry.id)).toEqual(expect.arrayContaining(['jh-q-0002', 'jh-q-0003']))
  })

  it('creates one job for applications whose posting was not queued, and drops old scores', () => {
    expect(plan.jobs.fromApplications).toBe(2)
    expect(plan.jobs.add).toHaveLength(7)
    expect(plan.jobs.scoresDropped).toBe(5)
    expect(plan.jobs.add.every((entry) => entry.score === undefined && entry.source === 'job-hunter-import')).toBe(true)
    const harbourlight = plan.jobs.add.filter((entry) => entry.company === 'Harbourlight Health')
    expect(harbourlight).toHaveLength(1)
    expect(harbourlight[0]).toMatchObject({ status: 'shortlisted', postedAt: null, workplace: 'unknown' })
  })

  it('keeps the posting date only when job-hunter had one, and infers the board', () => {
    const bluejay = plan.jobs.add.find((entry) => entry.id === 'jh-q-0004')
    expect(bluejay).toMatchObject({ postedAt: '2026-04-02T18:05:39.000Z', postedAtSource: 'api', ats: 'lever', status: 'skipped_age' })
    expect(plan.jobs.add.find((entry) => entry.id === 'jh-q-0003')).toMatchObject({ postedAt: null, postedAtSource: 'unknown' })
  })

  it('imports practice files and the watchlist, leaving out an incomplete card', () => {
    expect(plan.decks).toHaveLength(1)
    expect(plan.decks[0]).toMatchObject({ action: 'add', deck: { id: 'sam-old-notes' } })
    expect(plan.decks[0].deck.cards.map((card) => card.id)).toEqual(['sam-old-why-local'])
    expect(plan.problems.some((problem) => problem.message.includes('sam-old-broken has no kind'))).toBe(true)
    expect(plan.exercises).toMatchObject({ added: 1, updated: 0 })
    expect(plan.stories).toMatchObject({ added: 1, updated: 0 })
    expect(plan.companies.added).toBe(2)
  })

  it('changes nothing when run again', () => {
    const again = planImport(DEMO_JOBHUNTER_SOURCE, existingFrom(plan), { now: new Date('2026-11-10T00:00:00Z') })
    expect(planHasChanges(again)).toBe(false)
    expect(again.jobs.already).toBe(5)
    expect(again.applications.already).toBe(5)
    expect(again.decks[0].action).toBe('same')
  })
})

describe('planImport against data already in Shortlist', () => {
  it('skips postings Shortlist has and links applications to them', () => {
    const quillstack = job({ id: 'mine-1', company: 'Quillstack', title: 'Junior Frontend Engineer', url: 'https://jobs.lever.co/quillstack-sample/4917c8ed-36ec-450e-a90e-b5ed03c9963f' })
    const pinecrest = job({ id: 'mine-2', company: 'Pinecrest Analytics', title: 'Associate Software Engineer', url: 'https://boards.greenhouse.io/pinecrest-sample/jobs/4012018' })
    const plan = planImport(DEMO_JOBHUNTER_SOURCE, { ...EMPTY, jobs: [quillstack, pinecrest], companies: [{ name: 'Quillstack Inc.', ats: 'lever', verified: true }] }, { now: NOW })
    expect(plan.jobs.add.some((entry) => entry.company === 'Quillstack')).toBe(false)
    expect(plan.duplicates.some((finding) => finding.message === 'Junior Frontend Engineer at Quillstack matches a job already in Shortlist (same link), so it was skipped.')).toBe(true)
    expect(plan.applications.add.find((app) => app.company === 'Pinecrest Analytics')?.jobId).toBe('mine-2')
    expect(plan.jobs.fromApplications).toBe(1)
    expect(plan.companies.added).toBe(1)
  })

  it('updates a deck that changed, and replaces a profile only as an update', () => {
    const first = planImport(DEMO_JOBHUNTER_SOURCE, EMPTY, { now: NOW })
    const older = { ...first.decks[0].deck, title: 'Old title' }
    const plan = planImport(DEMO_JOBHUNTER_SOURCE, { ...EMPTY, decks: [older] }, { now: NOW })
    expect(plan.decks[0].action).toBe('update')
  })
})

describe('readJobHunterSource', () => {
  function reader(files: Record<string, string>): SourceReader {
    return {
      async list(folder) {
        const prefix = folder === '' ? '' : `${folder}/`
        const names = Object.keys(files)
          .filter((file) => file.startsWith(prefix))
          .map((file) => file.slice(prefix.length).split('/')[0])
        return names.length > 0 ? [...new Set(names)] : null
      },
      async read(file) {
        return files[file] ?? null
      },
    }
  }

  it('reads a job-hunter folder with its copilot-data folder', async () => {
    const source = await readJobHunterSource(
      reader({
        'data/job_queue.jsonl': '{}',
        'data/applications.jsonl': '{}',
        'copilot-data/profile.json': '{}',
        'copilot-data/leads.jsonl': '',
        'copilot-data/practice/decks/b.json': '{}',
        'copilot-data/practice/decks/a.json': '{}',
        'copilot-data/practice/decks/notes.txt': 'not a deck',
        'copilot-data/practice/exercises-general.json': '[]',
        'copilot-data/practice/exercises-platforms.json': '[]',
        'copilot-data/practice/stories-general.json': '[]',
        'config/profile.yaml': 'ignored',
      }),
    )
    expect(source?.queue?.path).toBe('data/job_queue.jsonl')
    expect(source?.profile?.path).toBe('copilot-data/profile.json')
    expect(source?.jobs.map((file) => file.path)).toEqual(['copilot-data/leads.jsonl'])
    expect(source?.decks.map((file) => file.path)).toEqual(['copilot-data/practice/decks/a.json', 'copilot-data/practice/decks/b.json'])
    expect(source?.exercises).toHaveLength(2)
    expect(source?.stories).toHaveLength(1)
  })

  it('reads the copilot-data folder itself', async () => {
    const source = await readJobHunterSource(reader({ 'profile.json': '{}', 'practice/stories.json': '[]' }))
    expect(source?.profile?.path).toBe('profile.json')
    expect(source?.stories.map((file) => file.path)).toEqual(['practice/stories.json'])
    expect(source?.queue).toBeUndefined()
  })

  it('returns null for a missing or unrelated folder', async () => {
    expect(await readJobHunterSource(reader({}))).toBeNull()
    expect(await readJobHunterSource(reader({ 'README.md': '# hi' }))).toBeNull()
  })
})

describe('stableHash', () => {
  it('is stable and spreads similar inputs apart', () => {
    expect(stableHash('a')).toBe(stableHash('a'))
    expect(stableHash('a')).not.toBe(stableHash('b'))
    expect(stableHash('a')).toMatch(/^[0-9a-f]{16}$/)
  })
})
