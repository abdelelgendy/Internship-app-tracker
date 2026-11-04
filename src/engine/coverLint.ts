import { normalizeText, sentences, textMatcher } from './normalize.ts'
import { canonicalSkill, findSkills } from './skills.ts'
import type { Profile } from './types.ts'

/**
 * A cover-letter linter: the style rules from the old resume-tailor skill, plus a claims check
 * the old engine lacked. One of its letters passed every style rule and still said a project
 * was built with a framework it never used; the claims check exists to catch that.
 */

/** The banned phrases from resume-tailor SKILL.md. The profile can add more. */
export const BANNED_PHRASES = [
  'I am writing to express', 'passionate about', 'passion for', 'I believe I would be a great fit',
  'leveraging', 'utilizing', 'spearheading', 'orchestrating', 'I am eager to', 'I am excited to',
  'I am thrilled to', 'fast-paced environment', 'proven track record', 'I would love the opportunity',
  'align with my skills', 'diverse team', 'collaborative environment', 'esteemed organization',
  'prestigious company', 'hone my skills', 'further my career', 'value proposition', 'synergy',
  'paradigm', 'innovative solutions', 'dynamic team', 'cutting-edge', 'best practices',
]

export interface LintIssue {
  rule:
    | 'too_long' | 'paragraphs' | 'dash' | 'semicolon' | 'banned_phrase' | 'greeting'
    | 'sentence_start' | 'i_streak' | 'company_missing' | 'unverified_number' | 'unverified_name' | 'stack_claim'
  severity: 'error' | 'warning'
  message: string
  excerpt?: string
}

export interface LintResult {
  words: number
  paragraphs: number
  issues: LintIssue[]
  /** True when there are no errors. Warnings are worth reading but do not block. */
  ok: boolean
}

const DEFAULT_MAX_WORDS = 150
const GREETINGS = /^\s*(?:dear (?:hiring manager|sir|madam|recruiter|team)|to whom it may concern)\b/imu

// Words that start a capitalized run without naming anything.
const NOT_NAMES = new Set([
  'the', 'a', 'an', 'my', 'our', 'your', 'their', 'this', 'that', 'these', 'it', 'its', 'i', 'we', 'you',
  'january', 'february', 'march', 'april', 'may', 'june', 'july', 'august', 'september', 'october',
  'november', 'december', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday',
])

// Words that introduce an employer or a project by name: "at Acme", "built Acme". "for" is
// weaker ("for Canadian merchants"), so a name after it is a warning instead of an error.
const STRONG_CUES = [
  'at', 'joined', 'interned at', 'worked at', 'working at', 'work at', 'internship at', 'intern at', 'built',
  'building', 'created', 'made', 'shipped', 'launched', 'developed', 'wrote', 'called', 'named',
]
const WEAK_CUES = ['for']
// A capitalized word; a dot counts only inside a word ("Next.js"), so "Northwind." ends the name.
const NAME_TOKEN = String.raw`[A-Z0-9](?:[\p{L}\p{N}&+#'-]|\.(?=[\p{L}\p{N}]))*`

function cueRegex(cues: readonly string[]): RegExp {
  // Match the cue in either case at a sentence start ("At Northwind"), but require the name to be capitalized.
  const alternatives = cues.map((cue) => `[${cue[0].toUpperCase()}${cue[0]}]${cue.slice(1)}`).join('|')
  return new RegExp(String.raw`(?<![\p{L}])(?:${alternatives})\s+(${NAME_TOKEN}(?:\s+(?:${NAME_TOKEN}|of|and|&)){0,5})`, 'gu')
}
const NAME_CUES: readonly [RegExp, LintIssue['severity']][] = [
  [cueRegex(STRONG_CUES), 'error'],
  [cueRegex(WEAK_CUES), 'warning'],
]

function countWords(text: string): number {
  return text.trim() === '' ? 0 : text.trim().split(/\s+/).length
}

/**
 * Everything a letter may draw on: approved facts, verified experience and projects, education,
 * skills and identity. An entry marked unverified is left out, so its numbers and names are flagged.
 */
function approvedCorpus(profile: Profile, company: string): string {
  return [
    profile.name, profile.preferredName, profile.coverLetter.signature, company,
    profile.location.city, profile.location.region, profile.location.country,
    ...profile.facts.flatMap((fact) => [fact.label, fact.value]),
    ...profile.experience.filter((job) => job.verified).flatMap((job) => [job.org, job.title, job.start, job.end ?? '', job.location ?? '', job.summary ?? '', ...job.bullets]),
    ...profile.projects.filter((project) => project.verified !== false).flatMap((project) => [project.name, project.slug, project.oneLiner, ...project.bullets, ...project.stack]),
    ...profile.education.flatMap((entry) => [entry.school, entry.degree, entry.field, entry.end ?? '', entry.notes ?? '']),
    ...profile.skills.map((skill) => skill.name),
  ].join('\n')
}

function numberTokens(text: string): { raw: string; key: string }[] {
  const tokens: { raw: string; key: string }[] = []
  for (const match of text.matchAll(/(?<![\p{L}\p{N}.])(\d[\d,]*(?:\.\d+)?)\s?(%|[kK](?![\p{L}]))?/gu)) {
    const value = Number(match[1].replace(/,/g, '')) * (match[2] && match[2].toLowerCase() === 'k' ? 1000 : 1)
    tokens.push({ raw: match[0].trim(), key: `${value}${match[2] === '%' ? '%' : ''}` })
  }
  return tokens
}

