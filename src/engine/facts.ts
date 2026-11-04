import { normalizeText, normalizeTitle, sentences, textMatcher, titleLevel } from './normalize.ts'
import { findSkills } from './skills.ts'
import type { JobFacts } from './types.ts'

/**
 * Rule-based fact extraction from a posting. No AI: every fact comes from a phrase you can
 * point at in the description, so a wrong fact is a rule to fix, not a guess to argue with.
 */

// ---------- Years of experience ----------

const NUMBER_WORDS: Record<string, number> = {
  zero: 0, one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9,
  ten: 10, eleven: 11, twelve: 12, fifteen: 15,
}
// Number words need their own boundaries so "someone" never reads as "one".
const N = `(\\d{1,2}|\\b(?:${Object.keys(NUMBER_WORDS).join('|')})\\b)`
const YEARS = `(?:years?|yrs?)`

interface YearRule {
  pattern: RegExp
  /** Turns a match into [min, max]; max null means open-ended ("3+ years"). */
  read: (m: RegExpExecArray) => [number, number | null]
  /** The match names experience itself ("Years of experience: 4+"), so its context needs no check. */
  labelled?: boolean
}

// Needs the colon: "5+ years of experience 2 of which in React" is not a label.
const EXPERIENCE_LABEL = `\\b${YEARS} of (?:[\\p{L}-]+ ){0,2}?experience(?: (?:required|needed))?\\s*:\\s*`
const YEAR_RULES: readonly YearRule[] = [
  { pattern: new RegExp(`${EXPERIENCE_LABEL}${N}\\s*\\+?\\s*(?:-|to)\\s*${N}`, 'giu'), read: (m) => [num(m[1]), num(m[2])], labelled: true },
  { pattern: new RegExp(`${EXPERIENCE_LABEL}${N}(?!\\s*(?:-|to)\\s*\\d)`, 'giu'), read: (m) => [num(m[1]), null], labelled: true },
  { pattern: new RegExp(`between ${N} and ${N} ${YEARS}`, 'giu'), read: (m) => [num(m[1]), num(m[2])] },
  { pattern: new RegExp(`(?<!\\d)${N}\\s*\\+?\\s*(?:-|to)\\s*${N}\\s*\\+?\\s*${YEARS}`, 'giu'), read: (m) => [num(m[1]), num(m[2])] },
  { pattern: new RegExp(`(?:up to|less than|under|no more than|at most) ${N} ${YEARS}`, 'giu'), read: (m) => [0, num(m[1])] },
  { pattern: new RegExp(`(?:at least|minimum(?: of)?|min\\.?|no less than|over|more than) ${N}\\s*\\+?\\s*${YEARS}`, 'giu'), read: (m) => [num(m[1]), null] },
  { pattern: new RegExp(`(?<!\\d)${N}\\s*\\+\\s*${YEARS}`, 'giu'), read: (m) => [num(m[1]), null] },
  { pattern: new RegExp(`(?<!\\d)${N} or more ${YEARS}`, 'giu'), read: (m) => [num(m[1]), null] },
  { pattern: new RegExp(`(?<![\\d+-]\\s?)(?<!\\d)${N}\\s*${YEARS}(?!\\s*(?:-|to)\\s*\\d)`, 'giu'), read: (m) => [num(m[1]), null] },
]

function num(token: string): number {
  return NUMBER_WORDS[token.toLowerCase()] ?? Number(token)
}

