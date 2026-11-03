import { describe, expect, it } from 'vitest'
import {
  enrollmentPhrases,
  extractFacts,
  extractLevel,
  extractSalary,
  extractYears,
  requiresAdvancedDegree,
  usOnlyPhrases,
} from './facts.ts'

const EN_DASH = String.fromCharCode(0x2013)

describe('extractYears', () => {
  it.each([
    ['2+ years of experience with React', 2, null],
    ['1-3 years of professional experience', 1, 3],
    [`1${EN_DASH}2 years of experience`, 1, 2],
    ['1 to 2 years of experience building web apps', 1, 2],
    ['between 2 and 4 years of experience', 2, 4],
    ['at least 3 years of experience', 3, null],
    ['minimum of 2 years experience', 2, null],
    ["3 years' experience in software development", 3, null],
    ['two or more years of experience', 2, null],
    ['up to 2 years of experience', 0, 2],
    ['0-2 years experience', 0, 2],
    ['5 or more years of hands-on experience', 5, null],
    ['3+ yrs experience', 3, null],
  ])('%s -> %s to %s', (text, min, max) => {
    expect(extractYears(text)).toEqual({ min, max })
  })

  it.each([
    'We have been building products for 10+ years.',
    'Our company was founded 12 years ago.',
    'Must be 18 years of age or older.',
    'We offer a 2 year warranty.',
    'No experience requirements listed.',
  ])('ignores years that are not about the candidate: %s', (text) => {
    expect(extractYears(text)).toEqual({ min: null, max: null })
  })

  it('takes the most demanding requirement', () => {
    expect(extractYears('1+ years of TypeScript experience. 3+ years of software development experience.')).toEqual({ min: 3, max: null })
  })

  it('prefers a stated range when two requirements start at the same number', () => {
    expect(extractYears('2+ years of experience. 2-3 years of experience with React.')).toEqual({ min: 2, max: 3 })
  })

  it('ignores preferred and nice-to-have mentions', () => {
    expect(extractYears('1-2 years of experience. 5+ years of experience is a plus.')).toEqual({ min: 1, max: 2 })
    const sectioned = 'Requirements\n- 1+ years of experience with React\nNice to have\n- 5+ years of experience with Go\nQualifications\n- 2+ years of experience with SQL'
    expect(extractYears(sectioned)).toEqual({ min: 2, max: null })
  })
})

describe('extractLevel', () => {
  it.each([
    ['', 'Junior Developer', 'junior'],
    ['Join as a new grad.', 'Software Engineer', 'new_grad'],
    ['This is an entry-level role.', 'Software Engineer', 'new_grad'],
    ['You will mentor junior engineers.', 'Software Engineer', 'unknown'],
    ['This is not an entry-level role.', 'Software Engineer', 'unknown'],
    ['Previous internship experience is welcome.', 'Software Engineer', 'unknown'],
    ['This internship runs for 16 weeks.', 'Software Engineer', 'intern'],
    ['We hire new grads.', 'Senior Software Engineer', 'senior'],
  ])('%s / %s -> %s', (jd, title, level) => {
    expect(extractLevel(jd, title)).toBe(level)
  })
})

describe('usOnlyPhrases', () => {
  it.each([
    ['Candidates must reside in the United States.', true],
    ['You must be authorized to work in the US.', true],
    ['You must be authorized to work in the US or Canada.', false],
    ['An active security clearance is required.', true],
    ['No security clearance is needed.', false],
    ['We hire across North America; must be located in the US or Canada.', false],
  ])('%s -> %s', (text, expected) => {
    expect(usOnlyPhrases(text).length > 0).toBe(expected)
  })
})

describe('enrollmentPhrases', () => {
  it.each([
    ['You must be currently enrolled in a degree program.', 'Software Engineer', true],
    ['You will be returning to school after the work term.', 'Software Engineer', true],
    ['Current students only.', 'Developer', true],
    ['Currently enrolled or recently graduated candidates welcome.', 'Developer', false],
    ['Open to new grads and current students.', 'Developer', false],
    ['Our co-op program hires every term.', 'Software Developer', false],
    ['This co-op term is 4 months.', 'Software Developer Co-op', true],
    ['Currently pursuing a degree in computer science.', 'Software Developer Intern', true],
    ['Bachelor degree or currently pursuing one.', 'Software Developer', false],
    ['Employees are enrolled in a benefits plan.', 'Developer', false],
  ])('%s (%s) -> %s', (text, title, expected) => {
    expect(enrollmentPhrases(text, title).length > 0).toBe(expected)
  })
})

describe('extractSalary', () => {
  it.each([
    ['Salary: $70,000 - $85,000 CAD per year.', '$70,000 - $85,000 CAD per year'],
    ['Pay range CA$80k to $95k.', 'CA$80k to $95k'],
    ['The rate is $28/hour.', '$28/hour'],
    ['Base pay 90,000 - 110,000 CAD', '90,000 - 110,000 CAD'],
    ['We raised $20M in funding. Salary $75,000.', '$75,000'],
    ['Get a $50 gift card on your first day.', null],
    ['No salary listed.', null],
  ])('%s -> %s', (text, expected) => {
    expect(extractSalary(text)).toBe(expected)
  })
})

describe('requiresAdvancedDegree', () => {
  it.each([
    ["A master's degree is required.", true],
    ['PhD required.', true],
    ["Bachelor's or master's degree required.", false],
    ['A PhD is a plus.', false],
    ["Master's degree or equivalent experience required.", false],
  ])('%s -> %s', (text, expected) => {
    expect(requiresAdvancedDegree(text)).toBe(expected)
  })
})

describe('extractFacts', () => {
  it('pulls every fact from one posting', () => {
    const jd = [
      'We are hiring a developer to join our team in Toronto (hybrid).',
      'Requirements: 1-2 years of experience with React and TypeScript, plus PostgreSQL.',
      'We keep a talent pool for future openings.',
      'Salary: $70,000 - $85,000 CAD per year.',
    ].join('\n')
    expect(extractFacts(jd, 'Junior Software Developer', 'Toronto, ON')).toEqual({
      level: 'junior',
      yearsMin: 1,
      yearsMax: 2,
      skills: ['React', 'TypeScript', 'PostgreSQL'],
      usOnly: false,
      requiresEnrollment: false,
      ghostPhrases: ['talent pool', 'future openings'],
      salaryText: '$70,000 - $85,000 CAD per year',
      advancedDegreeRequired: false,
    })
  })

  it('treats a co-op title as requiring enrollment', () => {
    expect(extractFacts('', 'Software Developer Co-op').requiresEnrollment).toBe(true)
  })

  it('reads "US only" in the location', () => {
    expect(extractFacts('', 'Developer', 'Remote (US only)').usOnly).toBe(true)
    expect(extractFacts('', 'Developer', 'Remote - US').usOnly).toBe(false)
  })

  it('does not treat a data pipeline as a ghost posting', () => {
    expect(extractFacts('Build our data pipeline and CI pipeline.', 'Developer').ghostPhrases).toEqual([])
  })
})
