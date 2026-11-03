import type { Instant } from './dates.ts'
import { experienceBand, STRETCH_MIN_SCORE } from './experience.ts'
import { extractFacts } from './facts.ts'
import { recencyGate } from './gates.ts'
import {
  detectWorkplace,
  isUsOnlyRemoteLocation,
  looksLikeSoftwareTitle,
  normalizeLocation,
  normalizeText,
  normalizeTitle,
  textMatcher,
  type TextMatcher,
} from './normalize.ts'
import { indexProfileSkills, profileLevelFor, type ProfileSkill } from './skills.ts'
import type { Job, JobFacts, Profile, ScoreResult, SkillLevel } from './types.ts'

/**
 * The fit score, computed in code (the old engine had an LLM write it, and 23 of 29 breakdowns
 * broke a cap). Every point comes from a part with a reason, and the parts always add up to the
 * total: when the raw sum leaves 0-100, a final "Capped" part says by how much.
 */
export const RUBRIC_VERSION = 'shortlist-2026-11-03 (from jh-2026-04-28)'

const TITLE_POINTS = { exact: 20, partial: 15, related: 10, ambiguous: 5 } as const
const SKILL_OVERLAP_BANDS = [
  { minRatio: 0.8, points: 30 },
  { minRatio: 0.6, points: 22 },
  { minRatio: 0.4, points: 15 },
  { minRatio: 0.2, points: 8 },
  { minRatio: 0, points: 3 },
] as const
const LOCATION_POINTS = { remote: 10, inTarget: 10, hybridInTarget: 8, elsewhere: 0 } as const
const TECH_POINTS: Record<SkillLevel, number> = { strong: 3, working: 2, familiar: 1 }
const TECH_CAP = 15
const OTHER = { keyword: 2, keywordCap: 6, industry: 2, companySize: 2, cap: 10 } as const
export const COMPANY_SIZE_PREFER = { min: 10, max: 500 } as const

type Part = ScoreResult['parts'][number]

function part(key: string, label: string, max: number, points: number, reason: string): Part {
  return { key, label, max, points, reason }
}

function listOf(items: readonly string[], limit = 6): string {
  if (items.length <= limit) return items.join(', ')
  return `${items.slice(0, limit).join(', ')} and ${items.length - limit} more`
}

/** Facts stored on the job win; anything missing is extracted from the description. */
export function factsFor(job: Job): JobFacts {
  const extracted = extractFacts(job.jdText ?? '', job.title, job.location)
  const stored = Object.fromEntries(Object.entries(job.facts ?? {}).filter(([, value]) => value !== undefined))
  return { ...extracted, ...stored }
}

// ---------- Parts ----------

function titlePart(title: string, targets: readonly string[]): Part {
  const label = 'Title match'
  const normalized = normalizeTitle(title)
  const entries = targets.map((raw) => ({ raw, norm: normalizeTitle(raw) })).filter((entry) => entry.norm)
  const exact = entries.find((entry) => entry.norm === normalized)
  if (exact) return part('title', label, 20, TITLE_POINTS.exact, `Matches your target title "${exact.raw}".`)
  if (['developer', 'engineer', 'programmer'].includes(normalized)) {
    return part('title', label, 20, TITLE_POINTS.ambiguous, `"${title}" alone is too vague to match a target title.`)
  }
  const words = textMatcher(normalized)
  const partial = entries
    .filter((entry) => words.has(entry.norm) || textMatcher(entry.norm).has(normalized))
    .sort((a, b) => b.norm.length - a.norm.length)[0]
  if (partial) return part('title', label, 20, TITLE_POINTS.partial, `Close to your target title "${partial.raw}".`)
  if (looksLikeSoftwareTitle(title)) {
    return part('title', label, 20, TITLE_POINTS.related, 'A software title that is not on your target list.')
  }
  return part('title', label, 20, 0, 'Not a software title.')
}

function skillsPart(facts: JobFacts, skills: readonly ProfileSkill[]): Part {
  const label = 'Skill overlap'
  // Nice-to-have skills do not count against you; required ones decide the overlap.
  const preferred = new Set(facts.preferredSkills ?? [])
  const jobSkills = (facts.skills ?? []).filter((name) => !preferred.has(name))
  if (jobSkills.length === 0) {
    return part('skills', label, 30, SKILL_OVERLAP_BANDS[4].points, 'No known skills found in the posting, so overlap gets the minimum.')
  }
  const known = jobSkills.filter((name) => {
    const level = profileLevelFor(skills, name)
    return level === 'strong' || level === 'working'
  })
  const missing = jobSkills.filter((name) => !known.includes(name))
  const ratio = known.length / jobSkills.length
  const band = SKILL_OVERLAP_BANDS.find((entry) => ratio >= entry.minRatio) ?? SKILL_OVERLAP_BANDS[4]
  const parts = [`${known.length} of ${jobSkills.length} skills in the posting are strong or working skills for you`]
  if (known.length > 0) parts.push(`(${listOf(known)})`)
  const reason = `${parts.join(' ')}.${missing.length > 0 ? ` Not strong yet: ${listOf(missing)}.` : ''}`
  return part('skills', label, 30, band.points, reason)
}

