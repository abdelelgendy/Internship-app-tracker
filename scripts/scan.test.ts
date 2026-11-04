import { execFile } from 'node:child_process'
import { cp, mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { promisify } from 'node:util'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readJsonl } from '../src/data/jsonl.ts'
import type { Company, Job, Profile } from '../src/engine/types.ts'
import { allowedUrl, boardApiUrl, decodeEntities, hostMatches, htmlToText, parseAshby, parseGreenhouse, parseLever } from './lib/boards.ts'
import { REPO_ROOT } from './lib/data-dir.ts'
import { httpFetcher, isBoardApiUrl, locationFilter, mapLimit, pickCompanies, savedResponses, scanBoards, titleFilter, type FetchBoard } from './lib/scan.ts'

const run = promisify(execFile)
const NOW = new Date('2026-11-03T17:00:00Z')
const FIXTURES = path.join(REPO_ROOT, 'scripts/fixtures/boards')

const sample = async <T>(file: string): Promise<T> => JSON.parse(await readFile(path.join(REPO_ROOT, 'sample-data', file), 'utf8')) as T
const fixture = async (file: string): Promise<unknown> => JSON.parse(await readFile(path.join(FIXTURES, file), 'utf8'))
const profile = () => sample<Profile>('profile.json')
const companies = () => sample<Company[]>('companies.json')
const maple = { name: 'Maple Ledger', slug: 'mapleledger-sample' }

describe('board responses', () => {
  it('reads Greenhouse: escaped HTML, first-published dates, safe ids and links', async () => {
    const parsed = parseGreenhouse(await fixture('greenhouse-mapleledger-sample.json'), maple)!
    expect(parsed.postings).toHaveLength(11)
    expect(parsed.skipped).toBe(1)
    const first = parsed.postings[0]
    expect(first).toMatchObject({ externalId: '5100001', title: 'Software Developer', location: 'Toronto, ON', postedAt: '2026-11-03T14:00:00.000Z' })
    expect(first.jdText).toBe('Maple Ledger builds bookkeeping software for small businesses. This is a new grad role.\n- 0-2 years of experience with React and TypeScript\n- Node.js and PostgreSQL\nHybrid, three days a week in our Toronto office.')
    const undated = parsed.postings.find((posting) => posting.externalId === '5100009')!
    expect(undated.postedAt).toBeNull()
    expect(undated.updatedAt).toBe('2026-11-03T15:00:00.000Z')
    // A look-alike host is replaced with the board's own link.
    expect(parsed.postings.find((posting) => posting.externalId === '5100010')!.url).toBe('https://job-boards.greenhouse.io/mapleledger-sample/jobs/5100010')
  })

  it('reads Ashby and leaves unlisted postings out', async () => {
    const parsed = parseAshby(await fixture('ashby-harbourlight-sample.json'), { name: 'Harbourlight Health', slug: 'harbourlight-sample' })!
    expect(parsed.postings.map((posting) => posting.title)).toEqual(['Software Engineer, New Grad', 'Junior Software Engineer', 'Junior Developer'])
    expect(parsed.postings[0]).toMatchObject({ workplace: 'remote', location: 'Canada', postedAt: '2026-11-02T21:00:00.000Z', salaryText: 'CA$70K to CA$85K' })
  })

  it('reads Lever, with dates in milliseconds and the requirement lists in the text', async () => {
    const parsed = parseLever(await fixture('lever-quillstack-sample.json'), { name: 'Quillstack', slug: 'quillstack-sample' })!
    expect(parsed.postings[0]).toMatchObject({ title: 'Junior Frontend Engineer', workplace: 'hybrid', postedAt: '2026-11-02T11:00:00.000Z' })
    expect(parsed.postings[0].jdText).toContain('What you bring\n- 0-2 years of experience with React and TypeScript')
  })

  it('returns null for a body that is not a board', () => {
    expect(parseGreenhouse({ message: 'Board not found' }, maple)).toBeNull()
    expect(parseLever({ jobs: [] }, maple)).toBeNull()
  })

  it('decodes entities and strips tags without running anything', () => {
    expect(decodeEntities('&lt;b&gt; &amp;amp; &#39;x&#x27; &bogus;')).toBe("<b> &amp; 'x' &bogus;")
    expect(htmlToText('<p>One</p><script>alert(1)</script><ul><li>Two</li></ul>')).toBe('One\n- Two')
  })
})

