/**
 * The public job board APIs of Greenhouse, Ashby and Lever: where each board lives, how to read
 * its postings, and which hosts are allowed. Pure: no network (scan.ts passes the fetch in).
 *
 * Every response is untrusted JSON, so each field is checked before it is used, and a posting
 * link that does not point at the board's own host is replaced with the board's canonical link.
 * The old scanner checked links by substring, so "greenhouse.io.example.net" passed.
 */
import type { Company, Job } from '../../src/engine/types.ts'

export type BoardAts = 'greenhouse' | 'ashby' | 'lever'

/** The only hosts the scanner fetches from. */
export const API_HOSTS: Record<BoardAts, string> = {
  greenhouse: 'boards-api.greenhouse.io',
  ashby: 'api.ashbyhq.com',
  lever: 'api.lever.co',
}

/** Hosts a stored posting link may point at, matched exactly or as a subdomain. */
export const POSTING_DOMAINS: Record<BoardAts, readonly string[]> = {
  greenhouse: ['greenhouse.io'],
  ashby: ['ashbyhq.com'],
  lever: ['lever.co'],
}

/** A board token: letters, digits, dots, dashes and underscores, so it can't change the API path. */
const SLUG = /^[A-Za-z0-9][A-Za-z0-9._-]{0,99}$/

export function isBoardAts(ats: Company['ats']): ats is BoardAts {
  return ats === 'greenhouse' || ats === 'ashby' || ats === 'lever'
}

/** True when the host is the domain itself or a subdomain of it, never a look-alike. */
export function hostMatches(host: string, domain: string): boolean {
  const name = host.toLowerCase().replace(/\.$/, '')
  return name === domain || name.endsWith(`.${domain}`)
}

/** An https URL on one of the domains, or null. */
export function allowedUrl(text: string, domains: readonly string[]): URL | null {
  let url: URL
  try {
    url = new URL(text)
  } catch {
    return null
  }
  if (url.protocol !== 'https:' || url.username || url.password || url.port) return null
  return domains.some((domain) => hostMatches(url.hostname, domain)) ? url : null
}

/** The API address for a company's board, or null when it has no usable slug. */
export function boardApiUrl(company: Pick<Company, 'ats' | 'slug'>): string | null {
  if (!isBoardAts(company.ats) || !company.slug || !SLUG.test(company.slug)) return null
  const slug = encodeURIComponent(company.slug)
  switch (company.ats) {
    case 'greenhouse':
      return `https://${API_HOSTS.greenhouse}/v1/boards/${slug}/jobs?content=true`
    case 'ashby':
      return `https://${API_HOSTS.ashby}/posting-api/job-board/${slug}?includeCompensation=true`
    case 'lever':
      return `https://${API_HOSTS.lever}/v0/postings/${slug}?mode=json`
  }
}

/** One posting as a board reports it, before filters and scoring. */
export interface BoardPosting {
  ats: BoardAts
  /** The board's own id for the posting. */
  externalId: string
  company: string
  title: string
  location: string
  /** The board's own remote, hybrid or on-site flag, when it has one. */
  workplace: Job['workplace']
  url: string
  postedAt: string | null
  /** Set when the board gave no first-posted date and only a last-updated one, which edits move. */
  updatedAt?: string
  jdText: string
  salaryText?: string
}

// ---------- Text ----------

const NAMED_ENTITIES: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ndash: '-', mdash: '-', rsquo: "'", lsquo: "'", rdquo: '"', ldquo: '"', hellip: '...', bull: '-' }

export function decodeEntities(text: string): string {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, body: string) => {
    if (body[0] === '#') {
      const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10)
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : entity
    }
    return NAMED_ENTITIES[body.toLowerCase()] ?? entity
  })
}

/** Plain text from a posting's HTML: block tags become line breaks, list items get a dash. */
export function htmlToText(html: string): string {
  return decodeEntities(
    html
      .replace(/<(script|style)\b[\s\S]*?<\/\1\s*>/gi, ' ')
      .replace(/<li\b[^>]*>/gi, '\n- ')
      .replace(/<(br|\/p|\/div|\/li|\/ul|\/ol|\/h[1-6]|\/tr)\b[^>]*>/gi, '\n')
      .replace(/<[^>]*>/g, ' '),
  )
    .split('\n')
    .map((line) => line.replace(/[ \t ]+/g, ' ').trim())
    .filter((line, index, lines) => line !== '' || (index > 0 && lines[index - 1] !== ''))
    .join('\n')
    .trim()
}

// ---------- Field checks ----------

type Row = Record<string, unknown>
const isRow = (value: unknown): value is Row => typeof value === 'object' && value !== null && !Array.isArray(value)
const str = (value: unknown): string => (typeof value === 'string' ? value.trim() : typeof value === 'number' ? String(value) : '')
const MAX_JD_CHARS = 30_000

function isoFrom(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return new Date(value).toISOString()
  if (typeof value !== 'string' || value.trim() === '') return null
  const ms = Date.parse(value)
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null
}

function workplaceFrom(value: unknown): Job['workplace'] {
  const text = str(value).toLowerCase().replace(/[^a-z]/g, '')
  if (text === 'remote') return 'remote'
  if (text === 'hybrid') return 'hybrid'
  if (text === 'onsite' || text === 'inoffice' || text === 'office') return 'onsite'
  return 'unknown'
}