// A years phrase only counts when it is about the candidate's experience.
const EXPERIENCE_AFTER =
  /^['s]*\s*(?:of\s+)?(?:\S+\s+){0,4}?(?:experience|exp\b|building|developing|working|writing|programming|coding|engineering|development|professional|industry|hands-on|work\b(?!\s+(?:permits?|visas?|authori[sz]ation|eligibility)\b)|in\s+(?:a\s+)?(?:professional|software|web|production|similar|related)|with\b)/iu
// "5+ years as a software engineer", but not "10 years as a leading provider".
const ROLE_AFTER = /^\s*as\s+(?!(?:an?\s+)?(?:company|business|team|organi[sz]ation|leader|leading|partner|provider|brand)\b)\p{L}/iu
// "4 years in software development" or "in a SaaS company", but not "2 years in a row".
const FIELD_AFTER = /^\s*in\s+(?!(?:a\s+row|business|the\s+making|advance)\b)\S/iu
// "5+ years shipping production web apps".
const GERUND_AFTER = /^\s*(?:of\s+)?(?!(?:during|nothing|something|anything|everything|bring|morning|evening)\b)\p{L}{2,}ing\b/iu
// "Experience: 4+ years" or "Minimum experience required: 3 years".
const EXPERIENCE_LABEL_BEFORE = /\b(?:experience|exp\.?)(?:\s+(?:required|requirements?|level|needed))?\s*[:-]\s*$/iu
const COMPANY_HISTORY_BEFORE =
  /\b(?:for the (?:past|last)|over the (?:past|last)|in the (?:past|last)|for over|for more than|founded|since|been around|we've|we have|within (?:the )?(?:first|next)|warranty|contract|term of|in business)\b[^.]*$/iu
const NOT_EXPERIENCE_AFTER = /^\s*(?:of age|old|ago)\b/iu

function aboutTheCandidate(before: string, after: string): boolean {
  // A bullet that is only the requirement ("- 4+ years") says nothing else it could be about.
  const standalone = before.trim() === '' && /^[\s.;,)]*$/u.test(after)
  return (
    standalone ||
    EXPERIENCE_LABEL_BEFORE.test(before) ||
    [EXPERIENCE_AFTER, ROLE_AFTER, FIELD_AFTER, GERUND_AFTER].some((rule) => rule.test(after))
  )
}

const PREFERRED_CUE = /\b(?:preferred|a plus|is a plus|nice to have|nice-to-have|bonus|ideally|desirable|an asset|advantage)\b/iu
const PREFERRED_HEADER = /^(?:nice to have|nice-to-haves?|bonus(?: points)?|preferred(?: qualifications)?|pluses|it'?s a plus|assets?)\b/iu
const REQUIRED_HEADER = /^(?:requirements|required|qualifications|minimum qualifications|basic qualifications|what you'll need|what you need|must haves?|you have|about you|who you are|responsibilities|what we're looking for)\b/iu

interface Sentence {
  text: string
  /** Under a "Nice to have" heading, or marked preferred, a plus or an asset. */
  preferred: boolean
}

/** Sentences of the posting, each marked required or preferred by its heading and its own wording. */
function classifySentences(jdText: string): Sentence[] {
  const out: Sentence[] = []
  let preferredSection = false
  for (const rawLine of jdText.split(/\n+/)) {
    const line = normalizeText(rawLine).replace(/^[-*\u2022\s]+/u, '')
    if (PREFERRED_HEADER.test(line)) preferredSection = true
    else if (REQUIRED_HEADER.test(line)) preferredSection = false
    for (const text of sentences(line)) out.push({ text, preferred: preferredSection || PREFERRED_CUE.test(text) })
  }
  return out
}

function yearsMentionsIn(sentence: string): { min: number; max: number | null }[] {
  const mentions: { min: number; max: number | null }[] = []
  const taken: [number, number][] = []
  for (const { pattern, read, labelled } of YEAR_RULES) {
    pattern.lastIndex = 0
    for (let m = pattern.exec(sentence); m; m = pattern.exec(sentence)) {
      const start = m.index
      const end = start + m[0].length
      if (taken.some(([a, b]) => start < b && end > a)) continue
      const after = sentence.slice(end)
      const before = sentence.slice(Math.max(0, start - 40), start)
      if (NOT_EXPERIENCE_AFTER.test(after) || COMPANY_HISTORY_BEFORE.test(before)) continue
      if (!labelled && !aboutTheCandidate(before, after)) continue
      taken.push([start, end])
      const [min, max] = read(m)
      mentions.push({ min: Math.min(min, max ?? min), max: max === null ? null : Math.max(min, max) })
    }
  }
  return mentions
}

/**
 * The experience the posting requires. With several requirements ("1+ years of TypeScript,
 * 3+ years overall") the most demanding one wins. Mentions marked preferred, a plus or under a
 * "Nice to have" heading are ignored, so "5+ years is a plus" does not disqualify a junior role.
 */
export function extractYears(jdText: string): { min: number | null; max: number | null } {
  const required = classifySentences(jdText)
    .filter((sentence) => !sentence.preferred)
    .flatMap((sentence) => yearsMentionsIn(sentence.text))
  if (required.length === 0) return { min: null, max: null }
  const strictest = required.reduce((best, mention) =>
    mention.min > best.min || (mention.min === best.min && best.max === null && mention.max !== null) ? mention : best,
  )
  return { min: strictest.min, max: strictest.max }
}

/** Skills the posting names only as nice to have. Skill overlap is judged on the rest. */
export function extractPreferredSkills(jdText: string, title: string): string[] {
  const all = findSkills(`${title}\n${jdText}`)
  const classified = classifySentences(jdText)
  const required = new Set(findSkills([title, ...classified.filter((s) => !s.preferred).map((s) => s.text)].join('\n')))
  return all.filter((skill) => !required.has(skill))
}

// ---------- Level ----------

const JD_LEVEL_RULES: readonly [NonNullable<JobFacts['level']>, readonly string[]][] = [
  ['new_grad', ['new grad', 'new grads', 'new graduate', 'new graduates', 'recent graduate', 'recent graduates', 'recent grad', 'entry level', 'entry-level', 'early career', 'university graduate']],
  ['junior', ['junior', 'jr.']],
  ['intern', ['this internship', 'internship program', 'internship position', 'intern position', 'co-op term', 'co-op position', 'work term', 'summer intern']],
]

// "You will mentor junior engineers" and "this is not an entry-level role" describe someone else.
const NOT_ABOUT_THE_ROLE = /\b(?:not|mentor|mentoring|mentorship|coach|coaching|guide|guiding|lead|leading|manage|managing|train|training)\b/iu

/** The title decides when it states a level; otherwise explicit phrases in the description do. */
export function extractLevel(jdText: string, title: string): NonNullable<JobFacts['level']> {
  const fromTitle = titleLevel(title)
  if (fromTitle !== 'unknown') return fromTitle
  const about = sentences(normalizeText(jdText)).filter((sentence) => !NOT_ABOUT_THE_ROLE.test(sentence))
  const jd = textMatcher(about.join('\n'))
  for (const [level, phrases] of JD_LEVEL_RULES) if (jd.which(phrases).length > 0) return level
  return 'unknown'
}

// ---------- Location and enrollment requirements ----------

const US_ONLY_PHRASES = [
  'us work authorization required', 'must reside in us', 'must reside in the us', 'must reside in the united states',
  'must be located in the us', 'must be located in the united states', 'must be based in the us',
  'must be based in the united states', 'must live in the us', 'must live in the united states',
  'us citizens only', 'u.s. citizens only', 'us citizenship required', 'u.s. citizenship required',
  'must be a us citizen', 'must be a u.s. citizen', 'authorized to work in the us', 'authorized to work in the u.s.',
  'authorized to work in the united states', 'green card holders', 'us persons', 'u.s. persons',
  'only considering candidates in the us', 'only considering candidates located in the us', 'us residents only',
  'security clearance',
]
const WIDER_REGION = /\b(?:canada|canadian|north america|americas|worldwide|anywhere)\b/iu
const NEGATION = /\b(?:no|not|without|does not|doesn't)\b/iu

/** Phrases that tie the job to US residence or authorization, unless the same sentence opens it to Canada. */
export function usOnlyPhrases(jdText: string): string[] {
  const hits = new Set<string>()
  for (const sentence of sentences(normalizeText(jdText))) {
    if (WIDER_REGION.test(sentence)) continue
    for (const phrase of textMatcher(sentence).which(US_ONLY_PHRASES)) {
      if (phrase === 'security clearance' && NEGATION.test(sentence)) continue
      hits.add(phrase)
    }
  }
  return [...hits]
}

// These require current enrollment in any posting.
const ENROLLMENT_ALWAYS = [
  /\bcurrently enrolled\b/iu,
  /\bmust be (?:currently )?(?:enrolled|registered)\b/iu,
  /\benrolled (?:full-time )?in (?:a|an) (?:[\p{L}-]+ ){0,3}(?:degree|program|programme|university|college|school|co-op|post-secondary|bachelor'?s?)\b/iu,
  /\b(?:returning|return) to (?:school|studies|your studies|university|campus)\b/iu,
  /\b(?:current|registered) (?:full-time )?students?\b/iu,
  /\bmust be a (?:full-time )?student\b/iu,
  /\bstudents only\b/iu,
  /\bstudent status\b/iu,
  /\bremaining in your (?:program|studies)\b/iu,
  /\bregistered in a co-op\b/iu,
]
// These describe a co-op or internship's terms, so they count only when the title is an intern role.
// In a full-time posting "our co-op program" or "currently pursuing" says nothing about the candidate.
const ENROLLMENT_IN_INTERN_ROLES = [
  /\bco-op (?:program|programs|term|terms)\b/iu,
  /\bwork terms?\b/iu,
  /\bcurrently pursuing\b/iu,
  /\bpursuing (?:a|an|your) (?:degree|bachelor'?s?|undergraduate|diploma)\b/iu,
]
// "Currently enrolled or recently graduated" is open to graduates, so it is not a requirement.
const GRADUATES_WELCOME = /\b(?:or (?:have |a )?(?:recently )?(?:graduated|completed|recent grad(?:uate)?s?|new grad(?:uate)?s?)|recent grad(?:uate)?s?|new grad(?:uate)?s?|graduates? (?:are )?welcome)\b/iu

/** The phrases, as written, that require the candidate to be a current student. */
export function enrollmentPhrases(jdText: string, title = ''): string[] {
  const rules = titleLevel(title) === 'intern' ? [...ENROLLMENT_ALWAYS, ...ENROLLMENT_IN_INTERN_ROLES] : ENROLLMENT_ALWAYS
  const hits = new Set<string>()
  for (const sentence of sentences(normalizeText(jdText))) {
    if (GRADUATES_WELCOME.test(sentence)) continue
    for (const rule of rules) {
      const match = sentence.match(rule)
      if (match) hits.add(match[0].toLowerCase())
    }
  }
  return [...hits]
}

// ---------- Ghost postings, salary, degrees ----------

/** From the old engine, with "pipeline" narrowed to "talent pipeline" (it matched CI/CD and data pipelines). */
export const GHOST_PHRASES = [
  'ongoing basis', 'talent pool', 'talent pipeline', 'future opportunities', 'future openings',
  'no current openings', 'building our team for',
]

const MONEY = String.raw`(?:(?:CA|C|US|USD|CAD|AU|A)\s?\$|\$|£|€|(?:USD|CAD)\s)\s?\d[\d,]*(?:\.\d+)?\s?[kK]?`
const SALARY = new RegExp(
  String.raw`${MONEY}(?:\s?(?:-|to)\s?(?:${MONEY}|\d[\d,]*(?:\.\d+)?\s?[kK]?))?(?:\s?(?:CAD|USD))?(?:\s?(?:/|per|an?)\s?(?:hour|hr|year|yr|annum|annually))?` +
    String.raw`|\b\d{2,3}(?:,\d{3})+\s?(?:-|to)\s?\d{2,3}(?:,\d{3})+\s?(?:CAD|USD)\b`,
  'gu',
)

function amountOf(text: string): number {
  const match = text.match(/(\d[\d,]*(?:\.\d+)?)\s?([kK])?/)
  if (!match) return 0
  return Number(match[1].replace(/,/g, '')) * (match[2] ? 1000 : 1)
}

/** The first salary-like range or amount, as written. "$20M in funding" and "$5 gift cards" are not salaries. */
export function extractSalary(jdText: string): string | null {
  const text = normalizeText(jdText)
  for (const match of text.matchAll(SALARY)) {
    const found = match[0].replace(/[,.\s]+$/, '')
    const after = text.slice((match.index ?? 0) + match[0].length)
    if (/^\s*(?:million|billion|mm?\b|bn?\b)/i.test(after)) continue
    const hourly = /(?:hour|hr)\s*$/i.test(found)
    if (amountOf(found) >= (hourly ? 10 : 1000)) return found
  }
  return null
}

const ADVANCED_DEGREE = /\b(?:master'?s|masters|msc|m\.sc|ph\.?d|doctorate|doctoral)\b/iu
const REQUIRED_WORD = /\b(?:required|must have|must hold|requires|mandatory)\b/iu
const DEGREE_ESCAPE = /\b(?:bachelor'?s|bachelors|bsc|b\.sc|undergraduate|or equivalent|preferred|a plus|nice to have|an asset)\b/iu

/** True only when a sentence requires a master's or PhD without offering a bachelor's or equivalent. */
export function requiresAdvancedDegree(jdText: string): boolean {
  return sentences(normalizeText(jdText)).some(
    (sentence) => ADVANCED_DEGREE.test(sentence) && REQUIRED_WORD.test(sentence) && !DEGREE_ESCAPE.test(sentence),
  )
}

// ---------- All together ----------

/** Every rule-based fact for one posting. Pass the location so "Remote - US only" counts as US-only. */
export function extractFacts(jdText: string, title: string, location = ''): JobFacts {
  const years = extractYears(jdText)
  const level = extractLevel(jdText, title)
  const usLocation = /\b(?:us|usa|u\.s\.|united states)\s*-?\s*only\b/i.test(normalizeText(location))
  // A Canadian co-op always requires registration in a school's co-op program.
  const coopTitle = /\bco-op\b/.test(normalizeTitle(title))
  return {
    level,
    yearsMin: years.min,
    yearsMax: years.max,
    skills: findSkills(`${title}\n${jdText}`),
    preferredSkills: extractPreferredSkills(jdText, title),
    usOnly: usLocation || usOnlyPhrases(jdText).length > 0,
    requiresEnrollment: coopTitle || enrollmentPhrases(jdText, title).length > 0,
    ghostPhrases: textMatcher(jdText).which(GHOST_PHRASES),
    salaryText: extractSalary(jdText),
    advancedDegreeRequired: requiresAdvancedDegree(jdText),
  }
}
