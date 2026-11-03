/**
 * The board scanner: reads the watchlist's Greenhouse, Ashby and Lever boards, keeps postings
 * whose title and location fit, scores them with the engine, and returns new jobs to save. A
 * port of job-hunter's scan-watchlist.mjs with its defects fixed:
 *   - titles match on whole words, so "Intern" no longer matches "Internal" and "Design" no
 *     longer drops "Frontend Developer, Design Systems";
 *   - level comes from the title, so "Software Engineer II" and senior roles are left out, and
 *     the duplicate key keeps the level, so an internship never hides a full-time role;
 *   - "Remote - US" is read as US-only and scored that way instead of passing as remote;
 *   - links are checked by hostname, and the posting date is the first-published one.
 * The network is passed in, so tests run on saved responses.
 */
import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { urlKey, companyTitleKey, ghostReason } from '../../src/engine/dedup.ts'
import { extractFacts } from '../../src/engine/facts.ts'
import { queueStatusFor } from '../../src/engine/gates.ts'
import { detectWorkplace, normalizeCompany, normalizeLocation, normalizeTitle, textMatcher, titleLevel } from '../../src/engine/normalize.ts'
import { scoreJob } from '../../src/engine/score.ts'
import type { Application, Company, Job, Profile } from '../../src/engine/types.ts'
import { API_HOSTS, boardApiUrl, isBoardAts, PARSERS, type BoardAts, type BoardPosting } from './boards.ts'

// ---------- Filters ----------

/** Words that make a title worth a look, matched as whole words after title normalization. */
export const TARGET_TITLE_WORDS = [
  'junior', 'new grad', 'entry level', 'early career', 'graduate', 'associate software', 'software engineer',
  'software developer', 'full stack', 'frontend', 'backend', 'web developer', 'react', 'node', 'typescript',
  'application developer', 'product engineer', 'intern', 'co-op',
]

/**
 * Specialties and non-engineering roles left out. Seniority is handled by the title's level,
 * and each person's own avoided titles come from their profile.
 */
export const EXCLUDED_TITLE_WORDS = [
  'devops', 'sre', 'site reliability', 'ios', 'android', 'mobile developer', 'mobile engineer', 'embedded',
  'firmware', 'hardware', 'security engineer', 'data engineer', 'network engineer', 'systems administrator',
  'qa engineer', 'quality assurance', 'test engineer', 'integrations engineer', 'designer', 'product design',
  'ux design', 'marketing', 'sales', 'customer success', 'customer support', 'support engineer', 'recruiter',
  'recruiting', 'finance', 'accountant', 'legal', 'counsel', 'human resources', 'people partner',
  'people operations', 'content writer', 'content strategist', 'copywriter', 'editor', 'translator',
]

export type FilterOutcome = { keep: true } | { keep: false; reason: string }

function words(title: string) {
  return textMatcher(normalizeTitle(title))
}

/** Whether a posting's title is worth scoring. */
export function titleFilter(title: string, profile: Profile | null): FilterOutcome {
  const level = titleLevel(title)
  if (level === 'senior') return { keep: false, reason: 'Senior-level title' }
  if (level === 'mid') return { keep: false, reason: 'Mid-level title (II or intermediate)' }
  const matcher = words(title)
  const avoided = (profile?.targeting.avoidTitles ?? []).map(normalizeTitle).filter(Boolean)
  const excluded = matcher.which([...EXCLUDED_TITLE_WORDS, ...avoided])
  if (excluded.length > 0) return { keep: false, reason: `Title has "${excluded[0]}"` }
  const targets = [...TARGET_TITLE_WORDS, ...(profile?.targeting.titles ?? []).map(normalizeTitle).filter(Boolean)]
  if (matcher.which(targets).length === 0) return { keep: false, reason: 'No target words in the title' }
  return { keep: true }
}

/**
 * Whether the location could work: anything remote (the scorer reads "Remote - US" as US-only),
 * a target or relocation place from the profile, or the profile's country with no city named.
 * Without a profile every location is kept.
 */
export function locationFilter(posting: Pick<BoardPosting, 'location' | 'workplace' | 'title'>, profile: Profile | null): FilterOutcome {
  if (!profile) return { keep: true }
  if (posting.workplace === 'remote' || detectWorkplace(posting.location, posting.title) === 'remote') return { keep: true }
  if (posting.location.trim() === '') return { keep: false, reason: 'No location given' }
  const place = textMatcher(normalizeLocation(posting.location))
  const targets = [...profile.targeting.locations, ...profile.location.relocateTo, profile.location.city]
    .map((target) => normalizeLocation(target).replace(/\bremote\b,?/g, '').trim())
    .filter(Boolean)
  if (targets.some((target) => place.has(target))) return { keep: true }
  const country = normalizeLocation(profile.location.country)
  if (country && normalizeLocation(posting.location).replace(/[^a-z ]/g, '').trim() === country) return { keep: true }
  return { keep: false, reason: `Not a target location (${posting.location})` }
}

// ---------- Turning a posting into a job ----------

