import { normalizeCompany, normalizeTitle } from './normalize.ts'
import type { Job } from './types.ts'

/**
 * Duplicate and repost detection. Keys keep the level in the title, so "Software Engineer
 * Intern" and "Software Engineer" at the same company stay two jobs (the old scanner merged them).
 */

// Query parameters that only track where a click came from. Job ids such as gh_jid are kept.
const TRACKING_PARAMS = new Set([
  'ref', 'refid', 'referrer', 'source', 'src', 'trk', 'trackingid', 'gh_src', 'lever-source',
  'lever-origin', 'fbclid', 'gclid', 'mc_cid', 'mc_eid', '_hsenc', '_hsmi', 'ccuid', 'utm',
])

/**
 * A stable key for a posting URL: https, lowercase host without "www.", no fragment, no tracking
 * parameters, remaining parameters sorted, no trailing slash. Path case is kept, since some
 * boards use case-sensitive ids. Text that is not a URL is returned trimmed and lowercased.
 */
export function urlKey(url: string): string {
  let parsed: URL
  try {
    parsed = new URL(url.trim())
  } catch {
    return url.trim().toLowerCase()
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return url.trim().toLowerCase()
  const host = parsed.hostname.toLowerCase().replace(/^www\./, '')
  const params: [string, string][] = []
  parsed.searchParams.forEach((value, name) => {
    const key = name.toLowerCase()
    if (!key.startsWith('utm_') && !TRACKING_PARAMS.has(key)) params.push([name, value])
  })
  // Plain code-unit order, so the key is the same on every machine and locale.
  const order = (x: string, y: string) => (x < y ? -1 : x > y ? 1 : 0)
  params.sort(([a, av], [b, bv]) => order(a, b) || order(av, bv))
  const query = params.length > 0 ? `?${new URLSearchParams(params).toString()}` : ''
  const path = parsed.pathname.replace(/\/+$/, '')
  return `https://${host}${parsed.port ? `:${parsed.port}` : ''}${path}${query}`
}

/** "company::title" with both normalized and the title's level kept. */
export function companyTitleKey(company: string, title: string): string {
  return `${normalizeCompany(company)}::${normalizeTitle(title)}`
}

type Posting = Pick<Job, 'url' | 'company' | 'title'>

/** Why a posting duplicates one already seen, or null. A matching URL beats a matching company and title. */
export function findDuplicate(posting: Posting, seen: readonly Posting[]): { reason: 'url' | 'company_title'; match: Posting } | null {
  const url = urlKey(posting.url)
  const byUrl = seen.find((other) => urlKey(other.url) === url)
  if (byUrl) return { reason: 'url', match: byUrl }
  const key = companyTitleKey(posting.company, posting.title)
  const byKey = seen.find((other) => companyTitleKey(other.company, other.title) === key)
  return byKey ? { reason: 'company_title', match: byKey } : null
}

/** Reposted this many times (distinct posting days) or more reads as a ghost job. */
export const REPOST_THRESHOLD = 3

/**
 * How many distinct days this company and title have been posted, counting the job itself.
 * Rows without a posting date are not counted, since they say nothing about reposting.
 */
export function repostCount(job: Pick<Job, 'company' | 'title' | 'postedAt'>, history: readonly Pick<Job, 'company' | 'title' | 'postedAt'>[]): number {
  const key = companyTitleKey(job.company, job.title)
  const days = new Set<string>()
  for (const entry of [job, ...history]) {
    if (!entry.postedAt || companyTitleKey(entry.company, entry.title) !== key) continue
    const ms = Date.parse(entry.postedAt)
    if (Number.isFinite(ms)) days.add(new Date(ms).toISOString().slice(0, 10))
  }
  return days.size
}

/** A plain reason when the posting looks like a ghost job (reposted or pipeline wording), else null. */
export function ghostReason(job: Pick<Job, 'company' | 'title' | 'postedAt'> & { facts?: Job['facts'] }, history: readonly Pick<Job, 'company' | 'title' | 'postedAt'>[]): string | null {
  const reposts = repostCount(job, history)
  if (reposts >= REPOST_THRESHOLD) return `Posted on ${reposts} different days, which often means an evergreen posting.`
  const phrase = job.facts?.ghostPhrases?.[0]
  return phrase ? `Says "${phrase}", which often means there is no open role right now.` : null
}
