import { describe, expect, it } from 'vitest'
import { lintCoverLetter, type LintIssue } from './coverLint.ts'
import { samProfile } from './fixtures.ts'

const profile = samProfile()
const EM_DASH = String.fromCharCode(0x2014)
const EN_DASH = String.fromCharCode(0x2013)

const GOOD = `Northwind Apps builds scheduling tools for clinics, and the way your team ships small weekly releases caught my eye.

I built Trailmix, a hiking trip planner in React and TypeScript with Supabase. It is used by 40 people in a hiking club, and it taught me to test on real phones before every release.

At Pinecrest Studio I built 4 accessible landing pages in React for local clients. That work is close to the frontend role you posted.

I would like to talk about how I could help Northwind Apps. Thanks for reading.

Sam`

const lint = (text: string, company = 'Northwind Apps') => lintCoverLetter(text, profile, { company })
const rules = (issues: LintIssue[]) => issues.map((issue) => issue.rule)

describe('lintCoverLetter', () => {
  it('passes a letter that follows every rule', () => {
    const result = lint(GOOD)
    expect(result.issues).toEqual([])
    expect(result.ok).toBe(true)
    expect(result.paragraphs).toBe(4)
  })

  it.each<[string, LintIssue['rule']]>([
    [`${GOOD.replace('caught my eye.', `caught my eye ${EM_DASH} a lot.`)}`, 'dash'],
    [`${GOOD.replace('caught my eye.', `caught my eye in 2 ${EN_DASH} 3 ways.`)}`, 'dash'],
    [GOOD.replace('Thanks for reading.', 'Thanks for reading; talk soon.'), 'semicolon'],
    [`Dear Hiring Manager,\n\n${GOOD}`, 'greeting'],
    [GOOD.replace('That work is close', 'As a new grad, that work is close'), 'sentence_start'],
    [GOOD.replace('That work is close', 'With my background, that work is close'), 'sentence_start'],
    [GOOD.replace('Thanks for reading.', 'I like your product. I use it daily. I want to help.'), 'i_streak'],
    [GOOD.replaceAll('Northwind Apps', 'your company'), 'company_missing'],
    [`${GOOD}\n\n${'word '.repeat(80)}`, 'too_long'],
  ])('flags %#: %s', (text, rule) => {
    const result = lint(text)
    expect(rules(result.issues)).toContain(rule)
    expect(result.ok).toBe(false)
  })

  it('reports the longer banned phrase once', () => {
    const result = lint(GOOD.replace('caught my eye', 'shows you are passionate about clinics'))
    const banned = result.issues.filter((issue) => issue.rule === 'banned_phrase').map((issue) => issue.excerpt)
    expect(banned).toEqual(['passionate about'])
  })

  it('uses the banned phrases from the profile too', () => {
    expect(rules(lint(GOOD.replace('Thanks for reading.', 'I am a rockstar.')).issues)).toContain('banned_phrase')
  })

  it('warns about the paragraph count without failing', () => {
    const oneBlock = GOOD.replace(/\n\n(?!Sam$)/g, ' ')
    const result = lint(oneBlock)
    expect(rules(result.issues)).toEqual(['paragraphs'])
    expect(result.ok).toBe(true)
  })
})

describe('claims check', () => {
  it('flags a number the profile does not back', () => {
    const result = lint(GOOD.replace('taught me to test', 'cut load times by 35% and taught me to test'))
    expect(result.issues).toContainEqual(expect.objectContaining({ rule: 'unverified_number', excerpt: '35%' }))
  })

  it('allows numbers from facts, experience and the company name', () => {
    const result = lintCoverLetter(GOOD.replaceAll('Northwind Apps', '1Password'), profile, { company: '1Password' })
    expect(rules(result.issues)).not.toContain('unverified_number')
  })

  it('ignores experience and projects marked unverified', () => {
    const unverified = samProfile()
    unverified.experience = unverified.experience.map((job) => ({ ...job, verified: false }))
    unverified.projects = unverified.projects.map((project) => ({ ...project, verified: false }))
    const result = lintCoverLetter(GOOD, unverified, { company: 'Northwind Apps' })
    expect(result.issues).toContainEqual(expect.objectContaining({ rule: 'unverified_name', excerpt: 'Pinecrest Studio' }))
    expect(result.issues).toContainEqual(expect.objectContaining({ rule: 'unverified_number', excerpt: '4' }))
  })

  it('flags an employer or project that is not on the profile', () => {
    const result = lint(GOOD.replace('At Pinecrest Studio I built', 'At Initech I built'))
    expect(result.issues).toContainEqual(expect.objectContaining({ rule: 'unverified_name', excerpt: 'Initech', severity: 'error' }))
    const project = lint(GOOD.replace('I built Trailmix', 'I built Skyline'))
    expect(project.issues).toContainEqual(expect.objectContaining({ rule: 'unverified_name', excerpt: 'Skyline' }))
  })

  it('accepts known employers, projects, skills, the school and the target company', () => {
    const text = GOOD.replace('That work is close', 'I studied at Harbourview and built React tools. That work is close')
    expect(rules(lint(text).issues)).not.toContain('unverified_name')
  })

  it('only warns after the weaker cue "for"', () => {
    const result = lint(GOOD.replace('for local clients', 'for Canadian merchants'))
    expect(result.issues).toContainEqual(expect.objectContaining({ rule: 'unverified_name', excerpt: 'Canadian', severity: 'warning' }))
    expect(result.ok).toBe(true)
  })

  it("warns when a sentence gives a project a tool its stack doesn't list", () => {
    const result = lint(GOOD.replace('in React and TypeScript with Supabase', 'in React with Express'))
    expect(result.issues).toContainEqual(expect.objectContaining({ rule: 'stack_claim', severity: 'warning' }))
    expect(result.issues.find((issue) => issue.rule === 'stack_claim')?.message).toMatch(/Trailmix's stack .* Express/)
  })

  it('does not guess which project a tool belongs to when a sentence names two', () => {
    const text = GOOD.replace('That work is close', 'Quizbox and Trailmix use Flask and React. That work is close')
    expect(rules(lint(text).issues)).not.toContain('stack_claim')
  })
})
