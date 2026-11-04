import { describe, expect, it } from 'vitest'
import { followUpDue } from '../../engine/followups.ts'
import { makeApplication, makeJob, samProfile, TZ } from '../../engine/fixtures.ts'
import { scoreJob } from '../../engine/score.ts'
import type { Profile } from '../../engine/types.ts'
import {
  answerRows,
  answerSource,
  answerStates,
  channelFor,
  newApplication,
  openApplicationFor,
  recordSubmission,
  resumeAdvice,
  resumeVersions,
  submissionTimeProblem,
} from './applyModel.ts'

function profileWith(answers: Profile['answers']): Profile {
  return { ...samProfile(), answers }
}

describe('answerRows', () => {
  const profile = profileWith([
    { id: 'auth', question: 'Are you legally authorized to work in Canada?', patterns: ['authorized to work in canada'], answer: 'Yes' },
    {
      id: 'salary',
      question: 'What are your salary expectations?',
      patterns: ['salary expectations'],
      answer: '',
      needsHuman: true,
      note: 'Decide per role.',
    },
    { id: 'eeo', question: 'Demographic questions', patterns: ['gender identity', 'ethnicity'], answer: '', needsHuman: true },
    { id: 'empty', question: 'When can you start?', patterns: ['when can you start'], answer: '' },
  ])
  const job = makeJob({ company: 'Northwind Apps' })

  it('suggests saved answers and says which saved answer each came from', () => {
    const rows = answerRows(profile, job, { skills: [] }, [])
    const auth = rows.find((row) => row.question.startsWith('Are you legally'))
    expect(auth?.decision).toMatchObject({ kind: 'answer', answerId: 'auth', answer: 'Yes' })
    expect(answerSource(auth!.decision, profile)).toBe('From your saved answer "Are you legally authorized to work in Canada?"')
  })

  it('flags every question a person must answer, with the reason', () => {
    const rows = answerRows(profile, job, { skills: [] }, [])
    const human = Object.fromEntries(rows.filter((row) => row.decision.kind === 'human').map((row) => [row.question, row.decision.reason]))
    expect(human['What are your salary expectations?']).toMatch(/answer yourself each time\. Decide per role\./)
    // Its own question text matches none of its patterns, so it is read directly, not matched.
    expect(human['Demographic questions']).toMatch(/answer yourself each time/)
    expect(human['When can you start?']).toMatch(/No saved answer yet/)
    // No submitted application to this company: "No" is left to you.
    expect(human['Have you previously applied to Northwind Apps?']).toMatch(/Answer No only if/)
  })

  it('answers "applied before" from the log', () => {
    const rows = answerRows(profile, job, { skills: [] }, [makeApplication({ company: 'Northwind Apps Inc.' })])
    expect(rows.find((row) => row.origin === 'history')?.decision).toMatchObject({ kind: 'answer', answer: 'Yes' })
  })

  it('asks about each required skill with the truth table, and leaves nice-to-haves out', () => {
    const rows = answerRows(profile, job, { skills: ['React', 'Node.js', 'Go', 'GraphQL'], preferredSkills: ['GraphQL'] }, [])
    const skills = rows.filter((row) => row.origin === 'skill')
    expect(skills.map((row) => row.question)).toEqual([
      'Do you have experience with React?',
      'Do you have experience with Node.js?',
      'Do you have experience with Go?',
    ])
    expect(skills[0].decision).toMatchObject({ kind: 'answer', answer: 'Yes' })
    // "Node.js" also reads as JavaScript's "js"; the row still answers about Node.js only.
    expect(skills[1].decision.answerId).toBe('skill:node.js')
    expect(skills[2].decision).toMatchObject({ kind: 'human', answerId: 'skill:go' })
  })

  it('adds questions pasted from the form', () => {
    const rows = answerRows(profile, job, { skills: [] }, [], ['Are you eligible to work in Canada? We mean authorized to work in Canada.'])
    expect(rows.at(-1)).toMatchObject({ origin: 'custom', decision: { kind: 'answer', answerId: 'auth' } })
  })
})

describe('answerStates', () => {
  const profile = profileWith([{ id: 'auth', question: 'Authorized in Canada?', patterns: ['authorized in canada'], answer: 'Yes' }])
  const rows = answerRows(profile, makeJob(), { skills: [] }, [])

  it('starts from the suggestion, unused', () => {
    expect(answerStates(rows, { opened: false, answers: {}, custom: [], noCover: false })[0]).toMatchObject({
      value: 'Yes',
      used: false,
      edited: false,
    })
  })

  it('keeps an edit and marks it as edited', () => {
    const states = answerStates(rows, {
      opened: false,
      answers: { 'Authorized in Canada?': { value: 'Yes, citizen', used: true } },
      custom: [],
      noCover: false,
    })
    expect(states[0]).toMatchObject({ value: 'Yes, citizen', used: true, edited: true })
  })
})