describe('host allowlist (the old substring check let 5 of 5 crafted links through)', () => {
  it.each([
    ['https://boards.greenhouse.io/x/jobs/1', true],
    ['https://job-boards.greenhouse.io/x/jobs/1', true],
    ['https://greenhouse.io.evil.example/x', false],
    ['https://evilgreenhouse.io/x', false],
    ['http://boards.greenhouse.io/x', false],
    ['https://user:pass@boards.greenhouse.io/x', false], // privacy-check: allow (a URL with a login in it, not an email address)
    ['https://boards.greenhouse.io:8443/x', false],
    ['https://example.com/?next=boards.greenhouse.io', false],
    ['javascript:alert(1)//greenhouse.io', false],
  ])('%s allowed: %s', (url, ok) => {
    expect(allowedUrl(url, ['greenhouse.io']) !== null).toBe(ok)
  })

  it('matches hosts exactly or as subdomains', () => {
    expect(hostMatches('JOBS.LEVER.CO.', 'lever.co')).toBe(true)
    expect(hostMatches('notlever.co', 'lever.co')).toBe(false)
  })

  it('only builds and fetches the three board API addresses', () => {
    expect(boardApiUrl({ ats: 'greenhouse', slug: 'mapleledger-sample' })).toBe('https://boards-api.greenhouse.io/v1/boards/mapleledger-sample/jobs?content=true')
    expect(boardApiUrl({ ats: 'lever', slug: '../admin' })).toBeNull()
    expect(boardApiUrl({ ats: 'manual', slug: 'x' })).toBeNull()
    expect(isBoardApiUrl('https://api.ashbyhq.com/posting-api/job-board/x')).toBe(true)
    expect(isBoardApiUrl('https://api.ashbyhq.com.evil.example/x')).toBe(false)
  })
})

describe('filters (the defects in engine-inventory section 3.3)', () => {
  it.each([
    ['Internal Tools Engineer', 'No target words in the title'],
    ['Frontend Developer, Design Systems', null],
    ['Content Platform Software Engineer', null],
    ['Software Engineer II', 'Mid-level title (II or intermediate)'],
    ['Software Developer 2', 'Mid-level title (II or intermediate)'],
    ['Senior Frontend Developer', 'Senior-level title'],
    ['Product Designer', 'Title has "designer"'],
    ['Junior Data Engineer', 'Title has "data engineer"'],
    ['Software Engineer Intern', null],
  ])('%s', async (title, reason) => {
    const outcome = titleFilter(title, await profile())
    expect(outcome.keep ? null : outcome.reason).toBe(reason)
  })

  it("adds the profile's avoided titles on whole words", async () => {
    const base = await profile()
    const avoids = { ...base, targeting: { ...base.targeting, avoidTitles: ['Intern'] } }
    expect(titleFilter('Software Engineer Intern', avoids)).toEqual({ keep: false, reason: 'Title has "intern"' })
    expect(titleFilter('Software Developer Internship', avoids)).toEqual({ keep: false, reason: 'Title has "intern"' })
    expect(titleFilter('Internal Tools Engineer', avoids)).toEqual({ keep: false, reason: 'No target words in the title' })
    expect(titleFilter('Internal Tools Software Engineer', avoids)).toEqual({ keep: true })
  })

  it('keeps remote (including US-only, which the scorer then reads), target places and the home country', async () => {
    const p = await profile()
    const keep = (location: string, workplace: Job['workplace'] = 'unknown') => locationFilter({ location, workplace, title: 'Developer' }, p).keep
    expect(keep('Remote - US')).toBe(true)
    expect(keep('Toronto, Ontario, Canada')).toBe(true)
    expect(keep('Canada')).toBe(true)
    expect(keep('Vancouver, BC')).toBe(false)
    expect(keep('', 'remote')).toBe(true)
    expect(keep('')).toBe(false)
    expect(locationFilter({ location: 'Vancouver, BC', workplace: 'onsite', title: 'Developer' }, null).keep).toBe(true)
  })
})

