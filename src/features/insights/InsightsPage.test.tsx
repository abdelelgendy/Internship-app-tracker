import { configure, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, describe, expect, it } from 'vitest'
import { renderApp } from '../../test/renderApp.tsx'
import { sampleSource } from '../../test/sampleSource.ts'

configure({ asyncUtilTimeout: 5000 })

beforeAll(async () => {
  await import('./InsightsPage.tsx')
})

describe('Insights', { timeout: 15_000 }, () => {
  it('leads with the sample reply rate and its likely range', async () => {
    renderApp('/insights')
    expect(await screen.findByText('12 applications sent. 5 got a reply from a person (42%, likely 19% to 68%).')).toBeInTheDocument()

    const funnel = screen.getByRole('region', { name: 'From sent to offer' })
    const steps = within(funnel).getAllByRole('listitem').slice(0, 4)
    expect(steps.map((step) => step.textContent)).toEqual(['Sent12', 'A person replied542% of sent', 'Interview325% of sent', 'Offer18% of sent'])
    expect(within(funnel).getByText(/waiting on a reply, 2 not sent yet\./)).toBeInTheDocument()
  })

  it('hides group rates below ten sent, says why, and shows the counts', async () => {
    renderApp('/insights')
    const groups = await screen.findByRole('region', { name: 'Reply rate by group' })
    expect(within(groups).getByText(/A rate shows once a group has 10 sent applications/)).toBeInTheDocument()
    const workplace = within(groups).getByRole('region', { name: 'Workplace' })
    expect(within(workplace).getByText('Hybrid')).toBeInTheDocument()
    expect(within(workplace).getByText('9 sent, 3 replies.')).toBeInTheDocument()
    expect(within(workplace).getByText('Rate shows at 10, 1 to go.')).toBeInTheDocument()
    expect(within(workplace).queryByText(/likely/)).not.toBeInTheDocument()
    const size = within(groups).getByRole('region', { name: 'Company size' })
    expect(within(size).getByText('No sent applications have this detail yet.')).toBeInTheDocument()
  })

  it('shows a rate with its likely range once a group reaches ten sent', async () => {
    const source = sampleSource()
    const hybrid = (await source.repo.listJobs()).filter((job) => job.workplace === 'hybrid').slice(0, 3)
    for (const [index, job] of hybrid.entries()) {
      const at = `2026-10-0${index + 1}T14:00:00.000Z`
      await source.repo.saveApplication({ id: `extra-${index}`, jobId: job.id, company: job.company, title: job.title, url: job.url, status: 'applied', appliedAt: at, channel: 'ats', history: [{ status: 'applied', at, by: 'me' }] })
    }
    renderApp('/insights', undefined, source)
    const workplace = await screen.findByRole('region', { name: 'Workplace' })
    expect(within(workplace).getByText('likely 9% to 53%')).toBeInTheDocument()
    expect(within(workplace).getByText('25%')).toBeInTheDocument()
    expect(within(workplace).getByText('(12 sent, 3 replies)')).toBeInTheDocument()
  })

  it('offers the weekly chart as a table', async () => {
    const user = userEvent.setup()
    renderApp('/insights')
    const weekly = await screen.findByRole('region', { name: 'Applications per week' })
    expect(within(weekly).getByRole('img', { name: /^Column chart\. 12 sent in the last 12 weeks\./ })).toBeInTheDocument()
    await user.click(within(weekly).getByRole('button', { name: 'Show table' }))
    const table = within(weekly).getByRole('table', { name: 'Applications sent per week' })
    expect(within(table).getAllByRole('row')).toHaveLength(13)
    expect(within(table).getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual(['Week', 'Sent'])
    expect(within(weekly).getByRole('button', { name: 'Show chart' })).toHaveAttribute('aria-pressed', 'true')
  })
})
