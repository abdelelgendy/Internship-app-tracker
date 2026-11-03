import { describe, expect, it } from 'vitest'
import { companyTitleKey, findDuplicate, ghostReason, repostCount, urlKey } from './dedup.ts'
import { makeJob } from './fixtures.ts'

describe('urlKey', () => {
  it.each([
    ['http://www.Example.com/jobs/123/', 'https://example.com/jobs/123'],
    ['https://example.com/jobs/123?utm_source=x&utm_medium=y#apply', 'https://example.com/jobs/123'],
    ['https://example.com/careers?gh_jid=42&gh_src=abc', 'https://example.com/careers?gh_jid=42'],
    ['https://jobs.example.com/acme/Abc-123?lever-source=linkedin', 'https://jobs.example.com/acme/Abc-123'],
    ['https://example.com/jobs?b=2&a=1', 'https://example.com/jobs?a=1&b=2'],
    ['https://example.com:8443/jobs', 'https://example.com:8443/jobs'],
    ['  Not a URL  ', 'not a url'],
    ['mailto:jobs@example.com', 'mailto:jobs@example.com'],
  ])('%s -> %s', (url, expected) => {
    expect(urlKey(url)).toBe(expected)
  })
})

describe('companyTitleKey', () => {
  it('keeps intern and full-time postings apart', () => {
    expect(companyTitleKey('Acme', 'Software Engineer Intern')).not.toBe(companyTitleKey('Acme', 'Software Engineer'))
  })

  it('merges spelling variants of one posting', () => {
    expect(companyTitleKey('Acme Inc.', 'Jr. Front-End Developer')).toBe(companyTitleKey('acme', 'Junior Frontend Developer'))
  })
})

describe('findDuplicate', () => {
  const seen = [
    makeJob({ url: 'https://example.com/jobs/1', company: 'Acme', title: 'Software Developer' }),
    makeJob({ url: 'https://example.com/jobs/2', company: 'Globex', title: 'Junior Developer' }),
  ]

  it('prefers a URL match', () => {
    const found = findDuplicate(makeJob({ url: 'http://www.example.com/jobs/1/?utm_source=x', company: 'Other', title: 'Other' }), seen)
    expect(found?.reason).toBe('url')
  })

  it('falls back to company and title', () => {
    const found = findDuplicate(makeJob({ url: 'https://elsewhere.com/9', company: 'Globex Corp', title: 'Jr Developer' }), seen)
    expect(found).toEqual({ reason: 'company_title', match: seen[1] })
  })

  it('returns null for a new posting, including an internship at the same company', () => {
    expect(findDuplicate(makeJob({ url: 'https://elsewhere.com/9', company: 'Acme', title: 'Software Developer Intern' }), seen)).toBeNull()
  })
})

describe('repostCount and ghostReason', () => {
  const job = makeJob({ company: 'Acme', title: 'Software Developer', postedAt: '2026-11-03T10:00:00Z' })
  const history = [
    makeJob({ company: 'Acme', title: 'Software Developer', postedAt: '2026-10-01T10:00:00Z' }),
    makeJob({ company: 'Acme Inc.', title: 'Software Developer', postedAt: '2026-10-01T18:00:00Z' }),
    makeJob({ company: 'Acme', title: 'Software Developer', postedAt: '2026-09-01T10:00:00Z' }),
    makeJob({ company: 'Acme', title: 'Software Developer', postedAt: null }),
    makeJob({ company: 'Acme', title: 'Software Developer Intern', postedAt: '2026-08-01T10:00:00Z' }),
  ]

  it('counts distinct posting days for the same company and title', () => {
    expect(repostCount(job, [])).toBe(1)
    expect(repostCount(job, history.slice(0, 2))).toBe(2)
    expect(repostCount(job, history)).toBe(3)
  })

  it('flags three postings as a likely ghost job', () => {
    expect(ghostReason(job, history.slice(0, 2))).toBeNull()
    expect(ghostReason(job, history)).toMatch(/Posted on 3 different days/)
  })

  it('flags ghost wording', () => {
    expect(ghostReason({ ...job, facts: { ghostPhrases: ['talent pool'] } }, [])).toMatch(/"talent pool"/)
  })
})