describe('scanBoards on the saved responses', () => {
  const scan = async (jobs: Job[] = [], fetchBoard: FetchBoard = savedResponses(FIXTURES)) =>
    scanBoards({ companies: await companies(), jobs, applications: [], profile: await profile(), now: NOW, fetchBoard })

  it('gives every new posting the status the rules call for', async () => {
    const result = await scan()
    const status = Object.fromEntries(result.added.map((job) => [`${job.company}: ${job.title}${job.location ? ` (${job.location})` : ''}`, job.status]))
    expect(status).toEqual({
      'Maple Ledger: Software Developer (Toronto, ON)': 'queued',
      // The internship is its own job, not a duplicate of the full-time role, and requires enrollment.
      'Maple Ledger: Software Developer Intern (Toronto, ON)': 'skipped_dealbreaker',
      'Maple Ledger: Frontend Developer, Design Systems (Hamilton, ON)': 'queued',
      'Maple Ledger: Content Platform Software Engineer (Remote, Canada)': 'queued',
      'Maple Ledger: Backend Engineer (Remote - US)': 'queued',
      'Maple Ledger: Junior Web Developer (Toronto, ON)': 'queued',
      'Maple Ledger: Full Stack Developer (Toronto, ON)': 'queued',
      'Harbourlight Health: Software Engineer, New Grad (Canada)': 'queued',
      'Harbourlight Health: Junior Software Engineer (Remote - US)': 'skipped_dealbreaker',
      'Harbourlight Health: Junior Developer (Toronto)': 'skipped_ghost',
      'Quillstack: Junior Frontend Engineer (Hamilton, ON)': 'queued',
      'Quillstack: Junior Frontend Engineer (Burlington, ON)': 'skipped_duplicate',
      'Quillstack: Software Developer Co-op (Hamilton, ON)': 'skipped_dealbreaker',
    })
  })

  it('stores facts, a score whose parts add up, the API date and a stable id', async () => {
    const result = await scan()
    for (const job of result.added) {
      expect(job.score!.parts.reduce((sum, part) => sum + part.points, 0)).toBe(job.score!.total)
      expect(job.facts).toBeDefined()
      expect(job.discoveredAt).toBe(NOW.toISOString())
    }
    const backend = result.added.find((job) => job.title === 'Backend Engineer')!
    expect(backend.score!.parts.find((part) => part.key === 'location')!.points).toBe(0)
    const undated = result.added.find((job) => job.title === 'Junior Web Developer')!
    expect(undated).toMatchObject({ id: 'gh-mapleledger-sample-5100009', postedAt: null, postedAtSource: 'unknown' })
    expect(undated.score!.gate.verdict).toBe('hold')
    expect(undated.notes).toContain('only "updated 2026-11-03"')
  })

  it('reports each board: left out, unreadable, failed and by hand', async () => {
    const byName = Object.fromEntries((await scan()).companies.map((entry) => [entry.company, entry]))
    expect(byName['Maple Ledger'].filtered.map((entry) => entry.title)).toEqual([
      'Internal Tools Engineer',
      'Software Engineer II',
      'Senior Software Engineer, Payments',
      'Software Developer, Vancouver',
    ])
    expect(byName['Maple Ledger'].malformed).toBe(1)
    expect(byName['Pinecrest Analytics']).toMatchObject({ outcome: 'failed', message: expect.stringContaining('not in the shape') })
    expect(byName['Brightfern Learning']).toMatchObject({ outcome: 'failed', message: expect.stringContaining('No saved response') })
    expect(byName['Glacier Byte']).toMatchObject({ outcome: 'manual', message: 'Check by hand: https://glacierbyte.example.com/careers' })
  })

  it('skips postings it already has and marks a repeat of a saved title as a duplicate', async () => {
    const first = await scan()
    expect((await scan(first.added)).added).toEqual([])
    const sampleJobs = readJsonl<Job>(await readFile(path.join(REPO_ROOT, 'sample-data/jobs.jsonl'), 'utf8')).rows
    const result = await scan(sampleJobs)
    const quill = result.companies.find((entry) => entry.company === 'Quillstack')!
    expect(quill.known).toBe(1)
    expect(quill.added.find((job) => job.location === 'Burlington, ON')).toMatchObject({ status: 'skipped_duplicate', notes: expect.stringContaining('already in your jobs') })
  })

  it('fetches at most `concurrency` boards at once and keeps watchlist order', async () => {
    let open = 0
    let peak = 0
    const slow: FetchBoard = async (url, company) => {
      open += 1
      peak = Math.max(peak, open)
      await new Promise((resolve) => setTimeout(resolve, 5))
      open -= 1
      return savedResponses(FIXTURES)(url, company)
    }
    const list = await companies()
    const result = await scanBoards({ companies: list, jobs: [], applications: [], profile: await profile(), now: NOW, fetchBoard: slow, concurrency: 2 })
    expect(peak).toBe(2)
    expect(result.companies.map((entry) => entry.company)).toEqual(list.map((company) => company.name))
    expect(await mapLimit([3, 1, 2], 5, async (n) => n * 2)).toEqual([6, 2, 4])
  })

  it('saves new jobs unscored when there is no profile', async () => {
    const result = await scanBoards({ companies: await companies(), jobs: [], applications: [], profile: null, now: NOW, fetchBoard: savedResponses(FIXTURES) })
    expect(result.added.every((job) => job.score === undefined)).toBe(true)
    expect(result.added.find((job) => job.location === 'Burlington, ON')?.status).toBe('skipped_duplicate')
  })
})

