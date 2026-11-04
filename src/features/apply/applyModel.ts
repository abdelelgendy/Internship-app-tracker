import { explainAnswer, type AnswerDecision } from '../../engine/answers.ts'
import { toMillis, type Instant } from '../../engine/dates.ts'
import { followUpDue } from '../../engine/followups.ts'
import { isTerminal, transition, type TransitionResult } from '../../engine/states.ts'
import { indexProfileSkills, profileLevelFor } from '../../engine/skills.ts'
import type { Application, Job, JobFacts, Profile, ScoreResult } from '../../engine/types.ts'
import type { KitDraft } from './kitDraft.ts'

/**
 * The apply kit's logic, kept out of the components so it can be tested on its own. The kit
 * prepares and records; the person fills in and submits the form on the company's site.
 */

// ---------- Starting an application ----------

/** How the application is sent, guessed from where the posting lives. */
export function channelFor(job: Pick<Job, 'ats' | 'source'>): Application['channel'] {
  if (job.ats && job.ats !== 'other') return 'ats'
  if (job.source === 'manual') return 'company_site'
  return 'unknown'
}

/** An open application for this job, if one exists: starting again should continue it. */
export function openApplicationFor(jobId: string, applications: readonly Application[]): Application | undefined {
  return applications.find((app) => app.jobId === jobId && !isTerminal(app.status))
}

/** A new draft application for a job. */
export function newApplication(job: Job, id: string, at: string): Application {
  return {
    id,
    jobId: job.id,
    company: job.company,
    title: job.title,
    url: job.url,
    status: 'draft',
    history: [{ status: 'draft', at, by: 'me' }],
    channel: channelFor(job),
  }
}

// ---------- Form answers ----------

export type QuestionOrigin = 'saved' | 'history' | 'skill' | 'custom'

export interface AnswerRow {
  /** The question as it is recorded in answersUsed. */
  question: string
  origin: QuestionOrigin
  decision: AnswerDecision
}

/**
 * A saved answer, read directly. Used when the engine's question matching lands on a different
 * entry, for example a saved entry whose question text does not contain its own patterns
 * ("Demographic and equal opportunity questions"). Same rules as engine/answers.ts.
 */
function savedEntryDecision(entry: Profile['answers'][number]): AnswerDecision {
  if (entry.needsHuman) {
    const note = entry.note ? ` ${entry.note}` : ''
    const reason = `Your saved answer for "${entry.question}" is marked to answer yourself each time.${note}`
    return entry.answer ? { kind: 'human', answerId: entry.id, reason, draft: entry.answer } : { kind: 'human', answerId: entry.id, reason }
  }
  if (entry.answer.trim() === '') return { kind: 'human', answerId: entry.id, reason: `No saved answer yet for "${entry.question}".` }
  return { kind: 'answer', answerId: entry.id, answer: entry.answer, reason: `Your saved answer "${entry.question}".` }
}

/**
 * The engine's truth table for "Do you have experience with X?", applied to a skill we already
 * know. Used when the engine reads more than one skill into the question: "React Native" also
 * names React.
 */
function skillDecision(skill: string, profile: Profile): AnswerDecision {
  const answerId = `skill:${skill.toLowerCase()}`
  const level = profileLevelFor(indexProfileSkills(profile.skills), skill)
  if (level === 'strong' || level === 'working') {
    return { kind: 'answer', answerId, answer: 'Yes', reason: `You list ${skill} as a ${level} skill.` }
  }
  if (level === 'familiar') {
    return { kind: 'human', answerId, reason: `You list ${skill} as familiar. Decide whether that counts as experience for this role.` }
  }
  return { kind: 'human', answerId, reason: `${skill} is not in your skills list. Answer No only if that is true.` }
}

/**
 * The questions to prepare: every saved answer on the profile, whether you applied to this
 * company before (from the log), and "experience with X" for each skill the posting requires.
 * Each decision comes from the engine; when the engine has no answer, a person answers.
 */
export function answerRows(
  profile: Profile,
  job: Pick<Job, 'company'>,
  facts: JobFacts,
  applications: readonly Application[],
  custom: readonly string[] = [],
): AnswerRow[] {
  const context = { company: job.company, applications }
  const rows: AnswerRow[] = profile.answers.map((entry) => {
    const decision = explainAnswer(entry.question, profile, context)
    return { question: entry.question, origin: 'saved', decision: decision.answerId === entry.id ? decision : savedEntryDecision(entry) }
  })
  const historyQuestion = `Have you previously applied to ${job.company}?`
  rows.push({ question: historyQuestion, origin: 'history', decision: explainAnswer(historyQuestion, profile, context) })

  const preferred = new Set(facts.preferredSkills ?? [])
  for (const skill of (facts.skills ?? []).filter((name) => !preferred.has(name))) {
    const question = `Do you have experience with ${skill}?`
    const decision = explainAnswer(question, profile, context)
    rows.push({
      question,
      origin: 'skill',
      decision: decision.answerId === `skill:${skill.toLowerCase()}` ? decision : skillDecision(skill, profile),
    })
  }
  for (const question of custom) {
    rows.push({ question, origin: 'custom', decision: explainAnswer(question, profile, context) })
  }
  return rows
}

