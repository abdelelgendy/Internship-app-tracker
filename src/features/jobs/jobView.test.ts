import { describe, expect, it } from 'vitest'
import { makeJob, samProfile } from '../../engine/fixtures.ts'
import { scoreJob } from '../../engine/score.ts'
import { formatAge, formatAgeShort, relativeDay, sourceLabel } from './format.ts'
import {
  companyFromUrl,
  duplicateOf,
  ghostFor,
  manualJob,
  markSkills,
  parsePostingUrl,
  postedFromText,
  scoreFor,
  skillMentions,
  titleFromText,
} from './jobView.ts'

const NOW = '2026-11-03T17:00:00.000Z'

describe('scoreFor', () => {
  it('scores with the current clock, so a stored gate never goes stale', () => {
    const profile = samProfile()
    const job = makeJob({ jdText: 'New grads welcome. React and TypeScript.', postedAt: '2026-11-03T12:00:00.000Z' })
    const stored = { ...job, score: scoreJob(job, profile, '2026-11-03T13:00:00.000Z') }
    expect(stored.score.gate.verdict).toBe('apply')
    expect(scoreFor(stored, profile, '2026-11-08T13:00:00.000Z')?.gate.verdict).toBe('hold')
    expect(scoreFor(stored, profile, '2026-12-08T13:00:00.000Z')?.gate.verdict).toBe('skip')
  })

  it('refreshes only the gate when there is no profile, and nothing without a stored score', () => {
    const job = makeJob({ jdText: 'New grads welcome. React and TypeScript.', postedAt: '2026-11-03T12:00:00.000Z' })
    const stored = { ...job, score: scoreJob(job, samProfile(), '2026-11-03T13:00:00.000Z') }
    expect(scoreFor(stored, null, '2026-11-09T13:00:00.000Z')?.gate.reason).toMatch(/confirm the posting is still open/)
    expect(scoreFor(stored, null, '2026-12-09T13:00:00.000Z')?.gate.reason).toMatch(/past your 30-day limit/)
    expect(scoreFor({ ...stored, verified: true }, null, '2026-12-09T13:00:00.000Z')?.gate.verdict).toBe('hold')
    expect(scoreFor(job, null, NOW)).toBeNull()
  })
})

describe('duplicateOf', () => {
  const first = makeJob({ id: 'a', url: 'https://boards.greenhouse.io/acme/jobs/1?gh_src=x', discoveredAt: '2026-11-01T00:00:00.000Z' })
  const sameUrl = makeJob({
    id: 'b',
    title: 'Other title',
    url: 'https://www.boards.greenhouse.io/acme/jobs/1',
    discoveredAt: '2026-11-02T00:00:00.000Z',
  })
  const sameTitle = makeJob({ id: 'c', url: 'https://jobs.lever.co/acme/2', discoveredAt: '2026-11-03T00:00:00.000Z' })
  const intern = makeJob({
    id: 'd',
    title: 'Junior Software Developer Intern',
    url: 'https://jobs.lever.co/acme/3',
    discoveredAt: '2026-11-03T00:00:00.000Z',
  })
  const jobs = [sameTitle, intern, sameUrl, first]

  it('names the earlier posting, by URL first, then company and title', () => {
    expect(duplicateOf(first, jobs)).toBeNull()
    expect(duplicateOf(sameUrl, jobs)).toEqual({ reason: 'url', original: first })
    expect(duplicateOf(sameTitle, jobs)).toEqual({ reason: 'company_title', original: first })
    expect(duplicateOf(intern, jobs)).toBeNull()
  })

  it('follows a duplicate status set by a person or the scanner, even when the repeat was found first', () => {
    const marked = { ...first, status: 'skipped_duplicate' as const }
    const all = [marked, sameUrl, sameTitle]
    expect(duplicateOf(marked, all)).toEqual({ reason: 'url', original: sameUrl })
    expect(duplicateOf(sameUrl, all)).toBeNull()
  })
})

describe('ghostFor', () => {
  it('reads ghost wording from the description even when no facts are stored', () => {
    const job = makeJob({ jdText: 'Join our talent pool and we will reach out when a role opens.' })
    expect(ghostFor(job, [])).toMatch(/talent pool/)
  })
})

