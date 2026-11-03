/**
 * Maps data from Abdel's older tool, job-hunter, onto Shortlist's data contract. Pure: no file
 * system, no network, no clock (callers pass `now`). The dev server's import preview
 * (src/data/import-middleware.ts) and the import-jobhunter script both use it.
 *
 * Two kinds of input, found in the folder the user points at:
 *   data/job_queue.jsonl, data/applications.jsonl   job-hunter's own files, in its old shapes
 *   copilot-data/...                               files already in the contract's shapes
 *                                                  (profile, practice decks, exercises, stories,
 *                                                  job leads, the company watchlist)
 * Pointing at the copilot-data folder itself works too.
 *
 * The import only adds: a job or application already in Shortlist is left alone, so running it
 * again changes nothing. Decks, exercises and stories are written in job-hunter and only read in
 * Shortlist, so newer copies replace older ones. The profile is replaced only when asked.
 */
import { toIso, toMillis } from '../../src/engine/dates.ts'
import { companyTitleKey, urlKey } from '../../src/engine/dedup.ts'
import { detectWorkplace, normalizeCompany } from '../../src/engine/normalize.ts'
import { normalizeStatus, QUEUE_STATUSES } from '../../src/engine/states.ts'
import type {
  Application,
  AppStatus,
  CardKind,
  Company,
  Exercise,
  Job,
  PracticeCard,
  PracticeDeck,
  Profile,
  QueueStatus,
  StarStory,
  Workplace,
} from '../../src/engine/types.ts'
import { isFileId } from '../../src/data/layout.ts'

// ---------- Reading the folder ----------

/** A file read from the source folder; `path` is relative to the folder the user chose. */
export interface SourceFile {
  path: string
  text: string
}

export interface JobHunterSource {
  queue?: SourceFile
  applications?: SourceFile
  profile?: SourceFile
  jobs: SourceFile[]
  companies?: SourceFile
  decks: SourceFile[]
  exercises: SourceFile[]
  stories: SourceFile[]
}

/** File access for readJobHunterSource, relative to the chosen folder. Both return null when the path is missing. */
export interface SourceReader {
  list(folder: string): Promise<string[] | null>
  read(file: string): Promise<string | null>
}

export const JOBHUNTER_FILES = { queue: 'data/job_queue.jsonl', applications: 'data/applications.jsonl' } as const
const COPILOT_FOLDER = 'copilot-data'
const JOB_FILES = ['jobs.jsonl', 'leads.jsonl']

function sourceSize(source: JobHunterSource): number {
  return [source.queue, source.applications, source.profile, source.companies, ...source.jobs, ...source.decks, ...source.exercises, ...source.stories].filter(Boolean).length
}

/**
 * Reads every file the importer understands from a job-hunter folder or its copilot-data folder.
 * Returns null when the folder does not exist or holds none of them.
 */
export async function readJobHunterSource(reader: SourceReader): Promise<JobHunterSource | null> {
  const top = await reader.list('')
  if (top === null) return null
  const read = async (path: string): Promise<SourceFile | undefined> => {
    const text = await reader.read(path)
    return text === null ? undefined : { path, text }
  }
  const readAll = async (paths: string[]) => (await Promise.all(paths.map(read))).filter((file): file is SourceFile => file !== undefined)
  const jsonIn = async (folder: string, prefix = '') =>
    ((await reader.list(folder)) ?? [])
      .filter((name) => name.endsWith('.json') && name.startsWith(prefix))
      .sort()
      .map((name) => `${folder}/${name}`)

  const copilot = top.includes(COPILOT_FOLDER) ? `${COPILOT_FOLDER}/` : ''
  const practice = `${copilot}practice`
  const [queue, applications, profile, companies, jobs, decks, exercises, stories] = await Promise.all([
    read(JOBHUNTER_FILES.queue),
    read(JOBHUNTER_FILES.applications),
    read(`${copilot}profile.json`),
    read(`${copilot}companies.json`),
    readAll(JOB_FILES.map((name) => `${copilot}${name}`)),
    jsonIn(`${practice}/decks`).then(readAll),
    jsonIn(practice, 'exercises').then(readAll),
    jsonIn(practice, 'stories').then(readAll),
  ])
  const source: JobHunterSource = { queue, applications, profile, companies, jobs, decks, exercises, stories }
  return sourceSize(source) === 0 ? null : source
}

