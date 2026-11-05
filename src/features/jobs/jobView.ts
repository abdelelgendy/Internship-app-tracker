import { HOUR_MS, toIso, toMillis, type Instant } from '../../engine/dates.ts'
import { findDuplicate, ghostReason } from '../../engine/dedup.ts'
import { recencyGate } from '../../engine/gates.ts'
import { extractFacts } from '../../engine/facts.ts'
import { detectWorkplace, looksLikeSoftwareTitle, phraseRegex } from '../../engine/normalize.ts'
import { factsFor, scoreJob } from '../../engine/score.ts'
import { indexProfileSkills, profileLevelFor } from '../../engine/skills.ts'
import type { Job, JobFacts, Profile, ScoreResult, SkillLevel } from '../../engine/types.ts'

/**
 * How the Jobs, Today and apply pages read a posting. Scores are always computed with the
 * current rubric and clock: a stored score's recency gate goes stale as the posting ages.
 */

/** The current score, or null when there is no profile to score against and nothing stored. */
export function scoreFor(job: Job, profile: Profile | null, now: Instant): ScoreResult | null {
  if (profile) return scoreJob(job, profile, now)
  if (!job.score) return null
  // Without a profile only the gate can be refreshed; a disqualified score stays as stored.
  if (job.score.tier === null) return job.score
  return { ...job.score, gate: recencyGate(job.score.total, job.postedAt, now, job.company, { verified: job.verified }) }
}

export interface Duplicate {
  reason: 'url' | 'company_title'
  original: Job
}