describe('adding a job by hand', () => {
  it('reads the company from a board URL', () => {
    expect(companyFromUrl(parsePostingUrl('https://boards.greenhouse.io/maple-ledger/jobs/1')!)).toBe('Maple Ledger')
    expect(companyFromUrl(parsePostingUrl('https://jobs.ashbyhq.com/harbourlight/abc')!)).toBe('Harbourlight')
    expect(companyFromUrl(parsePostingUrl('https://acme.wd3.myworkdayjobs.com/careers/job/1')!)).toBe('Acme')
    expect(companyFromUrl(parsePostingUrl('https://careers.example.com/jobs/1')!)).toBeNull()
    expect(parsePostingUrl('javascript:alert(1)')).toBeNull()
  })

  it('takes a title from the first line only when it reads like one', () => {
    expect(titleFromText('Junior Frontend Developer\nAbout us...')).toBe('Junior Frontend Developer')
    expect(titleFromText('We build bookkeeping software for small businesses.\nJunior Developer')).toBeNull()
  })

  it.each([
    ['Posted 3 days ago', '2026-10-31T17:00:00.000Z'],
    ['posted 5 hours ago', '2026-11-03T12:00:00.000Z'],
    ['Posted 30+ days ago', '2026-10-04T17:00:00.000Z'],
    ['Posted today', '2026-11-03T16:00:00.000Z'],
    ['Posted yesterday', '2026-11-02T17:00:00.000Z'],
    ['Apply by Friday', null],
  ])('reads "%s"', (text, expected) => {
    expect(postedFromText(text, NOW)).toBe(expected)
  })

  it('builds a job with facts read from the text and the workplace from the location', () => {
    const job = manualJob(
      {
        id: 'manual-1',
        url: ' https://jobs.lever.co/acme/1 ',
        title: 'Junior Developer',
        company: 'Acme',
        location: 'Toronto, ON (Hybrid)',
        postedAt: null,
        jdText: 'We hire new grads with 0-2 years of experience in React.',
      },
      NOW,
    )
    expect(job).toMatchObject({
      source: 'manual',
      ats: 'lever',
      workplace: 'hybrid',
      postedAtSource: 'unknown',
      verified: true,
      status: 'queued',
      discoveredAt: NOW,
    })
    expect(job.facts).toMatchObject({ yearsMin: 0, yearsMax: 2, skills: ['React'] })
  })
})

describe('markSkills', () => {
  const profile = samProfile()
  const text = 'Use React and Node.js daily. You will react quickly. Docker is a plus.'
  const segments = markSkills(text, skillMentions({ skills: ['React', 'Node.js', 'Docker'] }, profile))

  it('marks strong and working skills by name, case-sensitively for capitalized names', () => {
    expect(segments.filter((segment) => segment.skill).map((segment) => segment.text)).toEqual(['React', 'Node.js'])
  })

  it('keeps every character of the text', () => {
    expect(segments.map((segment) => segment.text).join('')).toBe(text)
  })

  it('returns the text whole when nothing is marked', () => {
    expect(markSkills('Plain text', [])).toEqual([{ text: 'Plain text' }])
  })
})

describe('format', () => {
  it('writes ages long and short', () => {
    expect(formatAge('2026-11-03T14:00:00.000Z', NOW)).toBe('3 hours ago')
    expect(formatAge('2026-10-30T17:00:00.000Z', NOW)).toBe('4 days ago')
    expect(formatAge(null, NOW)).toBe('Date unknown')
    expect(formatAgeShort('2026-11-03T14:00:00.000Z', NOW)).toBe('3h')
    expect(formatAgeShort('2026-10-06T17:00:00.000Z', NOW)).toBe('4w')
  })

  it('counts days on the local calendar', () => {
    expect(relativeDay('2026-11-05T15:00:00.000Z', NOW, 'America/Toronto')).toBe('in 2 days')
    expect(relativeDay('2026-11-04T03:00:00.000Z', NOW, 'America/Toronto')).toBe('today')
  })

  it('names sources', () => {
    expect(sourceLabel('web-search')).toBe('Web search')
    expect(sourceLabel('some_board')).toBe('Some board')
  })
})
