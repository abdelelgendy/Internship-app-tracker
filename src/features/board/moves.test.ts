import { describe, expect, it } from 'vitest'
import { followUpDue } from '../../engine/followups.ts'
import { makeApplication, TZ } from '../../engine/fixtures.ts'
import { canTransition, APP_STATUSES } from '../../engine/states.ts'
import type { AppStatus } from '../../engine/types.ts'
import { allowedMoves, applyMove, moveProblem } from './moves.ts'

describe('moveProblem', () => {
  it('allows exactly the moves the state machine allows', () => {
    for (const from of APP_STATUSES) {
      for (const to of APP_STATUSES) {
        if (from === to) continue
        expect(moveProblem(from, to) === null, `${from} -> ${to}`).toBe(canTransition(from, to))
      }
    }
  })

  it.each<[AppStatus, AppStatus, RegExp]>([
    ['rejected', 'applied', /Rejected is final.*new application/],
    ['withdrawn', 'reviewing', /Withdrawn is final/],
    ['applied', 'draft', /submitted, so it can't go back to Draft/],
    ['interview_scheduled', 'prepared', /can't go back to Prepared/],
    ['draft', 'interview_scheduled', /hasn't been submitted yet.*Applied/],
    ['offer', 'reviewing', /offer ends as Rejected.*Withdrawn/],
    ['reviewing', 'confirmed', /From In review it can move to .*Assessment.*or Withdrawn/],
  ])('explains %s -> %s', (from, to, reason) => {
    expect(moveProblem(from, to)).toMatch(reason)
  })

  it('treats a move to the same column as no move', () => {
    expect(moveProblem('applied', 'applied')).toBeNull()
  })

  it('lists no moves out of a final status', () => {
    expect(allowedMoves('rejected')).toEqual([])
    expect(allowedMoves('offer')).toEqual(['rejected', 'withdrawn'])
  })
})

describe('applyMove', () => {
  const at = '2026-11-03T15:00:00.000Z'

  it('records the applied date and schedules the day-7 follow-up when a draft moves to Applied', () => {
    const app = makeApplication({
      status: 'draft',
      history: [{ status: 'draft', at: '2026-11-01T12:00:00.000Z', by: 'me' }],
      appliedAt: undefined,
      followUp: undefined,
    })
    const result = applyMove(app, 'applied', at, TZ)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.app.status).toBe('applied')
    expect(result.app.appliedAt).toBe(at)
    expect(result.app.followUp).toEqual({ dueAt: followUpDue({ appliedAt: at }, TZ) })
    expect(result.app.history.at(-1)).toEqual({ status: 'applied', at, by: 'me' })
  })

  it('keeps an existing follow-up and does not add one for other moves', () => {
    const app = makeApplication({
      status: 'applied',
      appliedAt: '2026-10-20T12:00:00.000Z',
      followUp: { dueAt: '2026-10-27T12:00:00.000Z' },
    })
    const result = applyMove(app, 'reviewing', at, TZ)
    expect(result.ok && result.app.followUp).toEqual({ dueAt: '2026-10-27T12:00:00.000Z' })
  })

  it('refuses a disallowed move with the plain reason and leaves the application alone', () => {
    const app = makeApplication({ status: 'rejected' })
    expect(applyMove(app, 'applied', at, TZ)).toEqual({ ok: false, reason: moveProblem('rejected', 'applied') })
  })
})
