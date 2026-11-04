import { describe, expect, it } from 'vitest'
import { makeApplication } from './fixtures.ts'
import {
  APP_STATUSES,
  canQueueTransition,
  canTransition,
  isTerminal,
  normalizeStatus,
  QUEUE_STATUSES,
  transition,
  wasSubmitted,
} from './states.ts'

describe('normalizeStatus', () => {
  it.each([
    ['submitted', 'applied'],
    ['Submitted', 'applied'],
    ['submitted_unconfirmed', 'applied'],
    ['prepared_not_submitted', 'prepared'],
    ['tailored', 'prepared'],
    ['interview', 'interview_scheduled'],
    ['likely_ghosted', 'ghosted'],
    ['interview scheduled', 'interview_scheduled'],
    ['assessment-pending', 'assessment_pending'],
    ['offer', 'offer'],
    ['unknown', null],
    ['', null],
  ])('application %s -> %s', (value, expected) => {
    expect(normalizeStatus(value, 'application')).toBe(expected)
  })

  it.each([
    ['dup', 'skipped_duplicate'],
    ['duplicate', 'skipped_duplicate'],
    ['ghost_skipped', 'skipped_ghost'],
    ['tailored', 'shortlisted'],
    ['skipped_age', 'skipped_age'],
    ['error', null],
    ['applied', null],
  ])('queue %s -> %s', (value, expected) => {
    expect(normalizeStatus(value, 'queue')).toBe(expected)
  })

  it('maps every canonical status to itself', () => {
    for (const status of APP_STATUSES) expect(normalizeStatus(status, 'application')).toBe(status)
    for (const status of QUEUE_STATUSES) expect(normalizeStatus(status, 'queue')).toBe(status)
  })
})

describe('canTransition', () => {
  it.each([
    ['draft', 'prepared', true],
    ['prepared', 'applied', true],
    ['prepared', 'draft', true],
    ['draft', 'interview_scheduled', false],
    ['applied', 'interview_scheduled', true],
    ['applied', 'offer', true],
    ['applied', 'prepared', false],
    ['reviewing', 'confirmed', false],
    ['interview_scheduled', 'assessment_pending', true],
    ['assessment_pending', 'reviewing', true],
    ['ghosted', 'interview_scheduled', true],
    ['offer', 'withdrawn', true],
    ['offer', 'rejected', true],
    ['offer', 'applied', false],
    ['rejected', 'applied', false],
    ['withdrawn', 'applied', false],
    ['applied', 'applied', false],
  ] as const)('%s -> %s: %s', (from, to, expected) => {
    expect(canTransition(from, to)).toBe(expected)
  })

  it('treats only rejected and withdrawn as final', () => {
    expect(APP_STATUSES.filter(isTerminal)).toEqual(['rejected', 'withdrawn'])
  })

  it.each([
    ['queued', 'shortlisted', true],
    ['skipped_age', 'queued', true],
    ['skipped_dealbreaker', 'shortlisted', true],
    ['archived', 'queued', true],
    ['archived', 'shortlisted', false],
    ['expired', 'shortlisted', false],
    ['queued', 'queued', false],
  ] as const)('queue %s -> %s: %s', (from, to, expected) => {
    expect(canQueueTransition(from, to)).toBe(expected)
  })
})

describe('transition', () => {
  it('appends history and records the first applied date', () => {
    const draft = makeApplication({ status: 'prepared', history: [], appliedAt: undefined })
    const result = transition(draft, 'applied', '2026-11-03T15:00:00.000Z')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.app.status).toBe('applied')
    expect(result.app.appliedAt).toBe('2026-11-03T15:00:00.000Z')
    expect(result.app.history).toEqual([{ status: 'applied', at: '2026-11-03T15:00:00.000Z', by: 'me' }])
    expect(draft.history).toEqual([])
  })

  it('keeps an existing applied date and records who made the change', () => {
    const app = makeApplication()
    const result = transition(app, 'rejected', '2026-11-10T15:00:00.000Z', 'inbox-rule')
    expect(result.ok && result.app.appliedAt).toBe(app.appliedAt)
    expect(result.ok && result.app.history.at(-1)).toEqual({ status: 'rejected', at: '2026-11-10T15:00:00.000Z', by: 'inbox-rule' })
  })

  it('refuses a move that is not allowed', () => {
    expect(transition(makeApplication({ status: 'rejected' }), 'offer', '2026-11-10T15:00:00.000Z')).toEqual({
      ok: false,
      reason: "Can't move from rejected to offer.",
    })
  })
})

describe('wasSubmitted', () => {
  it.each([
    [makeApplication({ status: 'draft', history: [], appliedAt: undefined }), false],
    [makeApplication({ status: 'prepared', history: [], appliedAt: undefined }), false],
    [makeApplication({ status: 'applied' }), true],
    [makeApplication({ status: 'withdrawn', history: [], appliedAt: '2026-10-01T12:00:00Z' }), true],
    [makeApplication({ status: 'rejected', history: [], appliedAt: undefined }), true],
  ])('%#', (app, expected) => {
    expect(wasSubmitted(app)).toBe(expected)
  })

  it('does not count a draft withdrawn before it was sent', () => {
    const draft = makeApplication({ status: 'draft', history: [{ status: 'draft', at: '2026-10-01T12:00:00Z', by: 'me' }], appliedAt: undefined })
    const result = transition(draft, 'withdrawn', '2026-10-02T12:00:00Z')
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.app.appliedAt).toBeUndefined()
    expect(wasSubmitted(result.app)).toBe(false)
  })

  it('counts an application withdrawn after it was sent', () => {
    const sent = transition(makeApplication({ status: 'draft', history: [], appliedAt: undefined }), 'applied', '2026-10-01T12:00:00Z')
    if (!sent.ok) throw new Error(sent.reason)
    const withdrawn = transition(sent.app, 'withdrawn', '2026-10-05T12:00:00Z')
    if (!withdrawn.ok) throw new Error(withdrawn.reason)
    expect(wasSubmitted(withdrawn.app)).toBe(true)
  })
})