/** The posting's own link when it is on the board's host; otherwise the board's canonical link. */
function postingUrl(ats: BoardAts, given: unknown, canonical: string): string {
  const url = allowedUrl(str(given), POSTING_DOMAINS[ats])
  return url ? url.href : canonical
}

function safeId(value: unknown): string | null {
  const id = str(value)
  return /^[A-Za-z0-9_-]{1,100}$/.test(id) ? id : null
}

// ---------- Parsers ----------

export interface ParseResult {
  postings: BoardPosting[]
  /** Postings left out because a required field was missing or malformed. */
  skipped: number
}

function jobsArray(json: unknown, key: string | null): unknown[] | null {
  if (key === null) return Array.isArray(json) ? json : null
  return isRow(json) && Array.isArray(json[key]) ? json[key] : null
}

/**
 * Greenhouse: GET /v1/boards/<slug>/jobs?content=true. `content` is HTML with its tags
 * entity-escaped. `first_published` is the posting date; `updated_at` moves on any edit, so it
 * is kept only as a hint and the posting date stays unknown.
 */
export function parseGreenhouse(json: unknown, company: Pick<Company, 'name' | 'slug'>): ParseResult | null {
  const jobs = jobsArray(json, 'jobs')
  if (!jobs) return null
  const out: ParseResult = { postings: [], skipped: 0 }
  for (const raw of jobs) {
    const id = isRow(raw) ? safeId(raw.id) : null
    const title = isRow(raw) ? str(raw.title) : ''
    if (!isRow(raw) || !id || !title) {
      out.skipped += 1
      continue
    }
    const location = isRow(raw.location) ? str(raw.location.name) : ''
    const posting: BoardPosting = {
      ats: 'greenhouse',
      externalId: id,
      company: company.name,
      title,
      location,
      workplace: 'unknown',
      url: postingUrl('greenhouse', raw.absolute_url, `https://job-boards.greenhouse.io/${company.slug}/jobs/${id}`),
      postedAt: isoFrom(raw.first_published),
      jdText: htmlToText(decodeEntities(str(raw.content))).slice(0, MAX_JD_CHARS),
    }
    const updated = isoFrom(raw.updated_at)
    if (!posting.postedAt && updated) posting.updatedAt = updated
    out.postings.push(posting)
  }
  return out
}

/** Ashby: GET /posting-api/job-board/<slug>. Unlisted postings are left out. */
export function parseAshby(json: unknown, company: Pick<Company, 'name' | 'slug'>): ParseResult | null {
  const jobs = jobsArray(json, 'jobs')
  if (!jobs) return null
  const out: ParseResult = { postings: [], skipped: 0 }
  for (const raw of jobs) {
    if (isRow(raw) && raw.isListed === false) continue
    const id = isRow(raw) ? safeId(raw.id) : null
    const title = isRow(raw) ? str(raw.title) : ''
    if (!isRow(raw) || !id || !title) {
      out.skipped += 1
      continue
    }
    const workplace = workplaceFrom(raw.workplaceType)
    const plain = str(raw.descriptionPlain)
    const compensation = isRow(raw.compensation) ? str(raw.compensation.compensationTierSummary) : ''
    out.postings.push({
      ats: 'ashby',
      externalId: id,
      company: company.name,
      title,
      location: str(raw.location),
      workplace: workplace === 'unknown' && raw.isRemote === true ? 'remote' : workplace,
      url: postingUrl('ashby', raw.jobUrl, `https://jobs.ashbyhq.com/${company.slug}/${id}`),
      postedAt: isoFrom(raw.publishedAt),
      jdText: (plain || htmlToText(str(raw.descriptionHtml))).slice(0, MAX_JD_CHARS),
      ...(compensation ? { salaryText: compensation } : {}),
    })
  }
  return out
}

/** Lever: GET /v0/postings/<slug>?mode=json, an array. `createdAt` is in milliseconds. */
export function parseLever(json: unknown, company: Pick<Company, 'name' | 'slug'>): ParseResult | null {
  const jobs = jobsArray(json, null)
  if (!jobs) return null
  const out: ParseResult = { postings: [], skipped: 0 }
  for (const raw of jobs) {
    const id = isRow(raw) ? safeId(raw.id) : null
    const title = isRow(raw) ? str(raw.text) : ''
    if (!isRow(raw) || !id || !title) {
      out.skipped += 1
      continue
    }
    const categories = isRow(raw.categories) ? raw.categories : {}
    const lists = Array.isArray(raw.lists)
      ? raw.lists.filter(isRow).map((list) => `${str(list.text)}\n${htmlToText(str(list.content))}`)
      : []
    const body = [str(raw.descriptionPlain) || htmlToText(str(raw.description)), ...lists, str(raw.additionalPlain)].filter(Boolean).join('\n\n')
    out.postings.push({
      ats: 'lever',
      externalId: id,
      company: company.name,
      title,
      location: str(categories.location),
      workplace: workplaceFrom(raw.workplaceType),
      url: postingUrl('lever', raw.hostedUrl, `https://jobs.lever.co/${company.slug}/${id}`),
      postedAt: isoFrom(raw.createdAt),
      jdText: body.slice(0, MAX_JD_CHARS),
    })
  }
  return out
}

export const PARSERS: Record<BoardAts, (json: unknown, company: Pick<Company, 'name' | 'slug'>) => ParseResult | null> = {
  greenhouse: parseGreenhouse,
  ashby: parseAshby,
  lever: parseLever,
}