const PREFIX: Record<BoardAts, string> = { greenhouse: 'gh', ashby: 'ashby', lever: 'lever' }
const BOARD_NAME: Record<BoardAts, string> = { greenhouse: 'Greenhouse', ashby: 'Ashby', lever: 'Lever' }

/** A stable id, so scanning the same board twice finds the same job. */
export function jobIdFor(posting: Pick<BoardPosting, 'ats' | 'externalId'>, slug: string): string {
  const safe = slug.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
  return `${PREFIX[posting.ats]}-${safe}-${posting.externalId}`
}

interface Known {
  ids: Set<string>
  urls: Set<string>
  /** company::title key to a description of where it was seen. */
  titles: Map<string, string>
}

function knownFrom(jobs: readonly Job[], applications: readonly Application[]): Known {
  const known: Known = { ids: new Set(), urls: new Set(), titles: new Map() }
  for (const job of jobs) {
    known.ids.add(job.id)
    if (job.url) known.urls.add(urlKey(job.url))
    if (!known.titles.has(companyTitleKey(job.company, job.title))) known.titles.set(companyTitleKey(job.company, job.title), `already in your jobs as "${job.title}"`)
  }
  for (const app of applications) {
    if (app.url) known.urls.add(urlKey(app.url))
    const day = app.appliedAt ? ` on ${app.appliedAt.slice(0, 10)}` : ''
    known.titles.set(companyTitleKey(app.company, app.title), `you applied to "${app.title}"${day}`)
  }
  return known
}

export function jobFromPosting(
  posting: BoardPosting,
  company: Company,
  context: { profile: Profile | null; now: Date; duplicateOf: string | null; history: readonly Job[] },
): Job {
  const facts = extractFacts(posting.jdText, posting.title, posting.location)
  if (!facts.salaryText && posting.salaryText) facts.salaryText = posting.salaryText
  const notes = [`Found by npm run scan on the ${company.name} ${BOARD_NAME[posting.ats]} board.`]
  if (posting.updatedAt) {
    notes.push(`The board gives no first-posted date, only "updated ${posting.updatedAt.slice(0, 10)}", which any edit moves. Open the posting and add the date.`)
  }
  if (context.duplicateOf) notes.push(`Same company and title as a posting ${context.duplicateOf}.`)
  const job: Job = {
    id: jobIdFor(posting, company.slug ?? ''),
    source: posting.ats,
    ats: posting.ats,
    company: posting.company,
    title: posting.title,
    location: posting.location,
    workplace: posting.workplace === 'unknown' ? detectWorkplace(posting.location, posting.title, posting.jdText) : posting.workplace,
    url: posting.url,
    postedAt: posting.postedAt,
    postedAtSource: posting.postedAt ? 'api' : 'unknown',
    discoveredAt: context.now.toISOString(),
    jdText: posting.jdText,
    facts,
    status: 'queued',
    notes: notes.join(' '),
  }
  const ghost = ghostReason(job, context.history)
  if (context.profile) {
    job.score = scoreJob(job, context.profile, context.now)
    job.status = queueStatusFor(job.score, { duplicate: context.duplicateOf !== null, ghost })
  } else {
    job.status = context.duplicateOf ? 'skipped_duplicate' : ghost ? 'skipped_ghost' : 'queued'
  }
  return job
}

// ---------- Running a scan ----------

/** Fetches one board's API response, already parsed as JSON. */
export type FetchBoard = (url: string, company: Company) => Promise<unknown>

export interface CompanyScan {
  company: string
  ats: Company['ats']
  outcome: 'scanned' | 'failed' | 'manual' | 'no_board'
  message?: string
  fetched: number
  malformed: number
  filtered: { title: string; reason: string }[]
  /** Postings already in the data folder (same id or link), so not saved again. */
  known: number
  added: Job[]
}

export interface ScanResult {
  companies: CompanyScan[]
  added: Job[]
}

/** Runs tasks with at most `limit` at once, keeping the input order in the results. */
export async function mapLimit<T, R>(items: readonly T[], limit: number, task: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let next = 0
  const worker = async () => {
    while (next < items.length) {
      const index = next
      next += 1
      results[index] = await task(items[index])
    }
  }
  await Promise.all(Array.from({ length: Math.max(1, Math.min(limit, items.length)) }, worker))
  return results
}

