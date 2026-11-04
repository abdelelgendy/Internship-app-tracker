/**
 * Maps job-hunter's config/profile.yaml onto the contract's Profile. Used only when the source
 * has no copilot-data/profile.json, which is the corrected profile and always wins.
 *
 * Old copies of this file held claims that turned out to be false, so nothing that reads as a
 * claim is trusted: every job comes in with verified: false, every saved answer comes in marked
 * "answer it yourself", and resume bullets for projects are held back for review instead of
 * imported (projects have no verified flag, and the cover letter check treats project bullets
 * as approved). The approved-facts list starts empty. Demographic values are never read.
 *
 * Pure: the caller parses the YAML and passes the object in.
 */
import { normalizeCompany } from '../engine/normalize.ts'
import type { Profile, SkillLevel, Workplace } from '../engine/types.ts'

export interface UnverifiedItem {
  kind: 'experience' | 'answer' | 'bullet'
  text: string
}

export interface ProfileFromYaml {
  profile: Profile
  /** Everything imported as unverified, for the warning printed after the import. */
  unverified: UnverifiedItem[]
  /** Project bullets left out of the profile, by project, to copy in once checked. */
  heldBack: { project: string; bullets: string[] }[]
  /** Fields that could not be read and were left empty. */
  gaps: string[]
}

type Row = Record<string, unknown>

const isRow = (value: unknown): value is Row => typeof value === 'object' && value !== null && !Array.isArray(value)
const rowAt = (row: Row, key: string): Row => (isRow(row[key]) ? (row[key] as Row) : {})
const textAt = (row: Row, key: string): string => {
  const value = row[key]
  return typeof value === 'string' ? value.trim() : typeof value === 'number' ? String(value) : ''
}
const listAt = (row: Row, key: string): string[] =>
  Array.isArray(row[key]) ? (row[key] as unknown[]).filter((item): item is string => typeof item === 'string').map((item) => item.trim()).filter(Boolean) : []

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']

