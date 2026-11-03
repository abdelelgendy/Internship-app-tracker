import { describe, expect, it, vi } from 'vitest'
import { createBrowserRepo } from './browserRepo.ts'
import { createMemoryStore } from './docStore.ts'
import { createSampleRepo, SAMPLE_ANCHOR } from './sampleRepo.ts'

const seed = () => createSampleRepo({ now: new Date(SAMPLE_ANCHOR) })

describe('createBrowserRepo', () => {
  it('copies the seed on first use and only then', async () => {
    const store = createMemoryStore()
    const loadSeed = vi.fn(async () => seed())
    const first = createBrowserRepo(store, loadSeed)
    expect(await first.repo.listJobs()).toHaveLength(40)
    expect((await first.repo.getProfile())?.name).toBe('Sam Rivera')
    expect(await first.repo.getCoverLetter('sample-app-02')).toMatch(/Maple Ledger/)

    const returning = createBrowserRepo(store, loadSeed)
    await returning.ready
    expect(loadSeed).toHaveBeenCalledTimes(1)
  })

  it('keeps saves, upserts by id, and hands out copies', async () => {
    const { repo } = createBrowserRepo(createMemoryStore(), async () => seed())
    const [job] = await repo.listJobs()
    job.title = 'Changed in memory only'
    expect((await repo.listJobs()).find((row) => row.id === job.id)?.title).not.toBe('Changed in memory only')

    await repo.saveJob({ ...job, status: 'archived' })
    await repo.saveJobs([{ ...job, id: 'new-job' }])
    const jobs = await repo.listJobs()
    expect(jobs).toHaveLength(41)
    expect(jobs.find((row) => row.id === job.id)?.status).toBe('archived')

    await repo.saveCoverLetter('sample-app-01', '# New draft')
    expect(await repo.getCoverLetter('sample-app-01')).toBe('# New draft')
    await repo.saveProgress({ cards: {}, exercises: {}, streak: { current: 9, best: 9 } })
    expect((await repo.getProgress()).streak.current).toBe(9)
  })

  it('puts the sample data back on reset', async () => {
    const browser = createBrowserRepo(createMemoryStore(), async () => seed())
    const [job] = await browser.repo.listJobs()
    await browser.repo.saveJob({ ...job, title: 'Edited' })
    await browser.repo.saveJobs([{ ...job, id: 'extra' }])
    await browser.reset()
    const jobs = await browser.repo.listJobs()
    expect(jobs).toHaveLength(40)
    expect(jobs.find((row) => row.id === job.id)?.title).toBe(job.title)
  })

  it('reports a failed seed to every caller', async () => {
    const browser = createBrowserRepo(createMemoryStore(), async () => {
      throw new Error('chunk failed to load')
    })
    await expect(browser.ready).rejects.toThrow('chunk failed to load')
    await expect(browser.repo.listJobs()).rejects.toThrow('chunk failed to load')
  })
})
