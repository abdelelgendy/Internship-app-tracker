import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, describe, expect, it } from 'vitest'
import { renderApp } from '../../test/renderApp.tsx'
import { sampleSource } from '../../test/sampleSource.ts'

const DESCRIPTION = `Junior Frontend Developer
Posted 3 hours ago
Lakeview Tools builds scheduling software. New grads welcome, 0-2 years of experience.
You will build React and TypeScript screens. Location: Toronto, hybrid.`

// The routes load each page on first visit. Loading it once up front keeps the first test from
// spending its query timeout on compiling the page when the whole suite runs in parallel.
beforeAll(async () => {
  await import('./JobsPage.tsx')
  await import('./JobDetailPage.tsx')
})

// Interaction tests type and re-render a lot; the default 5s is tight when the suite runs in parallel.
describe('Jobs', { timeout: 15_000 }, () => {
  it('adds a job from a URL and pasted text, scores it as you type, and opens it', async () => {
    const user = userEvent.setup()
    const source = sampleSource()
    const { router } = renderApp('/jobs', undefined, source)
    await user.click(await screen.findByRole('button', { name: 'Add job' }))
    const dialog = screen.getByRole('dialog', { name: 'Add a job' })

    await user.type(within(dialog).getByLabelText('Posting URL'), 'https://jobs.lever.co/lakeview-tools/7f3a')
    expect(within(dialog).getByLabelText('Company')).toHaveValue('Lakeview Tools')
    await user.click(within(dialog).getByLabelText('Description'))
    await user.paste(DESCRIPTION)
    // The title and the posting time come from the pasted text.
    expect(within(dialog).getByLabelText('Job title')).toHaveValue('Junior Frontend Developer')
    expect(within(dialog).getByLabelText('Posted')).not.toHaveValue('')

    const preview = within(dialog).getByRole('region', { name: 'Score preview' })
    await waitFor(() => expect(within(preview).getByLabelText(/^Score \d+ of 100/)).toBeInTheDocument())
    expect(preview).toHaveTextContent(/Skills found: React, TypeScript/)

    await user.click(within(dialog).getByRole('button', { name: 'Add job' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Junior Frontend Developer' })).toBeInTheDocument()
    expect(router.state.location.pathname).toMatch(/^\/jobs\/manual-/)

    const saved = (await source.repo.listJobs()).find((job) => job.company === 'Lakeview Tools')
    expect(saved).toMatchObject({ source: 'manual', ats: 'lever', postedAtSource: 'manual', verified: true })
    expect(saved?.score?.parts.reduce((sum, part) => sum + part.points, 0)).toBe(saved?.score?.total)
  })

  it('says what is missing instead of saving an incomplete job', async () => {
    const user = userEvent.setup()
    renderApp('/jobs')
    await user.click(await screen.findByRole('button', { name: 'Add job' }))
    const dialog = screen.getByRole('dialog', { name: 'Add a job' })
    await user.click(within(dialog).getByRole('button', { name: 'Add job' }))
    expect(within(dialog).getByText('Paste the full posting address, starting with https://')).toBeInTheDocument()
    expect(within(dialog).getByText(/Paste the full description/)).toBeInTheDocument()
  })

  it('shortlists the selected jobs in one go', async () => {
    const user = userEvent.setup()
    const source = sampleSource()
    renderApp('/jobs', undefined, source)
    await user.click(await screen.findByRole('checkbox', { name: 'Select Quillstack, Junior Frontend Engineer' }))
    await user.click(screen.getByRole('checkbox', { name: 'Select Brightfern Learning, Junior Web Developer' }))
    await user.click(within(screen.getByRole('group', { name: 'Bulk actions' })).getByRole('button', { name: 'Shortlist' }))

    expect(await within(screen.getByRole('region', { name: 'Notifications' })).findByText('Shortlisted 2 jobs')).toBeInTheDocument()
    await waitFor(async () => {
      const statuses = (await source.repo.listJobs())
        .filter((job) => ['sample-job-03', 'sample-job-05'].includes(job.id))
        .map((job) => job.status)
      expect(statuses).toEqual(['shortlisted', 'shortlisted'])
    })
  })

  it('filters by the gate and sorts by score from the column header', async () => {
    const user = userEvent.setup()
    renderApp('/jobs')
    await screen.findByRole('checkbox', { name: 'Select all shown jobs' })
    await user.click(screen.getByRole('checkbox', { name: 'Passes the gate' }))
    await user.click(screen.getByRole('button', { name: 'Score' }))

    const scores = screen.getAllByLabelText(/^Score \d+ of 100/).map((element) => Number(element.textContent))
    expect(scores.length).toBeGreaterThan(0)
    expect(scores).toEqual([...scores].sort((a, b) => b - a))
    expect(screen.getAllByLabelText(/^Score \d+ of 100, passes the gate$/)).toHaveLength(scores.length)
    expect(screen.getByRole('columnheader', { name: /Score/ })).toHaveAttribute('aria-sort', 'descending')
  })

  it('moves between rows with the arrow keys', async () => {
    const user = userEvent.setup()
    renderApp('/jobs')
    await screen.findByRole('checkbox', { name: 'Select all shown jobs' })
    const links = Array.from(document.querySelectorAll<HTMLAnchorElement>('a[data-row-link]'))
    links[0].focus()
    await user.keyboard('{ArrowDown}')
    expect(links[1]).toHaveFocus()
    await user.keyboard('{End}')
    expect(links.at(-1)).toHaveFocus()
  })
})
