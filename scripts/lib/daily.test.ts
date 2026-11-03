import { describe, expect, it } from 'vitest'
import { makeApplication, makeJob, samProfile, TZ } from '../../src/engine/fixtures.ts'
import { planToday } from '../../src/features/today/todayModel.ts'
import { applicationsCsv, csvField, CSV_COLUMNS } from './csv.ts'
import { md, renderDigest } from './digest.ts'
import { rescoreJobs } from './rescore.ts'

const NOW = new Date('2026-11-03T17:00:00Z')
const fresh = makeJob({ id: 'fresh', jdText: 'Junior role. React and TypeScript. 0-2 years of experience. New grad welcome.', workplace: 'remote', location: 'Remote, Canada' })
const senior = makeJob({ id: 'senior', title: 'Senior Software Engineer', url: 'https://jobs.example.com/northwind/9', jdText: '7+ years of experience.' })

describe('rescoreJobs', () => {
  it('scores every job and leaves statuses alone unless asked', () => {
    const result = rescoreJobs([fresh, senior], [], samProfile(), NOW, { setStatus: false })
    expect(result.jobs.every((job) => job.score !== undefined)).toBe(true)
    expect(result.jobs.map((job) => job.status)).toEqual(['queued', 'queued'])
    expect(result.statusChanges).toEqual([expect.objectContaining({ from: 'queued', to: 'skipped_dealbreaker' })])
    expect(result.moved.map((entry) => entry.before)).toEqual([null, null])
  })

  it('moves only rule-owned statuses, and never a job with an application', () => {
    const shortlisted = { ...senior, id: 'kept', title: 'Staff Engineer', url: 'https://jobs.example.com/northwind/10', status: 'shortlisted' as const }
    const appliedTo = { ...senior, id: 'applied', url: 'https://jobs.example.com/northwind/11', title: 'Senior Developer' }
    const result = rescoreJobs([fresh, senior, shortlisted, appliedTo], [{ jobId: 'applied' }], samProfile(), NOW, { setStatus: true })
    const status = Object.fromEntries(result.jobs.map((job) => [job.id, job.status]))
    expect(status).toEqual({ fresh: 'queued', senior: 'skipped_dealbreaker', kept: 'shortlisted', applied: 'queued' })
  })

  it('every rescored total equals the sum of its parts', () => {
    for (const job of rescoreJobs([fresh, senior], [], samProfile(), NOW, { setStatus: false }).jobs) {
      expect(job.score!.parts.reduce((sum, part) => sum + part.points, 0)).toBe(job.score!.total)
    }
  })
})

describe('renderDigest', () => {
  const followUp = makeApplication({
    id: 'due',
    company: 'Quill *and* Co',
    title: 'Frontend Developer',
    appliedAt: '2026-10-26T14:00:00.000Z',
    history: [{ status: 'applied', at: '2026-10-26T14:00:00.000Z', by: 'me' }],
  })

  it('shows follow-ups with a draft note, matches with their reasons, and escapes posting text', () => {
    const plan = planToday([followUp], [fresh], samProfile(), NOW, TZ)
    const text = renderDigest(plan, { dueReviews: 3, unseen: 2, streak: 1 }, samProfile(), { now: NOW, timeZone: TZ })
    expect(text).toMatch(/^# Today, Tue, Nov 3\n/)
    expect(text).toContain('## Follow-ups due')
    expect(text).toContain('[Frontend Developer at Quill \\*and\\* Co](<https://jobs.example.com/northwind/123>). Applied Mon, Oct 26,')
    expect(text).toContain('  > I applied for the Frontend Developer role at Quill \\*and\\* Co on October 26.')
    expect(text).toMatch(/## Worth applying to\n\n- \[Junior Software Developer at Northwind Apps\]\(<https:\/\/jobs\.example\.com\/northwind\/123>\)\. Score \d+, Tier 1\./)
    expect(text).toContain('3 cards due for review, 2 new cards. Streak: 1 day.')
    expect(text).toContain('Shortlist never submits anything')
  })

  it('says plainly when nothing passes and there is no profile', () => {
    const text = renderDigest(planToday([], [], null, NOW, TZ), null, null, { now: NOW, timeZone: TZ })
    expect(text).toContain('Nothing needs you right now.')
    expect(text).toContain('Add a profile to score jobs.')
    expect(text).not.toContain('## Practice')
  })

  it('never turns a non-web address into a link', () => {
    expect(md('C# [beta] <b>')).toBe('C\\# \\[beta\\] \\<b\\>')
    const odd = makeApplication({ id: 'odd', status: 'prepared', url: 'javascript:alert(1)', company: 'Odd', title: 'Dev' })
    const text = renderDigest(planToday([odd], [], samProfile(), NOW, TZ), null, samProfile(), { now: NOW, timeZone: TZ })
    expect(text).toContain('- Dev at Odd: Submit it yourself')
    expect(text).not.toContain('javascript:')
  })
})

describe('applicationsCsv', () => {
  it('quotes fields and defuses spreadsheet formulas', () => {
    expect(csvField('plain')).toBe('plain')
    expect(csvField('a, b')).toBe('"a, b"')
    expect(csvField('say "hi"\nnow')).toBe('"say ""hi""\nnow"')
    expect(csvField('=HYPERLINK("x")')).toBe(`"'=HYPERLINK(""x"")"`)
    expect(csvField('-1')).toBe("'-1")
    expect(csvField(-1)).toBe('-1')
    expect(csvField(null)).toBe('')
  })

  it('writes one row per application with the response and next step', () => {
    const replied = makeApplication({
      id: 'replied',
      status: 'interview_scheduled',
      history: [
        { status: 'applied', at: '2026-10-20T14:00:00.000Z', by: 'me' },
        { status: 'interview_scheduled', at: '2026-10-28T15:00:00.000Z', by: 'me' },
      ],
      appliedAt: '2026-10-20T14:00:00.000Z',
      notes: 'Phone screen, then onsite',
    })
    const waiting = makeApplication({ id: 'waiting', company: 'Bramble', appliedAt: '2026-10-30T14:00:00.000Z', history: [{ status: 'applied', at: '2026-10-30T14:00:00.000Z', by: 'me' }] })
    const lines = applicationsCsv([replied, waiting], [fresh], samProfile(), { now: NOW, timeZone: TZ }).split('\r\n')
    expect(lines[0]).toBe(CSV_COLUMNS.join(','))
    expect(lines).toHaveLength(4)
    const [first, second] = [lines[1].split(','), lines[2].split(',')]
    expect(first.slice(0, 2)).toEqual(['Bramble', 'Junior Software Developer'])
    expect(first[5]).toBe('2026-10-30')
    expect(first[6]).toBe('4')
    expect(first[13]).toBe('2026-11-06')
    expect(second[7]).toBe('Interview')
    expect(second.slice(10, 12)).toEqual(['2026-10-28', 'Interview'])
    expect(second[6]).toBe('')
    expect(lines[2]).toContain('Phone screen, then onsite')
  })
})
