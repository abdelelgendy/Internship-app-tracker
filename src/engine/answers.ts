import { normalizeCompany, textMatcher } from './normalize.ts'
import { findSkills, indexProfileSkills, profileLevelFor } from './skills.ts'
import { wasSubmitted } from './states.ts'
import type { Application, Profile, SkillLevel } from './types.ts'

/**
 * Canonical answers for application questions. The tool suggests an answer only when it is
 * sure; anything else goes to a person, with the reason. It never invents: skill questions are
 * answered from the levels on your profile, and an unknown question is never guessed.
 */

export type AnswerDecision =
  | { kind: 'answer'; answerId: string; answer: string; reason: string }
  /** A person must answer. `draft` is a saved answer to start from, if there is one. */
  | { kind: 'human'; answerId: string | null; reason: string; draft?: string }

export interface AnswerContext {
  /** The company the form belongs to, for "Have you applied here before?" */
  company?: string
  applications?: readonly Pick<Application, 'company' | 'status' | 'history'>[]
}

const YEARS_QUESTION = /\b(?:how many years|years of|years with|years using|years'? experience|number of years|years in)\b/iu
const EXPERIENCE_QUESTION =
  /\b(?:(?:do|did) you have (?:any |prior |previous |hands-on |professional )?experience|have you (?:ever )?(?:used|worked with|built with|developed with)|are you (?:familiar|proficient|comfortable|experienced) (?:with|in)|experience (?:with|using|in))\b/iu
const PREVIOUSLY_APPLIED =
  /\b(?:previously applied|applied (?:to|at|with) (?:this company|us|our company)(?: before)?|applied here before|applied for a (?:position|role|job) with us)\b/iu

function human(answerId: string | null, reason: string, draft?: string): AnswerDecision {
  return draft ? { kind: 'human', answerId, reason, draft } : { kind: 'human', answerId, reason }
}

/** Truth table for "Do you have experience with X?": only strong and working skills get a yes. */
function experienceAnswer(skill: string, level: SkillLevel | null): AnswerDecision {
  const answerId = `skill:${skill.toLowerCase()}`
  if (level === 'strong' || level === 'working') {
    return { kind: 'answer', answerId, answer: 'Yes', reason: `You list ${skill} as a ${level} skill.` }
  }
  if (level === 'familiar') {
    return human(answerId, `You list ${skill} as familiar. Decide whether that counts as experience for this role.`)
  }
  return human(answerId, `${skill} is not in your skills list. Answer No only if that is true.`)
}

function matchingEntries(question: string, profile: Profile) {
  const words = textMatcher(question)
  return profile.answers
    .map((entry) => ({ entry, length: Math.max(0, ...words.which(entry.patterns).map((pattern) => pattern.length)) }))
    .filter((hit) => hit.length > 0)
    .sort((a, b) => b.length - a.length)
}

function fromEntry(entry: Profile['answers'][number], reason: string): AnswerDecision {
  if (entry.needsHuman) {
    const note = entry.note ? ` ${entry.note}` : ''
    return human(entry.id, `Your saved answer for "${entry.question}" is marked to answer yourself each time.${note}`, entry.answer || undefined)
  }
  if (entry.answer.trim() === '') return human(entry.id, `No saved answer yet for "${entry.question}".`)
  return { kind: 'answer', answerId: entry.id, answer: entry.answer, reason }
}

/** Years of X: needs a saved answer for that skill that is not marked for review, and the skill on the profile. */
function yearsAnswer(skill: string, level: SkillLevel | null, profile: Profile): AnswerDecision {
  if (level === null) {
    return human(`skill:${skill.toLowerCase()}`, `${skill} is not in your skills list, so the tool won't suggest a number of years.`)
  }
  // Questions word this many ways ("years of React", "how many years ... with React"), so the
  // saved answer is found by its skill, not by an exact pattern.
  const specific = profile.answers.find((entry) => {
    const text = [entry.question, ...entry.patterns].join('\n')
    return /\byears?\b/i.test(text) && findSkills(text, true).includes(skill)
  })
  if (!specific) {
    return human(`skill:${skill.toLowerCase()}`, `No saved years answer for ${skill}. You list it as ${level}; add a years answer to your profile.`)
  }
  return fromEntry(specific, `From your saved answer "${specific.question}". You list ${skill} as ${level}.`)
}

function previouslyApplied(company: string, applications: NonNullable<AnswerContext['applications']>): AnswerDecision {
  const key = normalizeCompany(company)
  const count = applications.filter((app) => normalizeCompany(app.company) === key && wasSubmitted(app)).length
  if (count > 0) {
    return {
      kind: 'answer',
      answerId: 'computed:previously-applied',
      answer: 'Yes',
      reason: `Your log shows ${count} submitted application${count === 1 ? '' : 's'} to ${company}.`,
    }
  }
  return human('computed:previously-applied', `Your log has no application to ${company}. Answer No only if you have not applied outside this tool.`)
}

/** The full decision for one form question, with the reason a person sees. */
export function explainAnswer(question: string, profile: Profile, context: AnswerContext = {}): AnswerDecision {
  if (question.trim() === '') return human(null, 'The question is empty.')

  if (PREVIOUSLY_APPLIED.test(question) && context.company && context.applications) {
    return previouslyApplied(context.company, context.applications)
  }

  const isYears = YEARS_QUESTION.test(question)
  if (isYears || EXPERIENCE_QUESTION.test(question)) {
    const skills = indexProfileSkills(profile.skills)
    const subjects = findSkills(question, true)
    if (subjects.length > 1) {
      return human(null, `Asks about more than one skill (${subjects.join(', ')}). Answer it yourself.`)
    }
    if (subjects.length === 1) {
      const level = profileLevelFor(skills, subjects[0])
      return isYears ? yearsAnswer(subjects[0], level, profile) : experienceAnswer(subjects[0], level)
    }
    const words = textMatcher(question)
    const named = skills.filter((skill) => skill.phrases.some((phrase) => words.has(phrase)))
    if (named.length === 1 && !isYears) return experienceAnswer(named[0].name, named[0].level)
    // No single skill named ("years of professional experience"): the saved answers decide below.
  }

  const hits = matchingEntries(question, profile)
  if (hits.length === 0) return human(null, 'No saved answer matches this question.')
  const best = hits.filter((hit) => hit.length === hits[0].length)
  const answers = new Set(best.map((hit) => hit.entry.answer))
  if (best.length > 1 && answers.size > 1) {
    return human(null, `Matches more than one saved answer (${best.map((hit) => `"${hit.entry.question}"`).join(', ')}).`)
  }
  const entry = best[0].entry
  return fromEntry(entry, `Matches your saved answer "${entry.question}".`)
}

/** The answer to paste, or null when a person must answer. Null is the safe default, never a guess. */
export function answerFor(question: string, profile: Profile, context: AnswerContext = {}): { answer: string; answerId: string } | null {
  const decision = explainAnswer(question, profile, context)
  return decision.kind === 'answer' ? { answer: decision.answer, answerId: decision.answerId } : null
}