/** "Oct 2026", "about Sep 2024", "September 2022" or "October 15, 2026" as "2026-10"; "2026" as "2026". Else null. */
export function monthOf(text: string): string | null {
  const named = text.toLowerCase().match(/\b(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\.?\s+(?:\d{1,2},?\s+)?(\d{4})\b/)
  if (named) return `${named[2]}-${String(MONTHS.indexOf(named[1]) + 1).padStart(2, '0')}`
  const numeric = text.match(/\b(\d{4})-(\d{2})\b/)
  if (numeric) return `${numeric[1]}-${numeric[2]}`
  const year = text.match(/\b(\d{4})\b/)
  return year ? year[1] : null
}

/** "Jun 2026 to present" as start "2026-06" and end null; "Feb 2026 to Mar 2026" as two months. */
export function dateRange(text: string): { start: string; end: string | null } | null {
  const [from, to = ''] = text.split(/\s+(?:to|until|through|-|\u2013|\u2014)\s+/i)
  const start = monthOf(from)
  if (!start) return null
  if (/\b(?:present|now|current)\b/i.test(to) || to.trim() === '') return { start, end: null }
  return { start, end: monthOf(to) }
}

const LEVELS: Record<string, SkillLevel> = { expert: 'strong', proficient: 'working', familiar: 'familiar' }

function skillsFrom(skills: Row): Profile['skills'] {
  const seen = new Set<string>()
  const out: Profile['skills'] = []
  for (const category of Object.values(skills)) {
    if (!isRow(category)) continue
    for (const [key, level] of Object.entries(LEVELS)) {
      for (const name of listAt(category, key)) {
        const id = name.toLowerCase()
        if (seen.has(id)) continue
        seen.add(id)
        out.push({ name, level })
      }
    }
  }
  return out
}

/** Self-identification questions: never answered from a file, always by the person, per application. */
export const DEMOGRAPHIC = /\b(?:gender|pronouns?|race|ethnicity|hispanic|latin[oa]|veteran|disabilit(?:y|ies)|transgender|lgbtq|sexual orientation|self-identification)\b/i

function slug(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    .replace(/-+$/, '')
}

/** The question as a pattern: lowercase words, no punctuation, so it matches the same question on a form. */
function patternOf(question: string): string {
  return question
    .toLowerCase()
    .replace(/[^a-z0-9+#.\s/']/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

function answersFrom(answers: Row, unverified: UnverifiedItem[]): Profile['answers'] {
  const ids = new Set<string>()
  const out: Profile['answers'] = []
  for (const [question, raw] of Object.entries(answers)) {
    if (typeof raw !== 'string' && typeof raw !== 'number' && typeof raw !== 'boolean') continue
    const base = slug(question) || 'answer'
    let id = base
    for (let n = 2; ids.has(id); n += 1) id = `${base}-${n}`
    ids.add(id)
    const demographic = DEMOGRAPHIC.test(question)
    const answer = demographic ? '' : String(raw).trim()
    out.push({
      id,
      question,
      patterns: [patternOf(question)],
      answer,
      needsHuman: true,
      note: demographic
        ? 'Self-identification: decide on each application. Never filled from a file.'
        : answer
          ? "Imported from job-hunter's profile.yaml and not checked yet. Confirm it, then untick \"I answer this myself\"."
          : 'Left empty in profile.yaml. Write the answer when you know it.',
    })
    if (answer) unverified.push({ kind: 'answer', text: `${question} -> ${answer}` })
  }
  return out
}

/** Pairs a resume_bullets key (such as "pinecrest_studio") with an employer ("Pinecrest Studio"). */
function employerFor(key: string, orgs: readonly string[]): string | undefined {
  const words = key.toLowerCase().split(/[_-]+/).filter(Boolean)
  return orgs.find((org) => {
    const name = normalizeCompany(org).split(/[^a-z0-9]+/).filter(Boolean)
    return words.every((word) => name.includes(word)) || name[0] === words[0]
  })
}

function titleCase(key: string): string {
  return key
    .split(/[_-]+/)
    .filter(Boolean)
    .map((word) => (word.length <= 3 ? word.toUpperCase() : word[0].toUpperCase() + word.slice(1)))
    .join(' ')
}

function openTo(location: Row): Workplace[] {
  const flags: [string, Workplace][] = [['open_to_remote', 'remote'], ['open_to_hybrid', 'hybrid'], ['open_to_onsite', 'onsite']]
  const open = flags.filter(([key]) => location[key] === true).map(([, workplace]) => workplace)
  return open.length > 0 ? open : ['remote', 'hybrid', 'onsite']
}

function canadaStatus(authorization: Row): Profile['authorization']['canada'] {
  const text = `${textAt(authorization, 'citizenship')} ${textAt(authorization, 'work_authorization')}`.toLowerCase()
  if (/\bcitizen\b/.test(text)) return 'citizen'
  if (/permanent resident|\bpr\b/.test(text)) return 'pr'
  if (/permit/.test(text)) return 'permit'
  return authorization.authorized_to_work_in_canada === true ? 'permit' : 'none'
}

export function profileFromYaml(doc: unknown): ProfileFromYaml {
  const root = isRow(doc) ? doc : {}
  const personal = rowAt(root, 'personal')
  const location = rowAt(personal, 'location')
  const authorization = rowAt(root, 'authorization')
  const education = rowAt(root, 'education')
  const targeting = rowAt(root, 'targeting')
  const unverified: UnverifiedItem[] = []
  const gaps: string[] = []

  const first = textAt(personal, 'first_name')
  const last = textAt(personal, 'last_name')
  const name = [first, last].filter(Boolean).join(' ') || textAt(personal, 'name')
  if (!name) gaps.push('personal.first_name and last_name')
  const email = textAt(personal, 'email')
  if (!email) gaps.push('personal.email')

  const employment = Array.isArray(root.employment_history) ? root.employment_history.filter(isRow) : []
  const orgs = employment.map((job) => textAt(job, 'org')).filter(Boolean)
  const bulletBank = rowAt(root, 'resume_bullets')
  const bulletsByOrg = new Map<string, string[]>()
  const heldBack: ProfileFromYaml['heldBack'] = []
  const projects: Profile['projects'] = []
  for (const [key, value] of Object.entries(bulletBank)) {
    const bullets = Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
    const org = employerFor(key, orgs)
    if (org) {
      bulletsByOrg.set(org, [...(bulletsByOrg.get(org) ?? []), ...bullets])
    } else {
      projects.push({ slug: slug(key), name: titleCase(key), oneLiner: '', bullets: [], stack: [] })
      if (bullets.length > 0) heldBack.push({ project: titleCase(key), bullets })
    }
  }

  const experience: Profile['experience'] = []
  for (const job of employment) {
    const org = textAt(job, 'org')
    const title = textAt(job, 'title')
    if (!org || !title) continue
    const range = dateRange(textAt(job, 'dates'))
    if (!range) gaps.push(`dates for ${title} at ${org}`)
    const bullets = bulletsByOrg.get(org) ?? []
    const summary = textAt(job, 'notes')
    experience.push({ org, title, start: range?.start ?? '', end: range?.end ?? null, ...(summary ? { summary } : {}), bullets, verified: false })
    unverified.push({ kind: 'experience', text: `${title} at ${org}${textAt(job, 'dates') ? ` (${textAt(job, 'dates')})` : ''}` })
    for (const bullet of bullets) unverified.push({ kind: 'bullet', text: `${org}: ${bullet}` })
  }

  const graduation = textAt(education, 'graduation_date')
  const statusText = textAt(education, 'status').toLowerCase()
  const completed = /\b(?:completed|graduated)\b/.test(statusText)
  const school = textAt(education, 'school')
  const educationEntries: Profile['education'] = school
    ? [
        {
          school,
          degree: textAt(education, 'degree'),
          field: textAt(education, 'field'),
          ...(monthOf(textAt(education, 'start_date')) ? { start: monthOf(textAt(education, 'start_date')) as string } : {}),
          ...(monthOf(graduation) ? { end: monthOf(graduation) as string } : {}),
          // Unclear wording counts as in progress: the scorer then keeps enrollment-only postings open, and the person corrects it.
          status: completed ? 'completed' : 'in_progress',
        },
      ]
    : []
  if (!school) gaps.push('education.school')
  if (school && !completed) gaps.push('education.status (read as in progress; check it)')

  const usAuthorized = authorization.authorized_to_work_in_us
  const profile: Profile = {
    name,
    preferredName: textAt(personal, 'preferred_name') || first || name,
    email,
    ...(textAt(personal, 'phone') ? { phone: textAt(personal, 'phone') } : {}),
    links: {
      ...(textAt(personal, 'linkedin') ? { linkedin: textAt(personal, 'linkedin') } : {}),
      ...(textAt(personal, 'github') ? { github: textAt(personal, 'github') } : {}),
      ...(textAt(personal, 'portfolio') ? { portfolio: textAt(personal, 'portfolio') } : {}),
    },
    location: {
      city: textAt(location, 'city'),
      region: textAt(location, 'province') || textAt(location, 'region') || textAt(location, 'state'),
      country: textAt(location, 'country'),
      openTo: openTo(location),
      relocateTo: listAt(location, 'relocate_to').filter((place) => !/^remote$/i.test(place)),
    },
    authorization: {
      canada: canadaStatus(authorization),
      // Not authorized for the US means a US-located role needs a per-job decision, not a fixed answer.
      usRequiresSponsorship: usAuthorized === true ? false : null,
      notes: 'Imported from profile.yaml. US sponsorship depends on the role, so it is decided per job.',
    },
    education: educationEntries,
    experience,
    projects,
    skills: skillsFrom(rowAt(root, 'skills')),
    targeting: {
      titles: listAt(targeting, 'titles_want'),
      avoidTitles: listAt(targeting, 'titles_avoid'),
      locations: listAt(targeting, 'locations'),
      maxYears: typeof targeting.experience_max_years === 'number' ? targeting.experience_max_years : 3,
      dealbreakers: listAt(targeting, 'dealbreaker_requirements'),
      preferredKeywords: listAt(targeting, 'preferred_keywords'),
      industriesPrefer: listAt(targeting, 'industries_prefer'),
      industriesAvoid: listAt(targeting, 'industries_avoid'),
    },
    answers: answersFrom(rowAt(root, 'application_answers'), unverified),
    coverLetter: { signature: name, maxWords: 150, voiceNotes: [], bannedPhrases: [] },
    facts: [],
  }
  if (typeof targeting.experience_max_years !== 'number') gaps.push('targeting.experience_max_years (used 3)')
  for (const { project, bullets } of heldBack) for (const bullet of bullets) unverified.push({ kind: 'bullet', text: `${project}: ${bullet}` })
  return { profile, unverified, heldBack, gaps }
}