function experienceParts(facts: JobFacts): Part[] {
  const band = experienceBand(facts)
  const penaltyReason =
    band.penalty === 0
      ? 'No penalty.'
      : band.stretch
        ? `${band.summary}: a stretch, so it also needs ${STRETCH_MIN_SCORE} or more overall.`
        : `${band.summary}, more than an entry-level role.`
  return [
    part('experience', 'Experience level', 15, band.base, `${band.summary}.`),
    part('levelBonus', 'Level bonus', 10, band.bonus, band.bonus > 0 ? 'Extra points for an entry-level match.' : 'No entry-level bonus.'),
    part('experiencePenalty', 'Experience penalty', 0, band.penalty, penaltyReason),
  ]
}

function locationPart(job: Job, jd: string, profile: Profile): Part {
  const label = 'Location'
  const workplace = job.workplace === 'unknown' ? detectWorkplace(job.location, job.title, jd) : job.workplace
  const openTo = profile.location.openTo
  if (workplace !== 'unknown' && openTo.length > 0 && !openTo.includes(workplace)) {
    return part('location', label, 10, 0, `${workplace === 'onsite' ? 'On-site' : workplace[0].toUpperCase() + workplace.slice(1)} work, which you are not open to.`)
  }
  const place = normalizeLocation(job.location)
  const nonRemoteTargets = profile.targeting.locations.filter((target) => !/\bremote\b/i.test(target))
  if (workplace === 'remote') {
    if (!isUsOnlyRemoteLocation(job.location)) return part('location', label, 10, LOCATION_POINTS.remote, 'Remote.')
    const takesUsRemote = profile.targeting.locations.some((target) => isUsOnlyRemoteLocation(target))
    return takesUsRemote
      ? part('location', label, 10, LOCATION_POINTS.remote, 'Remote in the US, which your targets include. Check that it hires from your country.')
      : part('location', label, 10, LOCATION_POINTS.elsewhere, 'Remote, but only in the US.')
  }
  const matcher = textMatcher(place)
  const target = nonRemoteTargets.find((entry) => matcher.has(normalizeLocation(entry)))
  const relocation = profile.location.relocateTo.find((entry) => matcher.has(normalizeLocation(entry)))
  const where = target ?? relocation
  if (!where) return part('location', label, 10, LOCATION_POINTS.elsewhere, `${job.location || 'The location'} is outside your target locations.`)
  const why = target ? `In ${where}, one of your target locations` : `In ${where}, where you would relocate`
  return workplace === 'hybrid'
    ? part('location', label, 10, LOCATION_POINTS.hybridInTarget, `${why}, hybrid.`)
    : part('location', label, 10, LOCATION_POINTS.inTarget, `${why}.`)
}

