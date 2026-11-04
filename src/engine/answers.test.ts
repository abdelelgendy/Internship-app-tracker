import { describe, expect, it } from 'vitest'
import { answerFor, explainAnswer } from './answers.ts'
import { makeApplication, samProfile } from './fixtures.ts'

const profile = samProfile()

describe('saved answers by pattern', () => {
  it.each([
    ['Are you legally authorized to work in Canada?', 'Yes', 'work-auth-canada'],
    ['Are you authorized to work in the United States?', 'No', 'work-auth-us'],
    ['Will you now or in the future require visa sponsorship?', 'No', 'sponsorship'],
    ['LinkedIn Profile URL', 'https://www.linkedin.com/in/example-sam', 'linkedin'],
  ])('%s -> %s', (question, answer, answerId) => {
    expect(answerFor(question, profile)).toEqual({ answer, answerId })
  })

  it('picks the most specific pattern', () => {
    // "require sponsorship" would say No; the longer US pattern wins and needs a person.
    const decision = explainAnswer('Will you require sponsorship to work in the US?', profile)
    expect(decision).toMatchObject({ kind: 'human', answerId: 'sponsorship-us' })
    expect(decision.reason).toMatch(/remote from Canada/)
  })

  it('hands needs-human answers to a person, with the saved draft', () => {
    expect(explainAnswer('What is your earliest start date?', profile)).toMatchObject({
      kind: 'human',
      answerId: 'start-date',
      draft: 'Two weeks after an offer',
    })
    expect(answerFor('What are your salary expectations?', profile)).toBeNull()
  })

  it('never answers from an empty saved answer', () => {
    expect(explainAnswer('Portfolio URL', profile)).toMatchObject({ kind: 'human', answerId: 'portfolio' })
  })

  it('returns null for an unknown question', () => {
    expect(explainAnswer('What is your favourite colour?', profile)).toEqual({
      kind: 'human',
      answerId: null,
      reason: 'No saved answer matches this question.',
    })
    expect(answerFor('   ', profile)).toBeNull()
  })

  it('refuses to choose between two saved answers that tie', () => {
    const tied = samProfile()
    tied.answers = [
      { id: 'a', question: 'Relocate?', patterns: ['relocate'], answer: 'Yes' },
      { id: 'b', question: 'Relocate within Canada?', patterns: ['relocate'], answer: 'Only within Ontario' },
    ]
    expect(answerFor('Are you willing to relocate?', tied)).toBeNull()
  })
})

describe('"Do you have experience with X?" truth table', () => {
  it.each([
    ['Do you have experience with React?', 'Yes'], // strong
    ['Do you have experience with TypeScript?', 'Yes'], // working
    ['Have you worked with postgres?', 'Yes'], // working, through an alias
    ['Are you familiar with tailwind?', 'Yes'],
    ['Do you have experience with Git?', 'Yes'],
    ['Do you have hands-on experience with manual QA?', 'Yes'], // a profile phrase, not a vocabulary skill
  ])('%s -> %s', (question, answer) => {
    expect(answerFor(question, profile)?.answer).toBe(answer)
  })

  it.each([
    ['Do you have experience with Docker?', /familiar/], // familiar: a person decides
    ['Do you have experience with Kubernetes?', /not in your skills list/], // not listed: never "Yes"
    ['Do you have experience with React and Kotlin?', /more than one skill/],
  ])('%s -> a person decides', (question, reason) => {
    const decision = explainAnswer(question, profile)
    expect(decision.kind).toBe('human')
    expect(decision.reason).toMatch(reason)
  })
})

describe('years-of-experience questions', () => {
  it('uses a saved, confirmed years answer for a listed skill', () => {
    expect(explainAnswer('How many years of experience do you have with React?', profile)).toMatchObject({
      kind: 'answer',
      answerId: 'years-react',
      answer: '1',
    })
  })

  it('sends a years answer marked for review to a person', () => {
    expect(explainAnswer('How many years of Python experience do you have?', profile)).toMatchObject({
      kind: 'human',
      answerId: 'years-python',
      draft: '1',
    })
  })

  it.each([
    ['How many years of experience do you have with TypeScript?', /No saved years answer for TypeScript/],
    ['How many years of experience do you have with Kotlin?', /not in your skills list/],
    ['How many years of professional experience do you have?', /marked to answer yourself/],
  ])('%s -> a person decides', (question, reason) => {
    const decision = explainAnswer(question, profile)
    expect(decision.kind).toBe('human')
    expect(decision.reason).toMatch(reason)
  })

  it('does not read "digital" as Git', () => {
    const decision = explainAnswer('How many years of digital marketing experience do you have?', profile)
    expect(decision.kind).toBe('human')
    expect(decision.answerId).not.toBe('git')
  })

  it('does not answer a years question just because the skill is strong', () => {
    const noYears = samProfile()
    noYears.answers = noYears.answers.filter((entry) => entry.id !== 'years-react')
    expect(answerFor('How many years of experience do you have with React?', noYears)).toBeNull()
  })
})

describe('"Have you applied here before?"', () => {
  const question = 'Have you previously applied to this company?'
  const applications = [
    makeApplication({ company: 'Northwind Apps Inc.', status: 'rejected' }),
    makeApplication({ company: 'Globex', status: 'prepared', history: [], appliedAt: undefined }),
    makeApplication({
      company: 'Initrode',
      status: 'withdrawn',
      history: [
        { status: 'draft', at: '2026-10-01T12:00:00Z', by: 'me' },
        { status: 'withdrawn', at: '2026-10-02T12:00:00Z', by: 'me' },
      ],
      appliedAt: undefined,
    }),
  ]

  it('says yes from the application log', () => {
    expect(explainAnswer(question, profile, { company: 'Northwind Apps', applications })).toMatchObject({
      kind: 'answer',
      answer: 'Yes',
      reason: 'Your log shows 1 submitted application to Northwind Apps.',
    })
  })

  it('leaves "no" to a person, since the log may be incomplete', () => {
    expect(explainAnswer(question, profile, { company: 'Globex', applications })).toMatchObject({ kind: 'human' })
  })

  it('does not count a draft withdrawn before it was sent', () => {
    expect(explainAnswer(question, profile, { company: 'Initrode', applications })).toMatchObject({ kind: 'human' })
  })

  it('falls back to the saved answer without a log', () => {
    expect(explainAnswer(question, profile)).toMatchObject({ kind: 'human', answerId: 'previously-applied' })
  })
})
