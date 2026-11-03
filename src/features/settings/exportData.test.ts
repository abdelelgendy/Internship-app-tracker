import { describe, expect, it } from 'vitest'
import { sampleSource } from '@/test/sampleSource.ts'
import { collectExport, exportFileName } from './exportData.ts'

describe('export', () => {
  it('bundles every file, with cover letters by application id', async () => {
    const source = sampleSource()
    const bundle = await collectExport(source.repo, { kind: 'local', dataDir: '/tmp/data' }, new Date('2026-11-03T17:00:00Z'))
    expect(bundle).toMatchObject({ app: 'Shortlist', dataMode: 'local', exportedAt: '2026-11-03T17:00:00.000Z' })
    expect(bundle.jobs).toHaveLength(40)
    expect(bundle.applications).toHaveLength(14)
    expect(bundle.practice.decks).toHaveLength(2)
    expect(Object.keys(bundle.covers).sort()).toEqual(['sample-app-02', 'sample-app-03', 'sample-app-14'])
    expect(bundle.profile?.answers.some((answer) => answer.id === 'eeo')).toBe(true)
  })

  it('leaves self-identification answers out of the demo export', async () => {
    const source = sampleSource()
    const bundle = await collectExport(source.repo, source.mode, new Date())
    expect(bundle.dataMode).toBe('sample')
    expect(bundle.profile?.answers.some((answer) => answer.id === 'eeo')).toBe(false)
    expect(JSON.stringify(bundle)).not.toContain('Demographic and equal opportunity questions')
  })

  it('names the file by the local day', () => {
    expect(exportFileName(new Date(2026, 10, 3, 23, 30))).toBe('shortlist-export-2026-11-03.json')
  })
})