describe('recordSubmission', () => {
  const draft = makeApplication({
    status: 'prepared',
    appliedAt: undefined,
    history: [{ status: 'prepared', at: '2026-11-02T10:00:00.000Z', by: 'me' }],
  })
  const at = '2026-11-03T15:30:00.000Z'

  it('moves to applied, keeps the answers used, and schedules the follow-up', () => {
    const result = recordSubmission(
      draft,
      {
        at,
        answers: { 'Authorized in Canada?': ' Yes ', 'Salary?': '  ', '': 'stray' },
        resumeVersion: ' resume-a ',
        coverLetterId: 'app-1',
      },
      TZ,
    )
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.app).toMatchObject({
      status: 'applied',
      appliedAt: at,
      answersUsed: { 'Authorized in Canada?': 'Yes' },
      resumeVersion: 'resume-a',
      coverLetterId: 'app-1',
      followUp: { dueAt: followUpDue({ appliedAt: at }, TZ) },
    })
    expect(result.app.history.at(-1)).toEqual({ status: 'applied', at, by: 'me' })
  })

  it('keeps answers already recorded on the application, letting the kit override the same question', () => {
    const prefilled = { ...draft, answersUsed: { 'Authorized in Canada?': 'Yes', 'Start date?': 'Two weeks' } }
    const kept = recordSubmission(prefilled, { at, answers: {} }, TZ)
    expect(kept.ok && kept.app.answersUsed).toEqual({ 'Authorized in Canada?': 'Yes', 'Start date?': 'Two weeks' })
    const merged = recordSubmission(prefilled, { at, answers: { 'Start date?': 'One month', 'Relocate?': 'No' } }, TZ)
    expect(merged.ok && merged.app.answersUsed).toEqual({ 'Authorized in Canada?': 'Yes', 'Start date?': 'One month', 'Relocate?': 'No' })
  })

  it('refuses an application that is already past applied', () => {
    expect(recordSubmission(makeApplication({ status: 'rejected' }), { at, answers: {} }, TZ).ok).toBe(false)
  })
})

describe('submissionTimeProblem', () => {
  const now = '2026-11-03T15:00:00.000Z'
  it.each([
    [null, 'Enter the date and time you submitted it.'],
    ['2026-11-03T16:00:00.000Z', "That time hasn't happened yet."],
    ['2026-11-03T15:04:00.000Z', null],
    ['2026-10-30T09:00:00.000Z', null],
  ])('%s', (at, problem) => {
    expect(submissionTimeProblem(at, now)).toBe(problem)
  })
})

describe('starting an application', () => {
  it('guesses the channel from the posting', () => {
    expect(channelFor({ ats: 'greenhouse', source: 'greenhouse' })).toBe('ats')
    expect(channelFor({ ats: 'other', source: 'manual' })).toBe('company_site')
    expect(channelFor({ source: 'web-search' })).toBe('unknown')
  })

  it('creates a draft with one history entry', () => {
    const app = newApplication(makeJob({ ats: 'lever' }), 'app-new', '2026-11-03T15:00:00.000Z')
    expect(app).toMatchObject({ id: 'app-new', jobId: 'job-1', status: 'draft', channel: 'ats' })
    expect(app.history).toEqual([{ status: 'draft', at: '2026-11-03T15:00:00.000Z', by: 'me' }])
  })

  it('continues an open application instead of starting a second one', () => {
    const open = makeApplication({ id: 'open', status: 'reviewing' })
    expect(openApplicationFor('job-1', [makeApplication({ id: 'closed', status: 'rejected' }), open])).toBe(open)
    expect(openApplicationFor('job-1', [makeApplication({ status: 'withdrawn' })])).toBeUndefined()
  })
})

describe('resume', () => {
  it('lists versions by most recent use', () => {
    const apps = [
      makeApplication({ resumeVersion: 'old', history: [{ status: 'applied', at: '2026-10-01T00:00:00.000Z', by: 'me' }] }),
      makeApplication({ resumeVersion: 'new', history: [{ status: 'applied', at: '2026-11-01T00:00:00.000Z', by: 'me' }] }),
      makeApplication({ resumeVersion: undefined }),
    ]
    expect(resumeVersions(apps)).toEqual(['new', 'old'])
  })

  it('advises effort by score band', () => {
    const profile = samProfile()
    const strong = scoreJob(
      makeJob({ jdText: 'React, TypeScript and Node.js. New grads welcome.', postedAt: '2026-11-03T12:00:00.000Z' }),
      profile,
      '2026-11-03T13:00:00.000Z',
    )
    expect(resumeAdvice({ ...strong, total: 85 }, { skills: ['React'] })).toMatch(/tailored/)
    expect(resumeAdvice({ ...strong, total: 74 }, { skills: ['React', 'TypeScript'] })).toBe(
      'Scores 74: reorder your skills line so React, TypeScript come first. Add nothing new.',
    )
    expect(resumeAdvice({ ...strong, total: 60 }, {})).toMatch(/base resume is enough/)
    expect(resumeAdvice(null, {})).toBe('Use your base resume.')
  })
})
