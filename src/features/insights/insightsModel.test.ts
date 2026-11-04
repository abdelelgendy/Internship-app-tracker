import { describe, expect, it } from 'vitest'
import { makeApplication, makeJob, TZ } from '../../engine/fixtures.ts'
import type { AppStatus, Application, Job } from '../../engine/types.ts'
import { countTicks, funnelOf, headline, rateText, segmentOf, sizeBand, weeklyCounts, weekStart } from './insightsModel.ts'

const NOW = '2026-11-03T17:00:00.000Z'

/** A submitted application that reached `status`, with the history the state machine would leave. */
function sent(id: string, status: AppStatus, jobId = 'job-1', appliedAt = '2026-10-20T14:00:00.000Z'): Application {
  const path: AppStatus[] = status === 'applied' ? ['applied'] : ['applied', status]
  return makeApplication({ id, jobId, status, appliedAt, history: path.map((step) => ({ status: step, at: appliedAt, by: 'me' as const })) })
}

describe('funnelOf', () => {
  it('counts each step over sent applications and keeps drafts out', () => {
    const apps = [
      sent('a', 'applied'),
      sent('b', 'rejected'),
      { ...sent('c', 'offer'), history: [{ status: 'applied' as const, at: NOW, by: 'me' as const }, { status: 'interview_scheduled' as const, at: NOW, by: 'me' as const }, { status: 'offer' as const, at: NOW, by: 'me' as const }] },
      makeApplication({ id: 'd', status: 'draft', history: [{ status: 'draft', at: NOW, by: 'me' }], appliedAt: undefined }),
    ]
    const funnel = funnelOf(apps)
    expect(funnel.stages.map((stage) => [stage.id, stage.count])).toEqual([
      ['submitted', 3],
      ['reply', 2],
      ['interview', 1],
      ['offer', 1],
    ])
    expect(funnel.unsent).toBe(1)
    expect(funnel.awaitingReply).toBe(1)
    expect(funnel.byStatus).toEqual([
      { status: 'draft', count: 1 },
      { status: 'applied', count: 1 },
      { status: 'offer', count: 1 },
      { status: 'rejected', count: 1 },
    ])
    // Three sent is under the minimum, so no share is shown.
    expect(funnel.stages[1].rate.shown).toBe(false)
  })

  it('handles no applications at all', () => {
    const funnel = funnelOf([])
    expect(funnel.stages.every((stage) => stage.count === 0 && !stage.rate.shown)).toBe(true)
    expect(headline(funnel)).toBe('Nothing sent yet. Rates appear here once applications go out.')
  })

  it('states the reply rate with its range only from the minimum sample', () => {
    const few = funnelOf([sent('a', 'rejected'), sent('b', 'applied')])
    expect(headline(few)).toBe('2 applications sent. 1 got a reply from a person. A rate shows from 10 sent.')
    const many = funnelOf(Array.from({ length: 12 }, (_, index) => sent(`s${index}`, index < 5 ? 'rejected' : 'applied')))
    expect(headline(many)).toBe('12 applications sent. 5 got a reply from a person (42%, likely 19% to 68%).')
  })
})

describe('segmentOf', () => {
  const jobs: Job[] = [
    makeJob({ id: 'remote', workplace: 'remote', source: 'greenhouse', companySize: 40, jdText: 'New grad role. 0-2 years.' }),
    makeJob({ id: 'hybrid', title: 'Software Developer', workplace: 'hybrid', source: 'lever', companySize: 1200, jdText: '3-5 years of experience.' }),
  ]
  const apps = [
    ...Array.from({ length: 12 }, (_, index) => sent(`r${index}`, index < 9 ? 'rejected' : 'applied', 'remote')),
    ...Array.from({ length: 10 }, (_, index) => sent(`h${index}`, index < 1 ? 'rejected' : 'applied', 'hybrid')),
    ...Array.from({ length: 3 }, (_, index) => sent(`x${index}`, 'applied', 'not-saved')),
  ]

  it('shows rates per group, labels them plainly, and says which applications are left out', () => {
    const workplace = segmentOf('workplace', apps, jobs)
    expect(workplace.groups.map((group) => [group.label, group.rate.n, group.rate.successes])).toEqual([
      ['Remote', 12, 9],
      ['Hybrid', 10, 1],
    ])
    expect(workplace.missingNote).toBe('3 without a saved job are left out.')
    expect(workplace.comparison).toMatch(/^Remote and Hybrid: 65 points apart and the ranges do not overlap\.$/)
    expect(segmentOf('source', apps, jobs).groups.map((group) => group.label)).toEqual(['Greenhouse boards', 'Lever boards'])
    expect(segmentOf('tier', apps, jobs).groups.map((group) => group.label)).toEqual(['Entry level (tier 1)', 'A stretch (tier 3)'])
    expect(segmentOf('size', apps, jobs).groups.map((group) => group.label)).toEqual(['10 to 50 people', 'More than 500 people'])
  })

  it('hides rates below the minimum sample and makes no comparison', () => {
    const small = segmentOf('workplace', apps.slice(0, 4), jobs)
    expect(small.groups[0].rate).toMatchObject({ n: 4, shown: false, rate: null })
    expect(rateText(small.groups[0].rate)).toBeNull()
    expect(small.comparison).toBeNull()
  })

  it('bands company sizes', () => {
    expect([undefined, 0, 5, 10, 50, 51, 500, 501].map(sizeBand)).toEqual([
      null, null, 'Under 10 people', '10 to 50 people', '10 to 50 people', '51 to 200 people', '201 to 500 people', 'More than 500 people',
    ])
  })
})

describe('weeklyCounts', () => {
  it('counts sent applications per local Monday-to-Sunday week, oldest first', () => {
    const apps = [
      sent('mon', 'applied', 'job-1', '2026-11-02T14:00:00.000Z'),
      // Sunday evening in Toronto is already Monday in UTC: it belongs to the earlier week.
      sent('sun', 'applied', 'job-1', '2026-11-02T03:00:00.000Z'),
      sent('old', 'applied', 'job-1', '2026-06-01T14:00:00.000Z'),
      makeApplication({ id: 'draft', status: 'draft', appliedAt: undefined, history: [{ status: 'draft', at: NOW, by: 'me' }] }),
    ]
    const weeks = weeklyCounts(apps, NOW, TZ, 4)
    expect(weeks).toEqual([
      { start: '2026-10-12', count: 0, current: false },
      { start: '2026-10-19', count: 0, current: false },
      { start: '2026-10-26', count: 1, current: false },
      { start: '2026-11-02', count: 1, current: true },
    ])
  })

  it('finds the Monday of a week, including across a month', () => {
    expect(weekStart('2026-11-01T15:00:00.000Z', TZ)).toBe('2026-10-26')
    expect(weekStart('2026-11-02T15:00:00.000Z', TZ)).toBe('2026-11-02')
  })

  it('picks whole-number ticks that cover the largest week', () => {
    expect(countTicks(0)).toEqual([0, 1])
    expect(countTicks(3)).toEqual([0, 1, 2, 3])
    expect(countTicks(7)).toEqual([0, 2, 4, 6, 8])
    expect(countTicks(23)).toEqual([0, 5, 10, 15, 20, 25])
  })
})