describe('httpFetcher', () => {
  const response = (body: string, init: ResponseInit = {}) => new Response(body, { headers: { 'content-type': 'application/json' }, ...init })

  it('refuses any host but the three board APIs without calling the network', async () => {
    let calls = 0
    const fetcher = httpFetcher({ fetch: async () => (calls++, response('{}')) })
    const company = { name: 'X', ats: 'greenhouse', slug: 'x', verified: true } as const
    await expect(fetcher('https://boards-api.greenhouse.io.evil.example/v1', company)).rejects.toThrow(/only calls the Greenhouse, Ashby and Lever/)
    await expect(fetcher('http://api.lever.co/v0/postings/x', company)).rejects.toThrow(/Refused/)
    expect(calls).toBe(0)
  })

  it('asks for JSON, never follows redirects, and explains failures', async () => {
    const company = { name: 'X', ats: 'lever', slug: 'x', verified: true } as const
    const url = 'https://api.lever.co/v0/postings/x?mode=json'
    let seen: RequestInit | undefined
    await expect(httpFetcher({ fetch: async (_url, init) => ((seen = init), response('[]')) })(url, company)).resolves.toEqual([])
    expect(seen?.redirect).toBe('error')
    await expect(httpFetcher({ fetch: async () => response('nope', { status: 404 }) })(url, company)).rejects.toThrow('HTTP 404')
    await expect(httpFetcher({ fetch: async () => response('<html>') })(url, company)).rejects.toThrow('did not send JSON')
    await expect(httpFetcher({ fetch: async () => response('[1,2,3]'), maxBytes: 3 })(url, company)).rejects.toThrow('size limit')
  })

  it('gives up after the timeout', async () => {
    const hang: typeof fetch = (_url, init) =>
      new Promise((_resolve, reject) => init?.signal?.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError'))))
    const company = { name: 'X', ats: 'ashby', slug: 'x', verified: true } as const
    await expect(httpFetcher({ fetch: hang, timeoutMs: 20 })('https://api.ashbyhq.com/posting-api/job-board/x', company)).rejects.toThrow('No answer after 0.02 seconds.')
  })
})

describe('pickCompanies', () => {
  it('matches names loosely and names the ones it cannot find', async () => {
    const list = await companies()
    expect(pickCompanies(list, ['maple ledger inc.']).map((company) => company.name)).toEqual(['Maple Ledger'])
    expect(() => pickCompanies(list, ['Nowhere Co'])).toThrow(/Not on the watchlist: nowhere/)
  })
})

describe('npm run scan', () => {
  let data: string
  beforeEach(async () => {
    data = path.join(await mkdtemp(path.join(tmpdir(), 'shortlist-scan-')), 'data')
    await cp(path.join(REPO_ROOT, 'sample-data'), data, { recursive: true })
  })
  afterEach(async () => {
    await rm(path.dirname(data), { recursive: true, force: true })
  })
  const scanCli = (...args: string[]) =>
    run(process.execPath, ['--experimental-strip-types', '--no-warnings', 'scripts/scan.ts', '--data', data, '--responses', FIXTURES, ...args], { cwd: REPO_ROOT })
  const jobCount = async () => readJsonl<Job>(await readFile(path.join(data, 'jobs.jsonl'), 'utf8')).rows.length

  it('writes nothing on a dry run, saves on a real one, and adds nothing the second time', async () => {
    const before = await jobCount()
    const dry = await scanCli('--dry-run', '--company', 'Maple Ledger')
    expect(dry.stdout).toContain('Would save 7 new jobs.')
    expect(await jobCount()).toBe(before)

    const real = await scanCli('--company', 'Maple Ledger')
    expect(real.stdout).toContain(`Saved 7 new jobs to ${path.join(data, 'jobs.jsonl')}.`)
    expect(await jobCount()).toBe(before + 7)
    expect((await scanCli('--company', 'Maple Ledger')).stdout).toContain('Saved 0 new jobs')
  })

  it('names an unknown company', async () => {
    await expect(scanCli('--company', 'Nowhere Co')).rejects.toMatchObject({ stderr: expect.stringContaining('Not on the watchlist') })
  })
})
