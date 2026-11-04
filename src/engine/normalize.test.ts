import { describe, expect, it } from 'vitest'
import {
  detectWorkplace,
  hasPhrase,
  isUsOnlyRemoteLocation,
  looksLikeSoftwareTitle,
  normalizeCompany,
  normalizeLocation,
  normalizeText,
  normalizeTitle,
  textMatcher,
  titleLevel,
} from './normalize.ts'

const EN_DASH = String.fromCharCode(0x2013)
const CURLY = String.fromCharCode(0x2019)

describe('normalizeText', () => {
  it('turns dashes and curly quotes into plain ones and collapses spaces', () => {
    expect(normalizeText(`  1${EN_DASH}3 years\u00a0of  Sam${CURLY}s work `)).toBe("1-3 years of Sam's work")
  })
})

describe('whole-word matching', () => {
  it.each([
    ['Internal Tools Engineer', 'intern', false],
    ['Software Engineer Intern', 'intern', true],
    ['years of digital marketing', 'git', false],
    ['experience with Git', 'git', true],
    ['15+ years', '5+ years', false],
    ['5+ years of experience', '5+ years', true],
    ['C++ and C#', 'c', false],
    ['Sr. Developer', 'sr.', true],
    ['Requires 1-3 years', `1${EN_DASH}3 years`, true],
    ['remote first', 'remote   first', true],
  ])('"%s" contains "%s": %s', (text, phrase, expected) => {
    expect(hasPhrase(text, phrase)).toBe(expected)
  })

  it('matches case-sensitively only when asked', () => {
    const words = textMatcher('the rest of the team')
    expect(words.has('REST', true)).toBe(false)
    expect(words.has('REST')).toBe(true)
  })

  it('finds the first index and lists matches in list order', () => {
    const words = textMatcher('React then TypeScript')
    expect(words.indexOf('typescript')).toBe(11)
    expect(words.indexOf('vue')).toBe(-1)
    expect(words.which(['typescript', 'vue', 'react'])).toEqual(['typescript', 'react'])
  })

  it('never matches an empty phrase', () => {
    expect(hasPhrase('anything', '  ')).toBe(false)
  })
})

describe('normalizeTitle', () => {
  it.each([
    ['Sr. Front-End Engineer (Remote)', 'senior frontend engineer'],
    ['Jr Software Developer', 'junior software developer'],
    ['Software Engineer, New Graduate', 'software engineer new grad'],
    ['Entry-Level Full-Stack Developer', 'entry level full stack developer'],
    ['Software Engineering Internship', 'software engineering intern'],
    ['Co-op Software Developer', 'co-op software developer'],
    ['Coop Developer', 'co-op developer'],
    ['Software Developer 1', 'software developer i'],
    ['Software Engineer 2', 'software engineer ii'],
    ['Node.js / C++ Developer', 'node.js c++ developer'],
    ['SWE, Platform', 'software engineer platform'],
  ])('%s -> %s', (title, expected) => {
    expect(normalizeTitle(title)).toBe(expected)
  })

  it('keeps the level, so an internship and a full-time role differ', () => {
    expect(normalizeTitle('Software Engineer Intern')).not.toBe(normalizeTitle('Software Engineer'))
  })
})

describe('titleLevel', () => {
  it.each([
    ['Software Engineer Intern', 'intern'],
    ['Co-op Developer', 'intern'],
    ['Senior Software Engineer', 'senior'],
    ['Staff Engineer', 'senior'],
    ['Software Engineer III', 'senior'],
    ['Software Engineer II', 'mid'],
    ['Intermediate Developer', 'mid'],
    ['New Grad Software Engineer', 'new_grad'],
    ['Graduate Software Developer', 'new_grad'],
    ['Junior Developer', 'junior'],
    ['Associate Software Engineer', 'junior'],
    ['Software Engineer I', 'junior'],
    ['Software Engineer', 'unknown'],
    ['Internal Tools Engineer', 'unknown'],
  ])('%s -> %s', (title, level) => {
    expect(titleLevel(title)).toBe(level)
  })
})

describe('looksLikeSoftwareTitle', () => {
  it.each([
    ['Software Developer', true],
    ['Product Engineer', true],
    ['Full-Stack Developer', true],
    ['Web Developer', true],
    ['Mechanical Engineer', false],
    ['Sales Engineer', false],
    ['Marketing Coordinator', false],
  ])('%s: %s', (title, expected) => {
    expect(looksLikeSoftwareTitle(title)).toBe(expected)
  })
})

describe('normalizeCompany', () => {
  it.each([
    ['Shopify Inc.', 'shopify'],
    ['The Widget Company', 'widget'],
    ['Acme Co., Ltd.', 'acme'],
    ['Limited Brands', 'limited brands'],
    ['1Password', '1password'],
    ['Johnson & Johnson', 'johnson and johnson'],
  ])('%s -> %s', (company, expected) => {
    expect(normalizeCompany(company)).toBe(expected)
  })
})

describe('detectWorkplace', () => {
  it.each([
    ['Remote - Canada', '', '', 'remote'],
    ['Toronto (Hybrid, remote-friendly)', '', '', 'hybrid'],
    ['On-site, Waterloo', '', '', 'onsite'],
    ['Toronto, ON', 'Developer (Remote)', '', 'remote'],
    ['Toronto, ON', 'Developer', 'You will work with remote teammates.', 'unknown'],
    ['Toronto, ON', 'Developer', 'This role is remote within Canada.', 'remote'],
    ['Toronto, ON', 'Developer', 'We work in-office four days a week.', 'onsite'],
  ])('%s / %s / %s -> %s', (location, title, jd, expected) => {
    expect(detectWorkplace(location, title, jd)).toBe(expected)
  })
})

describe('locations', () => {
  it.each([
    ['Remote - US', true],
    ['Remote (USA)', true],
    ['Remote - U.S.', true],
    ['Remote, U.S.', true],
    ['Remote (U.S.A.)', true],
    ['Remote, US-based', true],
    ['Remote - work with us', false],
    ['Remote, United States or Canada', false],
    ['Remote - North America', false],
    ['Austin, TX, US', false],
  ])('%s is US-only remote: %s', (location, expected) => {
    expect(isUsOnlyRemoteLocation(location)).toBe(expected)
  })

  it('spells out province codes', () => {
    expect(normalizeLocation('London, ON, Canada')).toBe('london, ontario, canada')
  })
})