function claimIssues(text: string, profile: Profile, company: string): LintIssue[] {
  const issues: LintIssue[] = []
  const corpus = approvedCorpus(profile, company)
  const corpusMatcher = textMatcher(corpus)

  const approvedNumbers = new Set(numberTokens(normalizeText(corpus)).map((token) => token.key))
  const companyNumbers = new Set(numberTokens(company).map((token) => token.key))
  const reported = new Set<string>()
  for (const token of numberTokens(normalizeText(text))) {
    if (approvedNumbers.has(token.key) || companyNumbers.has(token.key) || reported.has(token.key)) continue
    reported.add(token.key)
    issues.push({
      rule: 'unverified_number',
      severity: 'error',
      message: `"${token.raw}" is not in your approved facts, experience or projects. Use only numbers you can back up.`,
      excerpt: token.raw,
    })
  }

  for (const [pattern, severity] of NAME_CUES) {
    for (const match of normalizeText(text).matchAll(pattern)) {
      // "Northwind Labs and Pinecrest Studio" names two places; check each one.
      for (const segment of match[1].split(/\s+(?:and|&)\s+/)) {
        const words = segment.split(/\s+/)
        while (words.length > 0 && NOT_NAMES.has(words[0].toLowerCase())) words.shift()
        // "At Pinecrest Studio I built": the name ends where the sentence carries on.
        const end = words.findIndex((word) => NOT_NAMES.has(word.toLowerCase().replace(/'.*$/, '')))
        if (end !== -1) words.length = end
        while (words.length > 0 && /^(?:of|and|&)$/i.test(words[words.length - 1])) words.pop()
        const name = words.join(' ').replace(/'s$/, '').replace(/['-]+$/, '')
        if (name === '' || /^\d/.test(name) || reported.has(name.toLowerCase())) continue
        if (corpusMatcher.has(name) || canonicalSkill(name) || findSkills(name).length > 0) continue
        reported.add(name.toLowerCase())
        issues.push({
          rule: 'unverified_name',
          severity,
          message: `"${name}" is not an employer, project or skill on your profile. Name only places and projects you can back up.`,
          excerpt: name,
        })
      }
    }
  }

  for (const sentence of sentences(text)) {
    const words = textMatcher(sentence)
    const named = profile.projects.filter((project) => words.has(project.name) || words.has(project.slug))
    // With two projects in one sentence the tool can't tell which tool belongs to which.
    if (named.length !== 1) continue
    const project = named[0]
    const stack = new Set(project.stack.flatMap((item) => { const name = canonicalSkill(item); return name ? [name] : findSkills(item, true) }))
    for (const skill of findSkills(sentence)) {
      if (stack.has(skill)) continue
      issues.push({
        rule: 'stack_claim',
        severity: 'warning',
        message: `${project.name}'s stack on your profile does not list ${skill}. Check the sentence before sending.`,
        excerpt: sentence,
      })
    }
  }
  return issues
}

/**
 * Lints a plain-text cover letter. Errors break a rule from the style guide or make a claim the
 * profile does not back; warnings are worth a second look.
 */
export function lintCoverLetter(text: string, profile: Profile, options: { company?: string } = {}): LintResult {
  const issues: LintIssue[] = []
  const company = options.company ?? ''
  const words = countWords(text)
  const maxWords = profile.coverLetter.maxWords || DEFAULT_MAX_WORDS
  // A sign-off such as "Thanks,\nSam" is not a paragraph.
  const bodyParagraphs = text.split(/\n\s*\n/).filter((block) => countWords(block) > 5).length

  if (words > maxWords) issues.push({ rule: 'too_long', severity: 'error', message: `${words} words; keep it to ${maxWords} or fewer.` })
  if (bodyParagraphs > 0 && (bodyParagraphs < 3 || bodyParagraphs > 4)) {
    issues.push({ rule: 'paragraphs', severity: 'warning', message: `${bodyParagraphs} paragraph${bodyParagraphs === 1 ? '' : 's'}; aim for 3 or 4 short ones.` })
  }
  if (/[\u2013\u2014]/u.test(text)) issues.push({ rule: 'dash', severity: 'error', message: 'Uses an em or en dash. Use a comma, a period or "to" instead.' })
  if (text.includes(';')) issues.push({ rule: 'semicolon', severity: 'error', message: 'Uses a semicolon. Split it into two sentences.' })
  if (GREETINGS.test(text)) issues.push({ rule: 'greeting', severity: 'error', message: 'Opens with a generic greeting. Start with the point instead.' })

  const matcher = textMatcher(text)
  const banned = [...new Set([...BANNED_PHRASES, ...profile.coverLetter.bannedPhrases])]
    .filter((phrase) => !['\u2013', '\u2014', ';'].includes(phrase.trim()))
  const found = matcher.which(banned)
  // Report "passionate about" once, not also "passionate".
  const longest = found.filter((phrase) => !found.some((other) => other !== phrase && other.toLowerCase().includes(phrase.toLowerCase())))
  for (const phrase of longest) {
    issues.push({ rule: 'banned_phrase', severity: 'error', message: `Uses "${phrase}", which is on the banned list.`, excerpt: phrase })
  }

  let streak = 0
  for (const sentence of sentences(text)) {
    if (/^(?:As a|With my)\b/u.test(sentence)) {
      issues.push({ rule: 'sentence_start', severity: 'error', message: `A sentence starts with "${sentence.split(' ').slice(0, 2).join(' ')}".`, excerpt: sentence })
    }
    streak = /^I\b/u.test(sentence) ? streak + 1 : 0
    if (streak === 3) issues.push({ rule: 'i_streak', severity: 'error', message: 'Three sentences in a row start with "I".', excerpt: sentence })
  }

  if (company && !matcher.has(company)) issues.push({ rule: 'company_missing', severity: 'error', message: `Does not name ${company}.` })
  issues.push(...claimIssues(text, profile, company))
  return { words, paragraphs: bodyParagraphs, issues, ok: issues.every((issue) => issue.severity !== 'error') }
}
