import { describe, expect, it } from 'vitest'
import { makeApplication, makeJob, samProfile, TZ } from '../../engine/fixtures.ts'
import type { PracticeDeck } from '../../engine/types.ts'
import { followUpNote, planToday, practiceSummary, summaryLine, TOP_MATCHES } from './todayModel.ts'

// Tuesday, November 3, 2026, 12:00 in Toronto.
const NOW = '2026-11-03T17:00:00.000Z'
const posting = 'New grads welcome. You will build React and TypeScript screens and Node.js services.'

describe('planToday', () => {
  const profile = samProfile()

  it('lists follow-ups that are due or late, latest first, and suggests "no reply" after 30 quiet days', () => {
    const apps = [
      makeApplication({
        id: 'due-today',
        company: 'B Co',
        appliedAt: '2026-10-27T15:00:00.000Z',
        history: [{ status: 'applied', at: '2026-10-27T15:00:00.000Z', by: 'me' }],
      }),
      makeApplication({
        id: 'late',
        company: 'A Co',
        appliedAt: '2026-10-20T15:00:00.000Z',
        history: [{ status: 'applied', at: '2026-10-20T15:00:00.000Z', by: 'me' }],
      }),
      makeApplication({
        id: 'sent',
        appliedAt: '2026-10-20T15:00:00.000Z',
        followUp: { dueAt: '2026-10-27T15:00:00.000Z', sentAt: '2026-10-27T18:00:00.000Z' },
        history: [{ status: 'applied', at: '2026-10-20T15:00:00.000Z', by: 'me' }],
      }),
      makeApplication({
        id: 'quiet',
        appliedAt: '2026-09-20T15:00:00.000Z',
        history: [{ status: 'applied', at: '2026-09-20T15:00:00.000Z', by: 'me' }],
      }),
      makeApplication({
        id: 'waiting',
        appliedAt: '2026-11-01T15:00:00.000Z',
        history: [{ status: 'applied', at: '2026-11-01T15:00:00.000Z', by: 'me' }],
      }),
    ]
    const plan = planToday(apps, [], profile, NOW, TZ)
    expect(plan.followUps.map((item) => [item.app.id, item.daysLate])).toEqual([
      ['late', 7],
      ['due-today', 0],
    ])
    expect(plan.quiet.map((item) => item.app.id)).toEqual(['quiet'])
    // The next one after today: "waiting" applied Sunday, so its follow-up lands on Monday the 9th.
    expect(plan.nextFollowUp?.slice(0, 10)).toBe('2026-11-09')
  })

  it('lists interviews from now through the next two weeks, soonest first', () => {
    const apps = [
      makeApplication({
        id: 'interviews',
        status: 'interview_scheduled',
        interviews: [
          { at: '2026-11-03T15:00:00.000Z', kind: 'Earlier today' },
          { at: '2026-11-03T20:00:00.000Z', kind: 'Later today' },
          { at: '2026-11-12T15:00:00.000Z', kind: 'Next week' },
          { at: '2026-11-25T15:00:00.000Z', kind: 'Too far' },
        ],
      }),
    ]
    expect(planToday(apps, [], profile, NOW, TZ).interviews.map((item) => item.interview.kind)).toEqual(['Later today', 'Next week'])
  })

  it('puts offers first among things waiting on you, then assessments, prepared and drafts', () => {
    const apps = (['draft', 'prepared', 'assessment_pending', 'offer', 'applied'] as const).map((status) =>
      makeApplication({
        id: status,
        status,
        appliedAt: status === 'draft' || status === 'prepared' ? undefined : '2026-11-02T14:00:00.000Z',
      }),
    )
    expect(planToday(apps, [], profile, NOW, TZ).waiting.map((item) => item.app.id)).toEqual([
      'offer',
      'assessment_pending',
      'prepared',
      'draft',
    ])
  })

  it('suggests queued jobs that pass the gate and have no application yet, in queue order', () => {
    const jobs = [
      makeJob({ id: 'fresh', jdText: posting, postedAt: '2026-11-03T15:00:00.000Z' }),
      makeJob({ id: 'older', jdText: posting, postedAt: '2026-11-03T08:00:00.000Z' }),
      makeJob({ id: 'stale', jdText: posting, postedAt: '2026-10-20T08:00:00.000Z' }),
      makeJob({ id: 'skipped', jdText: posting, postedAt: '2026-11-03T15:00:00.000Z', status: 'archived' }),
      makeJob({ id: 'applied', jdText: posting, postedAt: '2026-11-03T15:00:00.000Z' }),
    ]
    const plan = planToday([makeApplication({ jobId: 'applied' })], jobs, profile, NOW, TZ)
    expect(plan.matches.map((item) => item.job.id)).toEqual(['fresh', 'older'])
    expect(plan.matches.every((item) => item.score.gate.verdict === 'apply')).toBe(true)
  })

  it('caps the suggestions but counts them all', () => {
    const jobs = Array.from({ length: TOP_MATCHES + 2 }, (_, index) =>
      makeJob({ id: `job-${index}`, url: `https://jobs.example.com/${index}`, jdText: posting, postedAt: '2026-11-03T15:00:00.000Z' }),
    )
    const plan = planToday([], jobs, profile, NOW, TZ)
    expect(plan.matches).toHaveLength(TOP_MATCHES)
    expect(plan.matchCount).toBe(TOP_MATCHES + 2)
  })

  it('counts applications submitted today against the weekday target', () => {
    const apps = [makeApplication({ appliedAt: '2026-11-03T14:00:00.000Z' }), makeApplication({ appliedAt: '2026-11-02T14:00:00.000Z' })]
    const plan = planToday(apps, [], profile, NOW, TZ)
    expect(plan.submittedToday).toBe(1)
    expect(plan.dailyTarget).toBe(10)
    expect(planToday([], [], profile, '2026-11-07T17:00:00.000Z', TZ).dailyTarget).toBe(0)
  })

  it('works without a profile: applications still get their next steps, nothing is suggested', () => {
    const plan = planToday([makeApplication({ status: 'prepared' })], [makeJob({ jdText: posting })], null, NOW, TZ)
    expect(plan.waiting).toHaveLength(1)
    expect(plan.matches).toEqual([])
  })
})

