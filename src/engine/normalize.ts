import type { JobFacts, Workplace } from './types.ts'

/**
 * Text, title, company and workplace normalization, plus whole-word phrase matching.
 *
 * Everything that compares words goes through `textMatcher`, so "Intern" never matches
 * "Internal" and "git" never matches "digital" (two of the old engine's verified bugs).
 */

/** Unicode-folds, straightens quotes, turns every dash into "-" and collapses whitespace. Keeps case. */
export function normalizeText(text: string): string {
  return text
    .normalize('NFKC')
    .replace(/[\u2018\u2019\u02BC\u2032]/g, "'")
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2010-\u2015\u2212]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// Characters that continue a word for matching purposes. "+" and "#" are included so that
// "C" does not match inside "C++" or "C#", and "5+ years" does not match inside "15+ years".
const WORD = '[\\p{L}\\p{N}+#]'
const WORD_START = /^[\p{L}\p{N}+#]/u
const WORD_END = /[\p{L}\p{N}+#]$/u

const patternCache = new Map<string, RegExp>()

/**
 * A regex for a phrase on whole-word boundaries. Spaces in the phrase match any run of spaces.
 * Matching is case-insensitive unless `caseSensitive` is set.
 */
export function phraseRegex(phrase: string, caseSensitive = false): RegExp {
  const key = `${caseSensitive ? 's' : 'i'}:${phrase}`
  let pattern = patternCache.get(key)
  if (!pattern) {
    const clean = normalizeText(phrase)
    const body = clean.split(' ').map(escapeRegExp).join('\\s+')
    const start = WORD_START.test(clean) ? `(?<!${WORD})` : ''
    const end = WORD_END.test(clean) ? `(?!${WORD})` : ''
    pattern = new RegExp(start + body + end, caseSensitive ? 'u' : 'iu')
    patternCache.set(key, pattern)
  }
  return pattern
}

export interface TextMatcher {
  /** The normalized text the matcher searches. */
  readonly text: string
  has(phrase: string, caseSensitive?: boolean): boolean
  /** Index of the first whole-word match, or -1. */
  indexOf(phrase: string, caseSensitive?: boolean): number
  /** The phrases from the list that appear, in list order. */
  which(phrases: readonly string[]): string[]
}

/** Normalizes the text once so many phrases can be checked against it cheaply. */
export function textMatcher(raw: string): TextMatcher {
  const text = normalizeText(raw)
  const indexOf = (phrase: string, caseSensitive = false) =>
    phrase.trim() === '' ? -1 : text.search(phraseRegex(phrase, caseSensitive))
  return {
    text,
    indexOf,
    has: (phrase, caseSensitive) => indexOf(phrase, caseSensitive) !== -1,
    which: (phrases) => phrases.filter((phrase) => indexOf(phrase) !== -1),
  }
}

export function hasPhrase(text: string, phrase: string): boolean {
  return textMatcher(text).has(phrase)
}

/** Splits text into sentences on ., !, ?, ; and line breaks. Used for "same sentence" checks. */
export function sentences(text: string): string[] {
  return text
    .split(/(?<=[.!?;])\s+|\n+/)
    .map((sentence) => sentence.trim())
    .filter(Boolean)
}

// ---------- Titles ----------

// Applied in order to lowercase text. Spelling variants collapse to one form, and the level
// words stay in the result: an intern posting and a full-time posting must never share a key.
const TITLE_REWRITES: readonly [RegExp, string][] = [
  [/\((?:remote|hybrid|on-?site|in[- ]office)[^)]*\)/g, ' '],
  [/\bco-?op\b|\bco op\b/g, 'co-op'],
  [/\binternships?\b|\binterns\b/g, 'intern'],
  [/\bjr\b\.?/g, 'junior'],
  [/\bsr\b\.?/g, 'senior'],
  [/\bnew[- ]grad(?:uate)?s?\b/g, 'new grad'],
  [/\bentry[- ]level\b/g, 'entry level'],
  [/\bmid[- ]level\b/g, 'mid level'],
  [/\bfront[- ]end\b/g, 'frontend'],
  [/\bback[- ]end\b/g, 'backend'],
  [/\bfull[- ]?stack\b/g, 'full stack'],
  [/\b(engineer|developer|programmer)\s+(?:level\s+)?1\b/g, '$1 i'],
  [/\b(engineer|developer|programmer)\s+(?:level\s+)?2\b/g, '$1 ii'],
  [/\b(engineer|developer|programmer)\s+(?:level\s+)?3\b/g, '$1 iii'],
  [/\bsw\s?e\b/g, 'software engineer'],
]

/** Lowercase, canonical spelling, punctuation removed, level words kept. */
export function normalizeTitle(title: string): string {
  let result = normalizeText(title).toLowerCase()
  for (const [pattern, replacement] of TITLE_REWRITES) result = result.replace(pattern, replacement)
  return result
    .replace(/[^\p{L}\p{N}+#.\- ]/gu, ' ')
    .replace(/\.(?![\p{L}\p{N}])/gu, ' ')
    .replace(/(?<![\p{L}\p{N}])-|-(?![\p{L}\p{N}])/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim()
}

const LEVEL_RULES: readonly [NonNullable<JobFacts['level']>, readonly string[]][] = [
  ['intern', ['intern', 'co-op', 'work term', 'student']],
  ['senior', ['senior', 'staff', 'principal', 'lead', 'iii', 'iv', 'architect', 'distinguished', 'head of', 'manager', 'director']],
  ['mid', ['ii', 'intermediate', 'mid level', 'mid']],
  ['new_grad', ['new grad', 'entry level', 'graduate', 'early career', 'university grad']],
  ['junior', ['junior', 'associate', 'engineer i', 'developer i', 'programmer i']],
]

/** The seniority a title states, or 'unknown' when it states none. */
export function titleLevel(title: string): NonNullable<JobFacts['level']> {
  const words = textMatcher(normalizeTitle(title))
  for (const [level, phrases] of LEVEL_RULES) if (phrases.some((phrase) => words.has(phrase))) return level
  return 'unknown'
}

const SOFTWARE_WORDS = [
  'software', 'developer', 'programmer', 'full stack', 'frontend', 'backend', 'web', 'sde',
  'devops', 'site reliability', 'sre', 'application', 'applications',
]
const NON_SOFTWARE_ENGINEERING = [
  'mechanical', 'civil', 'electrical', 'chemical', 'structural', 'sales', 'field', 'process',
  'manufacturing', 'environmental', 'biomedical', 'industrial', 'quality', 'hvac', 'geotechnical',
  'mining', 'aerospace', 'nuclear', 'petroleum', 'audio', 'broadcast', 'maintenance', 'facilities',
]

/** True when a title reads as a software role: "Product Engineer" yes, "Mechanical Engineer" no. */
export function looksLikeSoftwareTitle(title: string): boolean {
  const words = textMatcher(normalizeTitle(title))
  if (words.which(SOFTWARE_WORDS).length > 0) return true
  return words.has('engineer') && words.which(NON_SOFTWARE_ENGINEERING).length === 0
}

// ---------- Companies ----------

const COMPANY_SUFFIXES = new Set([
  'inc', 'incorporated', 'ltd', 'limited', 'llc', 'llp', 'corp', 'corporation', 'co', 'company',
  'gmbh', 'plc', 'ulc', 'sa', 'ag', 'bv',
])

/** Lowercase name without trailing legal suffixes or a leading "The": "Shopify Inc." and "shopify" match. */
export function normalizeCompany(company: string): string {
  const words = normalizeText(company)
    .toLowerCase()
    .replace(/&/g, ' and ')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
    .split(' ')
  // Only trailing suffixes are legal forms; "Limited Brands" keeps its first word.
  while (words.length > 1 && COMPANY_SUFFIXES.has(words[words.length - 1])) words.pop()
  if (words.length > 1 && words[0] === 'the') words.shift()
  return words.join(' ')
}

// ---------- Workplace ----------

const STRICT_JD_RULES: readonly [Workplace, readonly string[]][] = [
  ['hybrid', ['hybrid']],
  ['remote', ['fully remote', '100% remote', 'remote-first', 'remote first', 'this role is remote', 'this is a remote', 'work from anywhere']],
  ['onsite', ['on-site', 'onsite', 'in-office', 'in office', 'office-based', 'not remote', 'no remote']],
]

function workplaceIn(text: string, strict: boolean): Workplace {
  const words = textMatcher(text)
  if (strict) {
    for (const [workplace, phrases] of STRICT_JD_RULES) if (words.which(phrases).length > 0) return workplace
    return 'unknown'
  }
  // A location like "Toronto (Hybrid, remote-friendly)" implies office days, so hybrid wins.
  if (words.has('hybrid')) return 'hybrid'
  if (words.has('remote')) return 'remote'
  if (words.which(['on-site', 'onsite', 'in-office', 'in office', 'office']).length > 0) return 'onsite'
  return 'unknown'
}

/**
 * Workplace from the location first, then the title, then strict phrases in the description.
 * Descriptions say "remote" in passing ("remote teammates"), so only explicit phrases count there.
 */
export function detectWorkplace(location: string, title = '', jdText = ''): Workplace {
  const fromLocation = workplaceIn(location, false)
  if (fromLocation !== 'unknown') return fromLocation
  const fromTitle = workplaceIn(title, false)
  if (fromTitle !== 'unknown') return fromTitle
  return workplaceIn(jdText, true)
}

/** True for "Remote - US" style locations that name the US and no wider region. */
export function isUsOnlyRemoteLocation(location: string): boolean {
  const text = normalizeText(location)
  return (
    /\bremote\b/i.test(text) &&
    // Lookarounds, not \b: a word boundary never follows the final dot of "U.S.".
    /(?<!\w)(?:US|USA|U\.S\.(?:A\.?)?|United States)(?!\w)/.test(text) &&
    !/\b(?:canada|north america|americas|global|worldwide|anywhere)\b/i.test(text)
  )
}

const PROVINCES: Record<string, string> = {
  on: 'ontario', bc: 'british columbia', ab: 'alberta', qc: 'quebec', mb: 'manitoba', sk: 'saskatchewan',
  ns: 'nova scotia', nb: 'new brunswick', nl: 'newfoundland', pe: 'prince edward island',
}

/** Lowercase location with ", ON" style province codes spelled out, so "London, ON" matches "London, Ontario". */
export function normalizeLocation(location: string): string {
  return normalizeText(location)
    .toLowerCase()
    .replace(/,\s*(on|bc|ab|qc|mb|sk|ns|nb|nl|pe)\b/g, (_, code: string) => `, ${PROVINCES[code]}`)
}