function techPart(jobSkills: ReadonlySet<string>, jd: TextMatcher, skills: readonly ProfileSkill[]): Part {
  // Primary names only: a posting that says "PostgreSQL" mentions your PostgreSQL skill, not
  // your "Supabase (Postgres, Auth)" skill as well.
  const mentioned = skills.filter(
    (skill) => skill.primary.some((name) => jobSkills.has(name)) || skill.phrases.some((phrase) => jd.has(phrase)),
  )
  const raw = mentioned.reduce((sum, skill) => sum + TECH_POINTS[skill.level], 0)
  const points = Math.min(TECH_CAP, raw)
  const names = mentioned.map((skill) => skill.name.replace(/\s*\(.*$/, ''))
  const reason =
    mentioned.length === 0
      ? 'Mentions none of the skills on your profile.'
      : `Mentions ${mentioned.length} of your skills (${listOf(names)}): 3 points each for strong, 2 for working, 1 for familiar${raw > TECH_CAP ? `, capped at ${TECH_CAP}` : ''}.`
  return part('tech', 'Tech alignment', TECH_CAP, points, reason)
}

function otherPart(job: Job, jd: TextMatcher, profile: Profile): Part {
  const keywords = jd.which(profile.targeting.preferredKeywords)
  const keywordPoints = Math.min(OTHER.keywordCap, keywords.length * OTHER.keyword)
  const industry = job.industry ? normalizeText(job.industry).toLowerCase() : ''
  const industryMatch = Boolean(industry) && (profile.targeting.industriesPrefer ?? []).some((entry) => normalizeText(entry).toLowerCase() === industry)
  const size = job.companySize
  const sizeMatch = size !== undefined && size >= COMPANY_SIZE_PREFER.min && size <= COMPANY_SIZE_PREFER.max
  const points = Math.min(OTHER.cap, keywordPoints + (industryMatch ? OTHER.industry : 0) + (sizeMatch ? OTHER.companySize : 0))
  const reasons: string[] = []
  if (keywords.length > 0) reasons.push(`Preferred keywords: ${listOf(keywords)} (2 each, up to 6).`)
  if (industryMatch) reasons.push(`${job.industry} is a preferred industry.`)
  if (sizeMatch) reasons.push(`${size} employees is in your preferred company size.`)
  return part('other', 'Other signals', OTHER.cap, points, reasons.length > 0 ? reasons.join(' ') : 'No preferred keywords, industry or company size.')
}

// ---------- Disqualifiers ----------

function disqualifiersFor(job: Job, facts: JobFacts, jd: TextMatcher, profile: Profile): string[] {
  const found: string[] = []
  const targeting = profile.targeting
  if (facts.advancedDegreeRequired) found.push("Requires a master's or PhD.")

  const title = textMatcher(normalizeTitle(job.title))
  // "Senior" and "Sr." normalize to the same word; name it once.
  const seen = new Set<string>()
  const avoided = targeting.avoidTitles.filter((term) => {
    const normalized = normalizeTitle(term)
    if (normalized === '' || seen.has(normalized) || !title.has(normalized)) return false
    seen.add(normalized)
    return true
  })
  if (avoided.length > 0) found.push(`Title contains ${avoided.map((term) => `"${term}"`).join(', ')}, on your avoid list.`)

  for (const phrase of jd.which(targeting.dealbreakers)) found.push(`Mentions "${phrase}", one of your dealbreakers.`)

  if (!looksLikeSoftwareTitle(job.title) && !targeting.titles.some((target) => normalizeTitle(target) === normalizeTitle(job.title))) {
    found.push('Not a software role.')
  }

  const band = experienceBand(facts)
  const min = facts.yearsMin ?? null
  const stretchAllowed = band.stretch && min !== null && min <= targeting.maxYears + 1
  if (min !== null && min > targeting.maxYears && !stretchAllowed) {
    found.push(`Asks for ${min}+ years; your limit is ${targeting.maxYears}.`)
  }

  const industry = job.industry ? normalizeText(job.industry).toLowerCase() : ''
  if (industry && (targeting.industriesAvoid ?? []).some((entry) => normalizeText(entry).toLowerCase() === industry)) {
    found.push(`${job.industry} is an industry you avoid.`)
  }

  if (facts.usOnly && profile.authorization.usRequiresSponsorship !== false) {
    found.push('Requires US residence or work authorization.')
  }

  const isStudent = profile.education.some((entry) => entry.status === 'in_progress')
  if (facts.requiresEnrollment && !isStudent) found.push('Requires current enrollment as a student.')
  return found
}

// ---------- The score ----------

export function scoreJob(job: Job, profile: Profile, now: Instant): ScoreResult {
  const facts = factsFor(job)
  const jdRaw = `${job.title}\n${job.jdText ?? ''}`
  const jd = textMatcher(jdRaw)
  const skills = indexProfileSkills(profile.skills)
  const jobSkills = facts.skills ?? []

  const parts: Part[] = [
    titlePart(job.title, profile.targeting.titles),
    skillsPart(facts, skills),
    ...experienceParts(facts),
    locationPart(job, job.jdText ?? '', profile),
    techPart(new Set(jobSkills), jd, skills),
    otherPart(job, jd, profile),
  ]
  const raw = parts.reduce((sum, entry) => sum + entry.points, 0)
  const disqualifiers = disqualifiersFor(job, facts, jd, profile)
  const band = experienceBand(facts)

  if (disqualifiers.length > 0) {
    parts.push(part('disqualified', 'Disqualified', 0, -raw, `Would score ${raw}, but: ${disqualifiers.join(' ')}`))
    return {
      total: 0,
      parts,
      tier: null,
      disqualifiers,
      gate: { verdict: 'skip', reason: `Disqualified. ${disqualifiers.join(' ')}` },
      rubricVersion: RUBRIC_VERSION,
    }
  }

  const total = Math.min(100, Math.max(0, raw))
  if (total !== raw) {
    parts.push(part('cap', 'Capped', 0, total - raw, `The parts add up to ${raw}; scores are capped to 0-100.`))
  }
  const gate =
    band.stretch && total < STRETCH_MIN_SCORE
      ? { verdict: 'skip' as const, reason: `${band.summary} is a stretch and needs ${STRETCH_MIN_SCORE} or more; this scores ${total}.` }
      : recencyGate(total, job.postedAt, now, job.company)
  return { total, parts, tier: band.tier, disqualifiers, gate, rubricVersion: RUBRIC_VERSION }
}