export async function scanBoards(options: {
  companies: readonly Company[]
  jobs: readonly Job[]
  applications: readonly Application[]
  profile: Profile | null
  now: Date
  fetchBoard: FetchBoard
  concurrency?: number
}): Promise<ScanResult> {
  const responses = await mapLimit(options.companies, options.concurrency ?? 6, async (company) => {
    if (!isBoardAts(company.ats)) return { company, error: null, json: undefined, kind: 'manual' as const }
    const url = boardApiUrl(company)
    if (!url) return { company, error: 'No valid board slug', json: undefined, kind: 'no_board' as const }
    try {
      return { company, error: null, json: await options.fetchBoard(url, company), kind: 'fetched' as const }
    } catch (error) {
      return { company, error: error instanceof Error ? error.message : String(error), json: undefined, kind: 'fetched' as const }
    }
  })

  // Postings are judged in watchlist order, after every fetch, so the result does not depend on which board answered first.
  const known = knownFrom(options.jobs, options.applications)
  const history: Job[] = [...options.jobs]
  const added: Job[] = []
  const companies = responses.map(({ company, error, json, kind }): CompanyScan => {
    const scan: CompanyScan = { company: company.name, ats: company.ats, outcome: 'scanned', fetched: 0, malformed: 0, filtered: [], known: 0, added: [] }
    if (kind === 'manual') return { ...scan, outcome: 'manual', message: company.careersUrl ? `Check by hand: ${company.careersUrl}` : 'Check by hand.' }
    if (kind === 'no_board') return { ...scan, outcome: 'no_board', message: error ?? undefined }
    if (error !== null) return { ...scan, outcome: 'failed', message: error }
    const parsed = PARSERS[company.ats as BoardAts](json, company)
    if (!parsed) return { ...scan, outcome: 'failed', message: 'The board answered, but not in the shape its API documents.' }
    scan.fetched = parsed.postings.length
    scan.malformed = parsed.skipped
    for (const posting of parsed.postings) {
      const id = jobIdFor(posting, company.slug ?? '')
      if (known.ids.has(id) || known.urls.has(urlKey(posting.url))) {
        scan.known += 1
        continue
      }
      const verdict = [titleFilter(posting.title, options.profile), locationFilter(posting, options.profile)].find((outcome) => !outcome.keep)
      if (verdict && !verdict.keep) {
        scan.filtered.push({ title: posting.title, reason: verdict.reason })
        continue
      }
      const key = companyTitleKey(posting.company, posting.title)
      const job = jobFromPosting(posting, company, { profile: options.profile, now: options.now, duplicateOf: known.titles.get(key) ?? null, history })
      known.ids.add(job.id)
      known.urls.add(urlKey(job.url))
      if (!known.titles.has(key)) known.titles.set(key, `found earlier in this scan (${job.location || 'no location'})`)
      history.push(job)
      scan.added.push(job)
      added.push(job)
    }
    return scan
  })
  return { companies, added }
}

// ---------- Network layers ----------

const ALLOWED_API_HOSTS = new Set(Object.values(API_HOSTS))

/** True for an https URL on one of the three board API hosts, and nothing else. */
export function isBoardApiUrl(text: string): boolean {
  try {
    const url = new URL(text)
    return url.protocol === 'https:' && !url.username && !url.password && !url.port && ALLOWED_API_HOSTS.has(url.hostname)
  } catch {
    return false
  }
}

/**
 * The real network: fetch with a timeout and a size cap, only to the three API hosts, and
 * without following redirects (a redirect could lead anywhere).
 */
export function httpFetcher({ fetch: send = globalThis.fetch, timeoutMs = 10_000, maxBytes = 20 * 1024 * 1024 } = {}): FetchBoard {
  return async (url) => {
    if (!isBoardApiUrl(url)) throw new Error(`Refused ${url}: the scanner only calls the Greenhouse, Ashby and Lever board APIs.`)
    const controller = new AbortController()
    const timer = setTimeout(() => controller.abort(), timeoutMs)
    try {
      const response = await send(url, {
        signal: controller.signal,
        redirect: 'error',
        headers: { accept: 'application/json', 'user-agent': 'Shortlist job scanner (one person, reading public job boards)' },
      })
      if (!response.ok) throw new Error(`The board answered HTTP ${response.status}.`)
      if (Number(response.headers.get('content-length') ?? 0) > maxBytes) throw new Error('The board sent more than the size limit.')
      const text = await response.text()
      if (text.length > maxBytes) throw new Error('The board sent more than the size limit.')
      try {
        return JSON.parse(text)
      } catch {
        throw new Error('The board did not send JSON.')
      }
    } catch (error) {
      if (controller.signal.aborted) throw new Error(`No answer after ${timeoutMs / 1000} seconds.`)
      throw error
    } finally {
      clearTimeout(timer)
    }
  }
}

/** Saved responses instead of the network: <folder>/<ats>-<slug>.json, for example saved with curl. */
export function savedResponses(folder: string): FetchBoard {
  return async (_url, company) => {
    const file = path.join(folder, `${company.ats}-${company.slug}.json`)
    let text: string
    try {
      text = await readFile(file, 'utf8')
    } catch {
      throw new Error(`No saved response at ${file}.`)
    }
    try {
      return JSON.parse(text)
    } catch {
      throw new Error(`${file} is not valid JSON.`)
    }
  }
}

/** The companies to scan: all of them, or the ones named with --company (case and suffixes ignored). */
export function pickCompanies(companies: readonly Company[], names: readonly string[]): Company[] {
  if (names.length === 0) return [...companies]
  const wanted = new Set(names.map(normalizeCompany))
  const picked = companies.filter((company) => wanted.has(normalizeCompany(company.name)))
  const missing = [...wanted].filter((name) => !picked.some((company) => normalizeCompany(company.name) === name))
  if (missing.length > 0) {
    throw new Error(`Not on the watchlist: ${missing.join(', ')}. The watchlist has ${companies.map((company) => company.name).join(', ') || 'no companies'}.`)
  }
  return picked
}
