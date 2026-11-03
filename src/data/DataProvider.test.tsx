import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'
import type { PracticeDeck } from '../engine/types.ts'
import { renderApp } from '../test/renderApp.tsx'
import { sampleSource } from '../test/sampleSource.ts'
import { useRepo, useRepoData } from './data-context.ts'
import { DataProvider } from './DataProvider.tsx'
import type { DataSource } from './mode.ts'

function JobCount() {
  const repo = useRepo()
  const { data, loading } = useRepoData('jobs', (r) => r.listJobs())
  return (
    <>
      <p>{loading && !data ? 'Loading' : `${data?.length} jobs`}</p>
      <button type="button" onClick={() => data && repo.saveJob({ ...data[0], id: 'added' })}>
        Add
      </button>
    </>
  )
}

function DeckTitle({ id }: { id: string }) {
  const { data, loading, error } = useRepoData(`deck:${id}`, (repo) => repo.getDeck(id))
  if (error) return <p>Error: {error.message}</p>
  return <p>{loading ? 'Loading deck' : (data?.title ?? 'No deck')}</p>
}

describe('useRepoData', () => {
  it('loads data and loads it again after a save', async () => {
    const user = userEvent.setup()
    render(
      <DataProvider source={sampleSource()}>
        <JobCount />
      </DataProvider>,
    )
    expect(await screen.findByText('40 jobs')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Add' }))
    expect(await screen.findByText('41 jobs')).toBeInTheDocument()
  })

  it('never shows data loaded for a different key', async () => {
    const source = sampleSource()
    let release: (deck: PracticeDeck | null) => void = () => {}
    const slow: DataSource = {
      ...source,
      repo: {
        ...source.repo,
        getDeck: (id) => (id === 'slow' ? new Promise((resolve) => (release = resolve)) : source.repo.getDeck(id)),
      },
    }
    const view = render(
      <DataProvider source={slow}>
        <DeckTitle id="shortlist-engine" />
      </DataProvider>,
    )
    expect(await screen.findByText('How Shortlist works')).toBeInTheDocument()

    view.rerender(
      <DataProvider source={slow}>
        <DeckTitle id="slow" />
      </DataProvider>,
    )
    expect(screen.getByText('Loading deck')).toBeInTheDocument()
    release(null)
    expect(await screen.findByText('No deck')).toBeInTheDocument()
  })

  it('reports a failed load', async () => {
    const source = sampleSource()
    const failing: DataSource = { ...source, repo: { ...source.repo, getDeck: async () => Promise.reject(new Error('disk on fire')) } }
    render(
      <DataProvider source={failing}>
        <DeckTitle id="any" />
      </DataProvider>,
    )
    expect(await screen.findByText('Error: disk on fire')).toBeInTheDocument()
  })
})

describe('mode banner', () => {
  it('says how long changes last and resets the sample data after confirming', async () => {
    const user = userEvent.setup()
    const source = sampleSource()
    const reset = vi.fn(source.resetSampleData)
    renderApp('/today', undefined, { ...source, resetSampleData: reset })

    expect(await screen.findByText(/This browser can't keep changes/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Reset sample data' }))
    const dialog = screen.getByRole('dialog', { name: 'Reset sample data?' })
    expect(reset).not.toHaveBeenCalled()

    await user.click(within(dialog).getByRole('button', { name: 'Reset sample data' }))
    await waitFor(() => expect(reset).toHaveBeenCalledTimes(1))
    expect(await within(screen.getByRole('region', { name: 'Notifications' })).findByText('Sample data reset')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('explains why sample data is showing when local data was expected', async () => {
    renderApp('/today', { kind: 'sample', storage: 'browser', notice: 'Your data folder could not be opened, so this is sample data.' })
    expect(await screen.findByText(/Your changes stay in this browser/)).toBeInTheDocument()
    expect(screen.getByText('Your data folder could not be opened, so this is sample data.')).toBeInTheDocument()
  })

  it('shows no reset control for local data', async () => {
    renderApp('/today', { kind: 'local', dataDir: '/home/sam/shortlist-data' }, { ...sampleSource(), resetSampleData: undefined })
    expect(await screen.findByText('/home/sam/shortlist-data')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Reset sample data' })).not.toBeInTheDocument()
  })
})
