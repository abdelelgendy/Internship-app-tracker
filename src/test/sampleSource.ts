import { createBrowserRepo } from '../data/browserRepo.ts'
import { createMemoryStore } from '../data/docStore.ts'
import type { DataSource } from '../data/mode.ts'
import { createSampleRepo } from '../data/sampleRepo.ts'

/**
 * A fresh, writable copy of the sample data in memory, like the demo with IndexedDB refused.
 * Dates are moved to `now`, so "posted 3 hours ago" stays true whenever the tests run.
 */
export function sampleSource({ now }: { now?: Date } = {}): DataSource {
  const browser = createBrowserRepo(createMemoryStore(), async () => createSampleRepo({ now }))
  return { mode: { kind: 'sample', storage: 'memory' }, repo: browser.repo, resetSampleData: browser.reset }
}
