import { describe, expect, it } from 'vitest'
import { APP_STATUSES, canTransition, QUEUE_STATUSES } from '../engine/states.ts'
import type { Application, Job } from '../engine/types.ts'
import { readJsonl } from './jsonl.ts'
import { ReadOnlyRepoError } from './repo.ts'
import { createSampleRepo, SAMPLE_ANCHOR, shiftSampleDates } from './sampleRepo.ts'

const raw = import.meta.glob<string>('../../sample-data/**/*', { query: '?raw', import: 'default', eager: true })
const anchor = new Date(SAMPLE_ANCHOR)
const repo = createSampleRepo({ now: anchor })

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g
const URL_IN_TEXT = /https?:\/\/[^\s"')\]]+/g
/** Real public ATS hosts with fictional company slugs, and reserved example domains for everything else. */
const ALLOWED_HOSTS = [/^boards\.greenhouse\.io$/, /^jobs\.ashbyhq\.com$/, /^jobs\.lever\.co$/, /^[a-z-]+-sample\.wd3\.myworkdayjobs\.com$/, /(^|\.)example\.com$/]

describe('sample data files', () => {
  it('parses every JSON and JSONL file without problems', () => {
    for (const [path, text] of Object.entries(raw)) {
      if (path.endsWith('.jsonl')) expect(readJsonl(text).issues, path).toEqual([])
      if (path.endsWith('.json')) expect(() => JSON.parse(text), path).not.toThrow()
    }
  })

  it('keeps the fictional persona fictional: example.com email, no phone, reserved domains only', async () => {
    const profile = await repo.getProfile()
    expect(profile?.name).toBe('Sam Rivera')
    expect(profile?.email).toBe('sam.rivera@example.com')
    expect(profile?.phone).toBeUndefined()

    const everything = Object.values(raw).join('\n')
    for (const email of everything.match(EMAIL) ?? []) expect(email).toMatch(/@([a-z0-9-]+\.)*example\.com$/)
    for (const url of everything.match(URL_IN_TEXT) ?? []) {
      const host = new URL(url).hostname
      expect(ALLOWED_HOSTS.some((pattern) => pattern.test(host)), url).toBe(true)
    }
    expect(everything).not.toMatch(/\(?\b\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/)
  })
})

describe('sample jobs', () => {
  it('has 40 postings with unique ids covering every queue status and several sources', async () => {
    const jobs = await repo.listJobs()
    expect(jobs).toHaveLength(40)
    expect(new Set(jobs.map((job) => job.id)).size).toBe(40)
    expect(new Set(jobs.map((job) => job.status))).toEqual(new Set(QUEUE_STATUSES))
    expect(new Set(jobs.map((job) => job.source))).toEqual(new Set(['greenhouse', 'ashby', 'lever', 'manual', 'web-search']))
  })

  it('fills every required field with a valid value', async () => {
    for (const job of await repo.listJobs()) {
      expect(job.company && job.title && job.location && job.url && job.jdText, job.id).toBeTruthy()
      expect(['remote', 'hybrid', 'onsite', 'unknown'], job.id).toContain(job.workplace)
      expect(['api', 'manual', 'search-snippet', 'unknown'], job.id).toContain(job.postedAtSource)
      expect(job.discoveredAt, job.id).toMatch(ISO)
      if (job.postedAt === null) expect(job.postedAtSource, job.id).toBe('unknown')
      else expect(Date.parse(job.postedAt), job.id).toBeLessThanOrEqual(Date.parse(job.discoveredAt))
      if (job.source === 'web-search') expect(job.verified, job.id).toBeTypeOf('boolean')
    }
  })

  it('includes postings with unknown dates, old postings and ones from the last 12 hours', async () => {
    const hoursOld = (job: Job) => (anchor.getTime() - Date.parse(job.postedAt ?? '')) / 3_600_000
    const jobs = await repo.listJobs()
    expect(jobs.filter((job) => job.postedAt === null).length).toBeGreaterThanOrEqual(3)
    expect(jobs.filter((job) => hoursOld(job) < 12).length).toBeGreaterThanOrEqual(5)
    expect(jobs.filter((job) => hoursOld(job) > 168).length).toBeGreaterThanOrEqual(5)
  })
})

describe('sample applications', () => {
  it('has 14 applications covering every status, linked to real jobs', async () => {
    const [jobs, applications] = await Promise.all([repo.listJobs(), repo.listApplications()])
    const jobIds = new Set(jobs.map((job) => job.id))
    expect(applications).toHaveLength(14)
    expect(new Set(applications.map((app) => app.status))).toEqual(new Set(APP_STATUSES))
    for (const app of applications) expect(jobIds.has(app.jobId), app.id).toBe(true)
  })

  it('records a history that ends at the current status and only makes allowed moves', async () => {
    for (const app of await repo.listApplications()) {
      expect(app.history.at(-1)?.status, app.id).toBe(app.status)
      const times = app.history.map((entry) => Date.parse(entry.at))
      expect(times, app.id).toEqual([...times].sort((a, b) => a - b))
      app.history.slice(1).forEach((entry, index) => {
        expect(canTransition(app.history[index].status, entry.status), `${app.id}: ${app.history[index].status} -> ${entry.status}`).toBe(true)
      })
    }
  })

  it('has a cover letter file for every coverLetterId, and appliedAt on everything submitted', async () => {
    const submitted = (app: Application) => !['draft', 'prepared'].includes(app.status)
    for (const app of await repo.listApplications()) {
      if (app.coverLetterId) expect(await repo.getCoverLetter(app.coverLetterId), app.id).toMatch(/Sam Rivera\s*$/)
      expect(app.appliedAt !== undefined, app.id).toBe(submitted(app))
    }
  })
})

describe('sample practice data and watchlist', () => {
  it('has 8 companies, 2 decks, 4 exercises and 3 stories', async () => {
    expect(await repo.listCompanies()).toHaveLength(8)
    expect((await repo.listDecks()).map((deck) => deck.id).sort()).toEqual(['behavioral-basics', 'shortlist-engine'])
    expect(await repo.listExercises()).toHaveLength(4)
    expect(await repo.listStories()).toHaveLength(3)
    expect((await repo.getDeck('shortlist-engine'))?.title).toBe('How Shortlist works')
    expect(await repo.getDeck('nope')).toBeNull()
  })

  it('uses card ids that are unique across decks, and progress only for cards and exercises that exist', async () => {
    const cards = (await repo.listDecks()).flatMap((deck) => deck.cards)
    const cardIds = new Set(cards.map((card) => card.id))
    expect(cardIds.size).toBe(cards.length)
    for (const card of cards) expect(card.keyPoints.length, card.id).toBeGreaterThanOrEqual(3)

    const progress = await repo.getProgress()
    const exerciseIds = new Set((await repo.listExercises()).map((exercise) => exercise.id))
    for (const id of Object.keys(progress.cards)) expect(cardIds.has(id), id).toBe(true)
    for (const id of Object.keys(progress.exercises)) expect(exerciseIds.has(id), id).toBe(true)
  })
})

describe('createSampleRepo', () => {
  it('moves dates to the current time so relative ages stay as written', async () => {
    const later = new Date(anchor.getTime() + 10 * 86_400_000 + 5 * 3_600_000)
    const shifted = createSampleRepo({ now: later })
    const [before, after] = await Promise.all([repo.listJobs(), shifted.listJobs()])
    expect(Date.parse(after[0].postedAt ?? '') - Date.parse(before[0].postedAt ?? '')).toBe(later.getTime() - anchor.getTime())

    const progress = await shifted.getProgress()
    expect(progress.streak.lastDay).toBe('2026-11-12')
    expect((await shifted.getProfile())?.education[0].end).toBe('2026-06')
  })

  it('refuses every save', async () => {
    await expect(repo.saveJob((await repo.listJobs())[0])).rejects.toBeInstanceOf(ReadOnlyRepoError)
    await expect(repo.saveCoverLetter('x', '')).rejects.toBeInstanceOf(ReadOnlyRepoError)
  })
})

describe('shiftSampleDates', () => {
  it('keeps times on the half hour, so they read the same on every visit', () => {
    const at = { interview: '2026-11-05T15:00:00.000Z' }
    const visits = ['2026-11-04T02:14:00.000Z', '2026-11-04T02:16:00.000Z', '2026-11-04T02:21:00.000Z'].map((now) => shiftSampleDates(at, new Date(now)).interview)
    expect(new Set(visits).size).toBe(1)
    expect(visits[0]).toMatch(/T\d{2}:(?:00|30):00\.000Z$/)
  })

  it('shifts full timestamps by whole half hours and plain dates by calendar days, nothing else', () => {
    const now = new Date('2026-11-05T09:30:59.000Z')
    const value = { at: '2026-11-03T17:00:00.000Z', day: '2026-11-03', month: '2026-06', text: 'Posted 2026-11-03', list: ['2026-11-01T00:00:00Z'] }
    expect(shiftSampleDates(value, now)).toEqual({
      at: '2026-11-05T09:30:00.000Z',
      day: '2026-11-05',
      month: '2026-06',
      text: 'Posted 2026-11-03',
      list: ['2026-11-02T16:30:00.000Z'],
    })
  })

  it('returns the same object when no time has passed', () => {
    const value = { at: SAMPLE_ANCHOR }
    expect(shiftSampleDates(value, anchor)).toBe(value)
  })
})