function discoveredOrder(a: Job, b: Job): number {
  return (toMillis(a.discoveredAt) ?? 0) - (toMillis(b.discoveredAt) ?? 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
}

/**
 * The posting this one repeats, by the engine's rules (a matching URL beats a matching company
 * and title). A job marked as a duplicate names what it repeats. Any other job only counts as a
 * repeat of one found earlier, and not of one that was itself marked as the repeat.
 */
export function duplicateOf(job: Job, jobs: readonly Job[]): Duplicate | null {
  const others = jobs.filter((other) => other.id !== job.id)
  const pool =
    job.status === 'skipped_duplicate'
      ? others
      : others.filter((other) => discoveredOrder(other, job) < 0 && other.status !== 'skipped_duplicate')
  const hit = findDuplicate(job, pool)
  const original = hit ? pool.find((other) => other === hit.match) : undefined
  return hit && original ? { reason: hit.reason, original } : null
}

/** Why a posting looks like a ghost job, using the facts read from its description. */
export function ghostFor(job: Job, jobs: readonly Job[]): string | null {
  return ghostReason(
    { ...job, facts: factsFor(job) },
    jobs.filter((other) => other.id !== job.id),
  )
}

const TIER_MEANING = { 1: 'Entry level', 2: 'Some experience, or not stated', 3: 'A stretch' } as const

export function tierLabel(tier: ScoreResult['tier']): string {
  return tier === null ? 'Disqualified' : `Tier ${tier}`
}

export function tierMeaning(tier: ScoreResult['tier']): string {
  return tier === null ? 'A dealbreaker rules it out' : TIER_MEANING[tier]
}

/** True when the score says to apply now. */
export function passesGate(score: ScoreResult | null): boolean {
  return score?.gate.verdict === 'apply'
}

// ---------- Adding a job by hand ----------

const ATS_HOSTS: [RegExp, NonNullable<Job['ats']>][] = [
  [/(?:^|\.)greenhouse\.io$/, 'greenhouse'],
  [/(?:^|\.)ashbyhq\.com$/, 'ashby'],
  [/(?:^|\.)lever\.co$/, 'lever'],
  [/(?:^|\.)myworkdayjobs\.com$/, 'workday'],
]

/** A posting URL, or null when the text is not an http(s) address. */
export function parsePostingUrl(text: string): URL | null {
  try {
    const url = new URL(text.trim())
    return url.protocol === 'https:' || url.protocol === 'http:' ? url : null
  } catch {
    return null
  }
}

export function atsFromUrl(url: URL): NonNullable<Job['ats']> {
  const host = url.hostname.toLowerCase()
  return ATS_HOSTS.find(([pattern]) => pattern.test(host))?.[1] ?? 'other'
}

function titleCase(slug: string): string {
  return slug
    .split(/[-_]+/)
    .filter(Boolean)
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(' ')
}

/** The company named in a job board URL (boards.greenhouse.io/<company>/...), when the board puts it there. */
export function companyFromUrl(url: URL): string | null {
  const ats = atsFromUrl(url)
  const first = url.pathname.split('/').filter(Boolean)[0]
  if ((ats === 'greenhouse' || ats === 'ashby' || ats === 'lever') && first && first !== 'embed') return titleCase(first)
  if (ats === 'workday') return titleCase(url.hostname.split('.')[0])
  return null
}

/** The first line of pasted text, when it reads like a software job title rather than a sentence. */
export function titleFromText(text: string): string | null {
  const first = text
    .split('\n')
    .map((line) => line.trim())
    .find(Boolean)
  if (!first || first.length > 80 || /[.!?]$/.test(first) || first.split(/\s+/).length > 8) return null
  return looksLikeSoftwareTitle(first) ? first : null
}

const RELATIVE_POSTED = /\bposted\s+(?:about\s+)?(\d+)\+?\s*(minute|hour|day|week)s?\s+ago\b/i
const UNIT_HOURS = { minute: 1 / 60, hour: 1, day: 24, week: 168 } as const

/** A posting time from text such as "Posted 3 days ago" or "Posted today", or null. */
export function postedFromText(text: string, now: Instant): string | null {
  const nowMs = toMillis(now)
  if (nowMs === null) return null
  const relative = text.match(RELATIVE_POSTED)
  if (relative) {
    const unit = relative[2].toLowerCase() as keyof typeof UNIT_HOURS
    return toIso(nowMs - Number(relative[1]) * UNIT_HOURS[unit] * HOUR_MS)
  }
  // "Today" could be any time today; the start of the 12-hour band is the honest guess.
  if (/\bposted\s+(?:today|just now)\b/i.test(text)) return toIso(nowMs - HOUR_MS)
  if (/\bposted\s+yesterday\b/i.test(text)) return toIso(nowMs - 24 * HOUR_MS)
  return null
}

export interface ManualJobInput {
  id: string
  url: string
  title: string
  company: string
  location: string
  postedAt: string | null
  jdText: string
}

/** A job added by hand from a URL and pasted text: facts extracted now, score and status left to the caller. */
export function manualJob(input: ManualJobInput, now: Instant): Job {
  const url = parsePostingUrl(input.url)
  const title = input.title.trim()
  const location = input.location.trim()
  const jdText = input.jdText.trim()
  return {
    id: input.id,
    source: 'manual',
    ats: url ? atsFromUrl(url) : 'other',
    company: input.company.trim(),
    title,
    location,
    workplace: detectWorkplace(location, title, jdText),
    url: url ? url.toString() : input.url.trim(),
    postedAt: input.postedAt,
    postedAtSource: input.postedAt ? 'manual' : 'unknown',
    discoveredAt: toIso(toMillis(now) ?? Date.now()),
    // A person pasted it from the posting, so it is real and open as of now.
    verified: true,
    jdText,
    facts: extractFacts(jdText, title, location),
    status: 'queued',
  }
}

// ---------- Reading a posting ----------

export interface SkillMention {
  name: string
  level: SkillLevel | null
  preferred: boolean
}

/** The posting's skills with your level for each, required ones first. */
export function skillMentions(facts: JobFacts, profile: Profile | null): SkillMention[] {
  const index = profile ? indexProfileSkills(profile.skills) : []
  const preferred = new Set(facts.preferredSkills ?? [])
  return (facts.skills ?? [])
    .map((name) => ({ name, level: profile ? profileLevelFor(index, name) : null, preferred: preferred.has(name) }))
    .sort((a, b) => Number(a.preferred) - Number(b.preferred))
}

export interface TextSegment {
  text: string
  /** The skill this run of text names, when it is one you list as strong or working. */
  skill?: string
}

/**
 * Splits a description into plain runs and runs that name one of your strong or working skills,
 * so the page can mark them. Skills are found by their usual name, with the engine's rule that a
 * capitalized name only matches capitalized ("React", not "react to"); other spellings stay plain.
 */
export function markSkills(text: string, skills: readonly SkillMention[]): TextSegment[] {
  const ranges: { start: number; end: number; skill: string }[] = []
  for (const skill of skills) {
    if (skill.level !== 'strong' && skill.level !== 'working') continue
    const single = phraseRegex(skill.name, /[A-Z]/.test(skill.name))
    for (const match of text.matchAll(new RegExp(single.source, `${single.flags}g`))) {
      const start = match.index ?? 0
      ranges.push({ start, end: start + match[0].length, skill: skill.name })
    }
  }
  // Earliest first; on a tie the longer name wins, and overlapping runs are dropped.
  ranges.sort((a, b) => a.start - b.start || b.end - a.end)
  const segments: TextSegment[] = []
  let last = 0
  for (const range of ranges) {
    if (range.start < last) continue
    if (range.start > last) segments.push({ text: text.slice(last, range.start) })
    segments.push({ text: text.slice(range.start, range.end), skill: range.skill })
    last = range.end
  }
  if (last < text.length || segments.length === 0) segments.push({ text: text.slice(last) })
  return segments
}