// ---------- The plan ----------

export interface ExistingData {
  jobs: Job[]
  applications: Application[]
  profile: Profile | null
  decks: PracticeDeck[]
  exercises: Exercise[]
  stories: StarStory[]
  companies: Company[]
}

export interface Finding {
  message: string
  file?: string
  line?: number
}

export interface StatusMapping {
  domain: 'queue' | 'application'
  from: string
  to: string
  count: number
}

/** "add": new to Shortlist. "update": Shortlist has an older copy. "same": nothing to do. */
export type ItemAction = 'add' | 'update' | 'same'

export interface ImportPlan {
  found: { file: string; items: number }[]
  jobs: {
    add: Job[]
    /** Already in Shortlist (same id), so left alone. */
    already: number
    /** Jobs created for applications whose posting was not in job-hunter's queue. */
    fromApplications: number
    /** Old scores that were not carried over; Shortlist scores every job again. */
    scoresDropped: number
  }
  applications: { add: Application[]; already: number }
  statusMapping: StatusMapping[]
  /** Rows that are not applications, such as tailoring logs. */
  setAside: Finding[]
  /** Places where job-hunter's files disagree with each other. */
  mismatches: Finding[]
  duplicates: Finding[]
  /** Lines or items that need a look: skipped, or imported with a caveat. */
  problems: Finding[]
  profile: { action: ItemAction; profile: Profile } | null
  decks: { action: ItemAction; deck: PracticeDeck }[]
  /** The full lists to write, existing items first. */
  exercises: { merged: Exercise[]; added: number; updated: number }
  stories: { merged: StarStory[]; added: number; updated: number }
  companies: { merged: Company[]; added: number }
}

/** True when applying the plan would write anything. */
export function planHasChanges(plan: ImportPlan): boolean {
  return (
    plan.jobs.add.length > 0 ||
    plan.applications.add.length > 0 ||
    (plan.profile !== null && plan.profile.action !== 'same') ||
    plan.decks.some((entry) => entry.action !== 'same') ||
    plan.exercises.added + plan.exercises.updated + plan.stories.added + plan.stories.updated + plan.companies.added > 0
  )
}

// ---------- Small helpers ----------

type Row = Record<string, unknown>

