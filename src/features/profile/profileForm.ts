import type { Profile, SkillLevel } from '@/engine/types.ts'

/**
 * The editable parts of a profile: validation and clean-up before saving. While editing, list
 * fields keep blank lines (so pressing Enter in a "one per line" box works); `cleanProfile`
 * drops them, trims text and gives new answers an id.
 */

export type SectionId = 'links' | 'skills' | 'answers' | 'cover' | 'facts'

export interface ProfileIssue {
  section: SectionId
  /** The field the issue belongs to, such as "skills.2.name". */
  field: string
  message: string
}

export type Answer = Profile['answers'][number]

export const SKILL_LEVELS: readonly { level: SkillLevel; label: string; meaning: string }[] = [
  { level: 'strong', label: 'Strong', meaning: 'you use it every week and can explain it in depth' },
  { level: 'working', label: 'Working', meaning: 'you used it for real in a shipped project and can walk through it' },
  { level: 'familiar', label: 'Familiar', meaning: 'used once, lightly, or only in coursework' },
]

export const LINK_FIELDS: readonly { key: keyof Profile['links']; label: string }[] = [
  { key: 'linkedin', label: 'LinkedIn' },
  { key: 'github', label: 'GitHub' },
  { key: 'portfolio', label: 'Portfolio' },
]

const DEMOGRAPHIC =
  /\b(gender|sex|race|racial|ethnic\w*|veteran|disabilit\w*|sexual orientation|pronoun\w*|lgbt\w*|indigenous|aboriginal|visible minority|demographic\w*|equal (employment )?opportunity|eeo|self[- ]identif\w*|date of birth)\b/i

/**
 * True for voluntary self-identification answers (gender, race, disability, veteran status and
 * the like). The demo never shows them, and Shortlist never answers them for you.
 */
export function isDemographicAnswer(answer: Pick<Answer, 'id' | 'question' | 'patterns'>): boolean {
  return /^eeo\b/i.test(answer.id) || [answer.question, ...answer.patterns].some((text) => DEMOGRAPHIC.test(text))
}

/** Lines of a "one per line" box, as typed. */
export function toLines(text: string): string[] {
  return text.split('\n')
}

function cleanList(items: readonly string[]): string[] {
  return items.map((item) => item.trim()).filter(Boolean)
}

export function slugify(text: string): string {
  return (
    text
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 48)
      .replace(/-+$/, '') || 'answer'
  )
}

function uniqueId(base: string, taken: Set<string>): string {
  let id = base
  for (let suffix = 2; taken.has(id); suffix += 1) id = `${base}-${suffix}`
  taken.add(id)
  return id
}

/** The profile as it will be saved: text trimmed, blank list lines dropped, new answers given an id. */
export function cleanProfile(profile: Profile): Profile {
  const taken = new Set(profile.answers.map((answer) => answer.id.trim()).filter(Boolean))
  const links: Profile['links'] = { ...profile.links }
  for (const { key } of LINK_FIELDS) {
    const value = links[key]?.trim()
    if (value) links[key] = value
    else delete links[key]
  }
  return {
    ...profile,
    links,
    skills: profile.skills.map((skill) => {
      const evidence = skill.evidence?.trim()
      return evidence ? { ...skill, name: skill.name.trim(), evidence } : { name: skill.name.trim(), level: skill.level }
    }),
    answers: profile.answers.map((answer) => {
      const cleaned: Answer = {
        ...answer,
        id: answer.id.trim() || uniqueId(slugify(answer.question), taken),
        question: answer.question.trim(),
        patterns: cleanList(answer.patterns),
        answer: answer.answer.trim(),
      }
      if (!cleaned.needsHuman) delete cleaned.needsHuman
      const note = answer.note?.trim()
      if (note) cleaned.note = note
      else delete cleaned.note
      return cleaned
    }),
    coverLetter: {
      ...profile.coverLetter,
      signature: profile.coverLetter.signature.trim(),
      voiceNotes: cleanList(profile.coverLetter.voiceNotes),
      bannedPhrases: cleanList(profile.coverLetter.bannedPhrases),
    },
    facts: profile.facts.map((fact) => ({ label: fact.label.trim(), value: fact.value.trim(), source: fact.source.trim() })),
  }
}

function isWebAddress(value: string): boolean {
  try {
    const url = new URL(value)
    return (url.protocol === 'https:' || url.protocol === 'http:') && url.hostname.includes('.')
  } catch {
    return false
  }
}

/** Problems that stop a save, in the order the sections appear. Run it on a cleaned profile. */
export function validateProfile(profile: Profile): ProfileIssue[] {
  const issues: ProfileIssue[] = []
  const add = (section: SectionId, field: string, message: string) => issues.push({ section, field, message })

  for (const { key, label } of LINK_FIELDS) {
    const value = profile.links[key]
    if (value && !isWebAddress(value)) add('links', `links.${key}`, `${label} needs a full web address that starts with https://.`)
  }

  const skillNames = new Map<string, number>()
  profile.skills.forEach((skill, index) => {
    if (!skill.name) add('skills', `skills.${index}.name`, 'Add the skill name, or remove the row.')
    const key = skill.name.toLowerCase()
    const first = skillNames.get(key)
    if (skill.name && first !== undefined) add('skills', `skills.${index}.name`, `"${skill.name}" is already in row ${first + 1}. Keep one.`)
    else skillNames.set(key, index)
    if (!SKILL_LEVELS.some((level) => level.level === skill.level)) add('skills', `skills.${index}.level`, 'Choose a level.')
  })

  const answerIds = new Set<string>()
  profile.answers.forEach((answer, index) => {
    if (!answer.question) add('answers', `answers.${index}.question`, 'Add the question as a form would ask it.')
    if (answer.patterns.length === 0) add('answers', `answers.${index}.patterns`, 'Add at least one pattern: words that a form question with this answer would contain.')
    if (!answer.answer && !answer.needsHuman) add('answers', `answers.${index}.answer`, 'Write the answer, or tick "I answer this myself".')
    if (answerIds.has(answer.id)) add('answers', `answers.${index}.question`, `Another answer already has the id "${answer.id}". Change one question.`)
    answerIds.add(answer.id)
  })

  const { signature, maxWords } = profile.coverLetter
  if (!signature) add('cover', 'coverLetter.signature', 'Add the name you sign cover letters with.')
  if (!Number.isInteger(maxWords) || maxWords < 50 || maxWords > 1000) add('cover', 'coverLetter.maxWords', 'Use a whole number of words from 50 to 1000.')

  profile.facts.forEach((fact, index) => {
    if (!fact.label) add('facts', `facts.${index}.label`, 'Add a short label, such as "Degree".')
    if (!fact.value) add('facts', `facts.${index}.value`, 'Add the fact itself.')
    if (!fact.source) add('facts', `facts.${index}.source`, 'Say where this fact can be checked, such as a transcript or a repo.')
  })
  return issues
}

/** True when two profiles would save the same. */
export function sameProfile(a: Profile, b: Profile): boolean {
  return JSON.stringify(cleanProfile(a)) === JSON.stringify(cleanProfile(b))
}