/** Where a suggested answer came from, in words: a saved answer, your skills, or your log. */
export function answerSource(decision: AnswerDecision, profile: Profile): string {
  if (decision.answerId === null) return decision.reason
  const saved = profile.answers.find((entry) => entry.id === decision.answerId)
  if (saved) return `From your saved answer "${saved.question}"`
  return decision.reason
}

/** What to start from in the answer box: the suggestion, or a saved draft for a question you answer yourself. */
export function initialAnswer(decision: AnswerDecision): string {
  return decision.kind === 'answer' ? decision.answer : (decision.draft ?? '')
}

export interface AnswerState {
  row: AnswerRow
  value: string
  used: boolean
  edited: boolean
}

/** The current value of every row: your edit if there is one, else the suggestion or saved draft. */
export function answerStates(rows: readonly AnswerRow[], draft: KitDraft): AnswerState[] {
  return rows.map((row) => {
    const suggestion = initialAnswer(row.decision)
    const saved = draft.answers[row.question]
    const value = saved?.value ?? suggestion
    return { row, value, used: saved?.used ?? false, edited: saved !== undefined && saved.value !== suggestion }
  })
}

// ---------- Resume ----------

/** Resume versions used before, most recent first, so the picker offers what exists. */
export function resumeVersions(applications: readonly Application[]): string[] {
  const latest = new Map<string, number>()
  for (const app of applications) {
    if (!app.resumeVersion) continue
    const at = Math.max(0, ...app.history.map((entry) => toMillis(entry.at) ?? 0))
    latest.set(app.resumeVersion, Math.max(latest.get(app.resumeVersion) ?? 0, at))
  }
  return [...latest.entries()].sort((a, b) => b[1] - a[1]).map(([version]) => version)
}

/**
 * How much to change the resume for this posting (the "barbell" from job-hunter, with the
 * 70-79 band from decision table 1.10 #5): tailor at 80 and up, reorder the skills line at 70
 * to 79, and send the base resume below that.
 */
export function resumeAdvice(score: ScoreResult | null, facts: JobFacts): string {
  if (!score || score.tier === null) return 'Use your base resume.'
  const skills = (facts.skills ?? []).slice(0, 4)
  if (score.total >= 80) return `Scores ${score.total}: worth a resume tailored to this posting.`
  if (score.total >= 70) {
    return skills.length > 0
      ? `Scores ${score.total}: reorder your skills line so ${skills.join(', ')} come first. Add nothing new.`
      : `Scores ${score.total}: reorder your skills line to match the posting. Add nothing new.`
  }
  return `Scores ${score.total}: your base resume is enough.`
}

// ---------- Recording the submission ----------

export interface Submission {
  /** When you submitted it, as an ISO string. */
  at: string
  /** Question to the exact answer you gave, for answering the same way next time. */
  answers: Record<string, string>
  resumeVersion?: string
  coverLetterId?: string
}

/**
 * Records that you submitted the application yourself: the status moves to applied (which sets
 * appliedAt), the answers you used are added to the ones already recorded (npm run prefill
 * records the answers it filled), and the follow-up is scheduled for day 7.
 */
export function recordSubmission(app: Application, submission: Submission, timeZone: string): TransitionResult {
  const moved = transition(app, 'applied', submission.at, 'me')
  if (!moved.ok) return moved
  const dueAt = followUpDue(moved.app, timeZone)
  const answers = Object.fromEntries(
    Object.entries(submission.answers)
      .map(([question, answer]) => [question.trim(), answer.trim()] as const)
      .filter(([question, answer]) => question !== '' && answer !== ''),
  )
  return {
    ok: true,
    app: {
      ...moved.app,
      answersUsed: { ...(moved.app.answersUsed ?? {}), ...answers },
      resumeVersion: submission.resumeVersion?.trim() || moved.app.resumeVersion,
      coverLetterId: submission.coverLetterId ?? moved.app.coverLetterId,
      followUp: dueAt ? { dueAt } : moved.app.followUp,
    },
  }
}

/** A submission time can't be in the future; a few minutes of clock difference is allowed. */
export function submissionTimeProblem(at: string | null, now: Instant): string | null {
  const ms = toMillis(at)
  const nowMs = toMillis(now)
  if (ms === null || nowMs === null) return 'Enter the date and time you submitted it.'
  if (ms > nowMs + 5 * 60_000) return "That time hasn't happened yet."
  return null
}