function isRow(value: unknown): value is Row {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function text(row: Row, key: string): string {
  const value = row[key]
  return typeof value === 'string' ? value.trim() : ''
}

function isoOrNull(value: unknown): string | null {
  if (typeof value !== 'string' && typeof value !== 'number') return null
  const ms = toMillis(value)
  return ms === null ? null : toIso(ms)
}

/** A short stable hash (two FNV-1a passes), so the same old row always gets the same id. */
export function stableHash(input: string): string {
  let a = 0x811c9dc5
  let b = 0x9e3779b9
  for (let index = 0; index < input.length; index += 1) {
    const code = input.charCodeAt(index)
    a = Math.imul(a ^ code, 0x01000193)
    b = Math.imul(b ^ code, 0x5bd1e995)
  }
  return (a >>> 0).toString(16).padStart(8, '0') + (b >>> 0).toString(16).padStart(8, '0')
}

function parseJsonl(file: SourceFile, problems: Finding[]): { line: number; row: Row }[] {
  const rows: { line: number; row: Row }[] = []
  file.text
    .replace(/^\uFEFF/, '')
    .split(/\r?\n/)
    .forEach((raw, index) => {
      if (raw.trim() === '') return
      try {
        const value: unknown = JSON.parse(raw)
        if (isRow(value)) rows.push({ line: index + 1, row: value })
        else problems.push({ file: file.path, line: index + 1, message: 'Not a JSON object, so it was skipped.' })
      } catch {
        problems.push({ file: file.path, line: index + 1, message: 'Not valid JSON, so it was skipped.' })
      }
    })
  return rows
}

function parseJson(file: SourceFile, problems: Finding[]): unknown {
  try {
    return JSON.parse(file.text.replace(/^\uFEFF/, ''))
  } catch {
    problems.push({ file: file.path, message: 'Not valid JSON, so the file was skipped.' })
    return undefined
  }
}

function inferAts(url: string, given: string): Job['ats'] {
  let host = ''
  try {
    host = new URL(url).hostname.toLowerCase()
  } catch {
    // Not a URL: fall back to what the row says.
  }
  if (host.endsWith('greenhouse.io')) return 'greenhouse'
  if (host.endsWith('ashbyhq.com')) return 'ashby'
  if (host.endsWith('lever.co')) return 'lever'
  if (host.endsWith('myworkdayjobs.com')) return 'workday'
  return given === 'greenhouse' || given === 'ashby' || given === 'lever' || given === 'workday' ? given : undefined
}

const CHANNELS: Record<string, Application['channel']> = {
  linkedin_easy_apply: 'easy_apply',
  easy_apply: 'easy_apply',
  direct_career_page: 'company_site',
  company_site: 'company_site',
  referral: 'referral',
  email: 'email',
}

function channelFor(source: string, url: string): Application['channel'] {
  return CHANNELS[source.toLowerCase()] ?? (inferAts(url, '') ? 'ats' : 'unknown')
}

const CLOSED: readonly AppStatus[] = ['rejected', 'ghosted', 'withdrawn']

function queueStatusForApplication(status: AppStatus): QueueStatus {
  return CLOSED.includes(status) ? 'archived' : 'shortlisted'
}

function joinNotes(...parts: (string | undefined)[]): string | undefined {
  const kept = parts.map((part) => part?.trim()).filter((part): part is string => Boolean(part))
  return kept.length > 0 ? kept.join('\n\n') : undefined
}

function tally(mapping: Map<string, StatusMapping>, domain: StatusMapping['domain'], from: string, to: string) {
  const key = `${domain}\u0000${from}\u0000${to}`
  const entry = mapping.get(key)
  if (entry) entry.count += 1
  else mapping.set(key, { domain, from, to, count: 1 })
}

function describe(row: { company: string; title: string }): string {
  return `${row.title} at ${row.company}`
}

type Posting = Pick<Job, 'company' | 'title' | 'url'>

/**
 * The first posting in `seen` that is the same job, and how it matched. Unlike the engine's
 * findDuplicate, a shared URL counts only when the company matches too: job-hunter's LLM often
 * saved a search results page as the link, so different companies share one URL.
 */
function matchPosting<T extends Posting>(
  posting: Posting,
  seen: readonly T[],
  searchPages: ReadonlySet<string> = new Set(),
): { reason: 'url' | 'company and title'; match: T } | null {
  const url = posting.url && !searchPages.has(urlKey(posting.url)) ? urlKey(posting.url) : ''
  const company = normalizeCompany(posting.company)
  const byUrl = url ? seen.find((other) => other.url && urlKey(other.url) === url && normalizeCompany(other.company) === company) : undefined
  if (byUrl) return { reason: 'url', match: byUrl }
  const key = companyTitleKey(posting.company, posting.title)
  const byKey = seen.find((other) => companyTitleKey(other.company, other.title) === key)
  return byKey ? { reason: 'company and title', match: byKey } : null
}

// ---------- job-hunter's own files ----------

interface ImportedJob {
  job: Job
  line: number
  /** The queue status job-hunter had, before mapping. */
  rawStatus: string
}

function mapQueue(file: SourceFile, now: Date, out: { mapping: Map<string, StatusMapping>; problems: Finding[]; duplicates: Finding[] }) {
  const candidates: (ImportedJob & { scored: boolean })[] = []
  for (const { line, row } of parseJsonl(file, out.problems)) {
    const company = text(row, 'company')
    const title = text(row, 'title')
    if (!company || !title) {
      out.problems.push({ file: file.path, line, message: 'No company or title, so it was skipped.' })
      continue
    }
    const url = text(row, 'url')
    const rawStatus = text(row, 'status') || 'queued'
    let status = normalizeStatus(rawStatus, 'queue')
    if (status === null) {
      out.problems.push({ file: file.path, line, message: `Unknown status "${rawStatus}" for ${describe({ company, title })}; imported as queued.` })
      status = 'queued'
    }
    const postedAt = isoOrNull(row.posted_at)
    const snippet = text(row, 'description_snippet')
    const location = text(row, 'location')
    const source = text(row, 'source')
    const job: Job = {
      id: text(row, 'id') || `jh-job-${stableHash(`${companyTitleKey(company, title)}|${url}`)}`,
      source: 'job-hunter-import',
      company,
      title,
      location,
      workplace: detectWorkplace(location, title, snippet),
      url,
      postedAt,
      postedAtSource: postedAt ? 'api' : 'unknown',
      discoveredAt: isoOrNull(row.discovered_at) ?? toIso(now.getTime()),
      status,
      notes: joinNotes(text(row, 'notes'), source ? `Imported from job-hunter (source: ${source}).` : 'Imported from job-hunter.'),
    }
    const ats = inferAts(url, text(row, 'ats'))
    if (ats) job.ats = ats
    if (snippet) job.jdText = snippet
    candidates.push({ job, line, rawStatus, scored: row.score !== null && row.score !== undefined })
  }

  const searchPages = sharedLinks(candidates)
  for (const lines of searchPages.values()) {
    out.problems.push({
      file: file.path,
      line: lines[0],
      message: `${lines.length} postings at different companies share one link (lines ${lines.join(', ')}), so it is probably a search page. They were imported; open each posting and save its own link.`,
    })
  }

  const accepted: ImportedJob[] = []
  let scoresDropped = 0
  for (const { scored, ...entry } of candidates) {
    const earlier = accepted.find((other) => other.job.id === entry.job.id) ?? findDuplicateEntry(entry.job, accepted, new Set(searchPages.keys()))
    if (earlier) {
      out.duplicates.push({ file: file.path, line: entry.line, message: `Same posting as line ${earlier.line} (${describe(entry.job)}), so it was skipped.` })
      continue
    }
    if (scored) scoresDropped += 1
    tally(out.mapping, 'queue', entry.rawStatus, entry.job.status)
    accepted.push(entry)
  }
  return { accepted, scoresDropped }
}

/** Links shared by postings at different companies (search pages, not postings), with the lines that use them. */
function sharedLinks(entries: readonly ImportedJob[]): Map<string, number[]> {
  const byUrl = new Map<string, ImportedJob[]>()
  for (const entry of entries) {
    if (!entry.job.url) continue
    const key = urlKey(entry.job.url)
    byUrl.set(key, [...(byUrl.get(key) ?? []), entry])
  }
  const shared = new Map<string, number[]>()
  for (const [key, group] of byUrl) {
    if (new Set(group.map((entry) => normalizeCompany(entry.job.company))).size > 1) shared.set(key, group.map((entry) => entry.line))
  }
  return shared
}

function findDuplicateEntry(job: Posting, entries: readonly ImportedJob[], searchPages?: ReadonlySet<string>): ImportedJob | undefined {
  const match = matchPosting(job, entries.map((entry) => entry.job), searchPages)
  return match ? entries.find((entry) => entry.job === match.match) : undefined
}

interface ApplicationContext {
  file: SourceFile
  now: Date
  imported: ImportedJob[]
  existingJobs: readonly Job[]
  mapping: Map<string, StatusMapping>
  findings: Pick<ImportPlan, 'setAside' | 'mismatches' | 'duplicates' | 'problems'>
}

function mapApplications({ file, now, imported, existingJobs, mapping, findings }: ApplicationContext) {
  const applications: { app: Application; line: number }[] = []
  const created: Job[] = []
  for (const { line, row } of parseJsonl(file, findings.problems)) {
    const company = text(row, 'company')
    const title = text(row, 'title')
    const appliedAt = isoOrNull(row.applied_at)
    const rawStatus = text(row, 'status')
    if (!rawStatus && !appliedAt) {
      const what = company && title ? ` for ${describe({ company, title })}` : ''
      findings.setAside.push({ file: file.path, line, message: `A tailoring log${what}, not an application. Left out.` })
      continue
    }
    if (!company || !title) {
      findings.problems.push({ file: file.path, line, message: 'No company or title, so it was skipped.' })
      continue
    }
    const from = rawStatus || 'applied'
    let status = normalizeStatus(from, 'application')
    if (status === null) {
      if (!appliedAt) {
        findings.setAside.push({ file: file.path, line, message: `Unknown status "${from}" and no applied date for ${describe({ company, title })}. Left out.` })
        continue
      }
      findings.problems.push({ file: file.path, line, message: `Unknown status "${from}" for ${describe({ company, title })}; imported as applied, since it has an applied date.` })
      status = 'applied'
    }
    tally(mapping, 'application', from, status)

    const url = text(row, 'url')
    const submitted = status !== 'draft' && status !== 'prepared'
    const at = appliedAt ?? isoOrNull(row.attempted_at) ?? isoOrNull(row.tailored_at) ?? toIso(now.getTime())
    if (submitted && !appliedAt) {
      findings.problems.push({ file: file.path, line, message: `${describe({ company, title })} has no applied date. Add it in Shortlist so follow-ups can be scheduled.` })
    }

    const posting = { company, title, url }
    const job = linkJob(posting, status, { at, line, file, imported, existingJobs, created, findings })
    const history: Application['history'] = submitted
      ? [{ status: 'applied', at, by: 'import' }, ...(status === 'applied' ? [] : [{ status, at, by: 'import' as const }])]
      : [{ status, at, by: 'import' }]
    const app: Application = {
      id: `jh-app-${stableHash(`${companyTitleKey(company, title)}|${appliedAt ?? `line ${line}`}`)}`,
      jobId: job.id,
      company,
      title,
      url,
      status,
      history,
      channel: channelFor(text(row, 'source'), url),
      notes: joinNotes(text(row, 'notes'), 'Imported from job-hunter.'),
    }
    if (submitted && appliedAt) app.appliedAt = appliedAt
    const resume = text(row, 'resume')
    if (resume) app.resumeVersion = resume.split(/[\\/]/).pop()

    const twin = applications.find((entry) => entry.app.id === app.id)
    if (twin) {
      findings.duplicates.push({ file: file.path, line, message: `Same application as line ${twin.line} (${describe(app)}), so it was skipped.` })
      continue
    }
    const repeat = applications.find((entry) => companyTitleKey(entry.app.company, entry.app.title) === companyTitleKey(company, title))
    if (repeat) {
      findings.duplicates.push({ file: file.path, line, message: `Applied to ${describe(app)} again (first on line ${repeat.line}). Both are kept.` })
    }
    applications.push({ app, line })
  }
  return { applications: applications.map((entry) => entry.app), created }
}

interface LinkContext {
  at: string
  line: number
  file: SourceFile
  imported: ImportedJob[]
  existingJobs: readonly Job[]
  created: Job[]
  findings: Pick<ImportPlan, 'mismatches'>
}

/** The job an application belongs to: one from the queue, one already in Shortlist, or a new one. */
function linkJob(posting: Pick<Job, 'company' | 'title' | 'url'>, status: AppStatus, context: LinkContext): Job {
  const queued = findDuplicateEntry(posting, context.imported)
  if (queued) {
    const submitted = status !== 'draft' && status !== 'prepared'
    if (submitted && normalizeStatus(queued.rawStatus, 'application') !== 'applied') {
      const wanted = queueStatusForApplication(status)
      context.findings.mismatches.push({
        file: context.file.path,
        line: context.line,
        message: `Applied on ${context.at.slice(0, 10)}, but job-hunter's queue (line ${queued.line}) still says "${queued.rawStatus}". The job is imported as ${wanted}.`,
      })
      queued.job.status = wanted
    }
    return queued.job
  }
  const existing = matchPosting(posting, context.existingJobs)
  if (existing) return existing.match
  const id = `jh-job-${stableHash(posting.url ? urlKey(posting.url) : companyTitleKey(posting.company, posting.title))}`
  const known = context.created.find((job) => job.id === id)
  if (known) return known
  const job: Job = {
    id,
    source: 'job-hunter-import',
    company: posting.company,
    title: posting.title,
    location: '',
    workplace: 'unknown',
    url: posting.url,
    postedAt: null,
    postedAtSource: 'unknown',
    discoveredAt: context.at,
    status: queueStatusForApplication(status),
    notes: "Created from job-hunter's application log; the posting was not in its queue.",
  }
  const ats = inferAts(posting.url, '')
  if (ats) job.ats = ats
  context.created.push(job)
  return job
}

// ---------- copilot-data files (already in the contract's shapes) ----------

const WORKPLACES: readonly Workplace[] = ['remote', 'hybrid', 'onsite', 'unknown']
const CARD_KINDS: readonly CardKind[] = ['concept', 'explain', 'design', 'behavioral', 'code', 'dsa', 'system-design', 'ai-workflow']

const isStringArray = (value: unknown): value is string[] => Array.isArray(value) && value.every((item) => typeof item === 'string')

function strings(row: Row, keys: readonly string[]): boolean {
  return keys.every((key) => typeof row[key] === 'string' && (row[key] as string).trim() !== '')
}

function leadJob(row: Row): Job | null {
  if (!strings(row, ['id', 'company', 'title', 'discoveredAt']) || typeof row.url !== 'string') return null
  const status = typeof row.status === 'string' ? normalizeStatus(row.status, 'queue') : 'queued'
  if (status === null || !(QUEUE_STATUSES as readonly string[]).includes(status)) return null
  const job = { ...row, status } as unknown as Job
  if (!WORKPLACES.includes(job.workplace)) job.workplace = 'unknown'
  if (job.postedAt === undefined) job.postedAt = null
  if (!['api', 'manual', 'search-snippet', 'unknown'].includes(job.postedAtSource)) job.postedAtSource = 'unknown'
  if (typeof job.location !== 'string') job.location = ''
  if (typeof job.source !== 'string') job.source = 'job-hunter-import'
  return job
}

function cardProblem(card: unknown): string | null {
  if (!isRow(card)) return 'a card is not an object'
  if (!strings(card, ['id', 'prompt', 'answer'])) return `card ${String(card.id ?? '(no id)')} needs an id, a prompt and an answer`
  if (card.kind === undefined) return `card ${card.id} has no kind`
  if (!CARD_KINDS.includes(card.kind as CardKind)) return `card ${card.id} has an unknown kind "${String(card.kind)}"`
  if (!isStringArray(card.keyPoints) || !isStringArray(card.tags)) return `card ${card.id} needs keyPoints and tags lists`
  if (card.difficulty !== 1 && card.difficulty !== 2 && card.difficulty !== 3) return `card ${card.id} needs a difficulty of 1, 2 or 3`
  return null
}

function readDeck(file: SourceFile, problems: Finding[]): PracticeDeck | null {
  const value = parseJson(file, problems)
  if (value === undefined) return null
  if (!isRow(value) || !strings(value, ['id', 'title']) || !Array.isArray(value.cards)) {
    problems.push({ file: file.path, message: 'Not a practice deck (it needs an id, a title and cards), so it was skipped.' })
    return null
  }
  if (!isFileId(value.id as string)) {
    problems.push({ file: file.path, message: `The deck id "${String(value.id)}" can't be used as a file name, so it was skipped.` })
    return null
  }
  const cards: PracticeCard[] = []
  for (const card of value.cards) {
    const problem = cardProblem(card)
    if (problem) problems.push({ file: file.path, message: `Left out one card: ${problem}.` })
    else cards.push(card as PracticeCard)
  }
  return { ...(value as unknown as PracticeDeck), description: typeof value.description === 'string' ? value.description : '', cards }
}

function readList<T extends { id: string }>(
  files: readonly SourceFile[],
  valid: (item: Row) => boolean,
  noun: string,
  plan: ImportPlan,
): T[] {
  const items: T[] = []
  for (const file of files) {
    const value = parseJson(file, plan.problems)
    if (value === undefined) continue
    if (!Array.isArray(value)) {
      plan.problems.push({ file: file.path, message: `Expected a list of ${noun === "story" ? "stories" : `${noun}s`}, so the file was skipped.` })
      continue
    }
    let accepted = 0
    value.forEach((item, index) => {
      if (!isRow(item) || !valid(item)) {
        plan.problems.push({ file: file.path, message: `Item ${index + 1} is not a complete ${noun}, so it was skipped.` })
      } else if (items.some((other) => other.id === item.id)) {
        plan.duplicates.push({ file: file.path, message: `The ${noun} "${String(item.id)}" appears more than once; the first copy is kept.` })
      } else {
        items.push(item as unknown as T)
        accepted += 1
      }
    })
    plan.found.push({ file: file.path, items: accepted })
  }
  return items
}

const validExercise = (item: Row) =>
  strings(item, ['id', 'title', 'goal', 'spec']) && isStringArray(item.acceptance) && typeof item.timeboxMinutes === 'number' && item.timeboxMinutes > 0
const validStory = (item: Row) =>
  strings(item, ['id', 'title', 'situation', 'task', 'action', 'result', 'source']) && isStringArray(item.skills) && isStringArray(item.questions)

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)

