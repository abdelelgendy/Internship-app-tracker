import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { renderApp } from '@/test/renderApp.tsx'

describe('Import page in the demo', () => {
  it('previews the demo import against the sample data, with Apply turned off', { timeout: 15_000 }, async () => {
    const user = userEvent.setup()
    renderApp('/import')
    await screen.findByRole('heading', { level: 1, name: 'Import' })
    await user.click(screen.getByRole('button', { name: 'Preview the demo import' }))

    const report = await screen.findByRole('region', { name: 'Preview' })
    const tiles = within(report).getAllByRole('definition')
    // Quillstack's posting is already in the sample data, and Pinecrest's application links to the sample job.
    expect(within(report).getByText('Jobs to add').nextSibling).toHaveTextContent('5')
    expect(tiles[1]).toHaveTextContent('5')

    const mapping = within(report).getByRole('table')
    const submitted = within(mapping).getByRole('cell', { name: 'submitted' }).closest('tr') as HTMLTableRowElement
    expect(within(submitted).getByText('Applied')).toBeInTheDocument()
    expect(within(submitted).getByText('5')).toBeInTheDocument()

    expect(within(report).getByRole('heading', { name: /Mismatches/ })).toBeInTheDocument()
    expect(within(report).getByText(/still says "tailored"/)).toBeInTheDocument()
    expect(within(report).getByText(/matches a job already in Shortlist/)).toBeInTheDocument()
    expect(within(report).getByText(/A tailoring log for Junior Software Developer at Tidewater Robotics/)).toBeInTheDocument()
    expect(within(report).getByText(/share one link \(lines 2, 3\)/)).toBeInTheDocument()

    expect(within(report).getByRole('button', { name: 'Apply import' })).toBeDisabled()
    expect(within(report).getByText(/Apply is off in the demo/)).toBeInTheDocument()
  })
})