describe('summaryLine', () => {
  it('says what is there, in a sentence', () => {
    const plan = planToday([makeApplication({ status: 'prepared' })], [], samProfile(), NOW, TZ)
    expect(summaryLine(plan)).toBe('1 application waiting on you.')
    expect(summaryLine(planToday([], [], samProfile(), NOW, TZ))).toBe('Nothing needs you right now.')
  })
})

describe('practiceSummary', () => {
  it('adds up due reviews and new cards across decks, with the live streak', () => {
    const card = (id: string) => ({
      id,
      kind: 'concept' as const,
      prompt: 'Q',
      answer: 'A',
      keyPoints: [],
      difficulty: 1 as const,
      tags: [],
    })
    const decks: PracticeDeck[] = [
      { id: 'one', title: 'One', description: '', cards: [card('a'), card('b')] },
      { id: 'two', title: 'Two', description: '', cards: [card('c')] },
    ]
    const progress = {
      cards: {
        a: { box: 1 as const, dueAt: '2026-11-03T00:00:00.000Z', reviews: 1 },
        b: { box: 3 as const, dueAt: '2026-11-10T00:00:00.000Z', reviews: 2 },
      },
      exercises: {},
      streak: { current: 4, best: 6, lastDay: '2026-11-02' },
    }
    expect(practiceSummary(decks, progress, NOW, TZ)).toEqual({ dueReviews: 1, unseen: 1, streak: 4 })
  })
})

describe('followUpNote', () => {
  it('greets the contact by first name and names the role and date', () => {
    const app = makeApplication({
      title: 'Frontend Developer',
      company: 'Cobalt Orchard',
      appliedAt: '2026-10-30T17:00:00.000Z',
      contacts: [{ name: 'Priya Natarajan' }],
    })
    const note = followUpNote(app, TZ, 'Sam Rivera')
    expect(note).toMatch(/^Hi Priya,\n/)
    expect(note).toContain('I applied for the Frontend Developer role at Cobalt Orchard on October 30.')
    expect(note).toMatch(/Thanks,\nSam Rivera$/)
    expect(note).not.toMatch(/[\u2013\u2014;]/u)
  })
})