function mergeById<T extends { id: string }>(existing: readonly T[], incoming: readonly T[]): { merged: T[]; added: number; updated: number } {
  const byId = new Map(incoming.map((item) => [item.id, item]))
  let updated = 0
  const merged = existing.map((item) => {
    const replacement = byId.get(item.id)
    if (!replacement) return item
    byId.delete(item.id)
    if (same(item, replacement)) return item
    updated += 1
    return replacement
  })
  const added = [...byId.values()]
  return { merged: [...merged, ...added], added: added.length, updated }
}

function readProfile(file: SourceFile, problems: Finding[]): Profile | null {
  const value = parseJson(file, problems)
  if (value === undefined) return null
  const shaped =
    isRow(value) &&
    strings(value, ['name']) &&
    ['links', 'location', 'authorization', 'targeting', 'coverLetter'].every((key) => isRow(value[key])) &&
    ['education', 'experience', 'projects', 'skills', 'answers', 'facts'].every((key) => Array.isArray(value[key]))
  if (!shaped) {
    problems.push({ file: file.path, message: 'Not a complete profile, so it was skipped.' })
    return null
  }
  return value as unknown as Profile
}

// ---------- Putting it together ----------

export function planImport(source: JobHunterSource, existing: ExistingData, { now }: { now: Date }): ImportPlan {
  const plan: ImportPlan = {
    found: [],
    jobs: { add: [], already: 0, fromApplications: 0, scoresDropped: 0 },
    applications: { add: [], already: 0 },
    statusMapping: [],
    setAside: [],
    mismatches: [],
    duplicates: [],
    problems: [],
    profile: null,
    decks: [],
    exercises: { merged: existing.exercises, added: 0, updated: 0 },
    stories: { merged: existing.stories, added: 0, updated: 0 },
    companies: { merged: existing.companies, added: 0 },
  }
  const mapping = new Map<string, StatusMapping>()
  const existingJobIds = new Set(existing.jobs.map((job) => job.id))
  const count = (file: SourceFile | undefined, items: number) => {
    if (file) plan.found.push({ file: file.path, items })
  }

  // Old queue, then old applications (which link to the queue's jobs).
  let imported: ImportedJob[] = []
  if (source.queue) {
    const queue = mapQueue(source.queue, now, { mapping, problems: plan.problems, duplicates: plan.duplicates })
    imported = queue.accepted
    plan.jobs.scoresDropped = queue.scoresDropped
    count(source.queue, queue.accepted.length)
  }
  let applications: Application[] = []
  let created: Job[] = []
  if (source.applications) {
    const mapped = mapApplications({ file: source.applications, now, imported, existingJobs: existing.jobs, mapping, findings: plan })
    applications = mapped.applications
    created = mapped.created
    count(source.applications, applications.length)
  }

  // Job leads in the contract's shape.
  const leads: Job[] = []
  for (const file of source.jobs) {
    let accepted = 0
    for (const { line, row } of parseJsonl(file, plan.problems)) {
      const job = leadJob(row)
      if (!job) {
        plan.problems.push({ file: file.path, line, message: 'Not a complete job (id, company, title, url, status, discoveredAt), so it was skipped.' })
        continue
      }
      const earlier = matchPosting(job, [...imported.map((entry) => entry.job), ...created, ...leads])
      if (earlier) {
        plan.duplicates.push({ file: file.path, line, message: `${describe(job)} is already in this import, so it was skipped.` })
        continue
      }
      leads.push(job)
      accepted += 1
    }
    count(file, accepted)
  }

  for (const job of [...imported.map((entry) => entry.job), ...created, ...leads]) {
    if (existingJobIds.has(job.id)) {
      plan.jobs.already += 1
      continue
    }
    const match = matchPosting(job, existing.jobs)
    if (match) {
      plan.jobs.already += 1
      plan.duplicates.push({ message: `${describe(job)} matches a job already in Shortlist (same ${match.reason === 'url' ? 'link' : 'company and title'}), so it was skipped.` })
      continue
    }
    plan.jobs.add.push(job)
    if (created.includes(job)) plan.jobs.fromApplications += 1
  }
  // An application must point at a job that will exist; a skipped duplicate keeps Shortlist's own id.
  const keptIds = new Set([...existingJobIds, ...plan.jobs.add.map((job) => job.id)])
  const existingAppIds = new Set(existing.applications.map((app) => app.id))
  for (const app of applications) {
    if (existingAppIds.has(app.id)) {
      plan.applications.already += 1
      continue
    }
    if (!keptIds.has(app.jobId)) {
      const match = matchPosting(app, existing.jobs)
      if (match) app.jobId = match.match.id
    }
    plan.applications.add.push(app)
  }
  plan.statusMapping = [...mapping.values()]

  // The copilot-data files.
  if (source.profile) {
    const profile = readProfile(source.profile, plan.problems)
    if (profile) {
      plan.profile = { action: existing.profile === null ? 'add' : same(existing.profile, profile) ? 'same' : 'update', profile }
      count(source.profile, 1)
    }
  }

  const otherDecks = existing.decks.filter((deck) => !source.decks.some((file) => file.path.endsWith(`/${deck.id}.json`)))
  const cardOwner = new Map<string, string>()
  for (const deck of otherDecks) for (const card of deck.cards) cardOwner.set(card.id, deck.id)
  for (const file of source.decks) {
    const deck = readDeck(file, plan.problems)
    if (!deck) continue
    if (plan.decks.some((entry) => entry.deck.id === deck.id)) {
      plan.duplicates.push({ file: file.path, message: `Another file already has the deck id "${deck.id}", so this one was skipped.` })
      continue
    }
    for (const card of deck.cards) {
      const owner = cardOwner.get(card.id)
      if (owner && owner !== deck.id) plan.duplicates.push({ file: file.path, message: `Card "${card.id}" is also in the deck "${owner}". Card ids must be unique, so only one copy is reviewed.` })
      cardOwner.set(card.id, deck.id)
    }
    const current = existing.decks.find((candidate) => candidate.id === deck.id)
    plan.decks.push({ action: current === undefined ? 'add' : same(current, deck) ? 'same' : 'update', deck })
    count(file, deck.cards.length)
  }

  plan.exercises = mergeById(existing.exercises, readList<Exercise>(source.exercises, validExercise, 'exercise', plan))
  plan.stories = mergeById(existing.stories, readList<StarStory>(source.stories, validStory, 'story', plan))

  if (source.companies) {
    const value = parseJson(source.companies, plan.problems)
    const incoming = Array.isArray(value)
      ? value.filter((item): item is Company => isRow(item) && strings(item, ['name']) && typeof item.verified === 'boolean' && ['greenhouse', 'ashby', 'lever', 'manual'].includes(item.ats as string))
      : []
    if (value !== undefined && !Array.isArray(value)) plan.problems.push({ file: source.companies.path, message: 'Expected a list of companies, so the file was skipped.' })
    if (Array.isArray(value) && incoming.length < value.length) {
      plan.problems.push({ file: source.companies.path, message: `${value.length - incoming.length} companies need a name, an ats (greenhouse, ashby, lever or manual) and verified, so they were skipped.` })
    }
    const known = new Set(existing.companies.map((company) => normalizeCompany(company.name)))
    const added = incoming.filter((company) => {
      const key = normalizeCompany(company.name)
      if (known.has(key)) return false
      known.add(key)
      return true
    })
    plan.companies = { merged: [...existing.companies, ...added], added: added.length }
    count(source.companies, incoming.length)
  }

  for (const findings of [plan.setAside, plan.mismatches, plan.duplicates, plan.problems]) findings.sort(byPlace)
  return plan
}

/** Findings in file order, then line order; findings without a file come last. */
function byPlace(a: Finding, b: Finding): number {
  if (a.file !== b.file) return a.file === undefined ? 1 : b.file === undefined ? -1 : a.file < b.file ? -1 : 1
  return (a.line ?? 0) - (b.line ?? 0)
}
