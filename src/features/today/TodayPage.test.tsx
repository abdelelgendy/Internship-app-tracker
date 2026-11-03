import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, describe, expect, it } from 'vitest'
import { renderApp } from '../../test/renderApp.tsx'
import { sampleSource } from '../../test/sampleSource.ts'

function section(name: string): HTMLElement {
  return screen.getByRole('region', { name })
}

// The routes load each page on first visit. Loading it once up front keeps the first test from
// spending its query timeout on compiling the page when the whole suite runs in parallel.
beforeAll(async () => {
  await import('./TodayPage.tsx')
  await import('../apply/ApplyPage.tsx')
})

// Interaction tests type and re-render a lot; the default 5s is tight when the suite runs in parallel.
describe('Today', { timeout: 15_000 }, () => {
  it('shows each kind of work with one action, and a summary built from it', async () => {
    renderApp('/today')
    expect(
      await screen.findByText(/1 interview coming up, 1 follow-up due, 4 applications waiting on you and \d+ jobs worth applying to\./),
    ).toBeInTheDocument()

    expect(within(section('Interviews coming up')).getByText('Harbourlight Health')).toBeInTheDocument()
    expect(within(section('Follow-ups')).getByText('2 days late')).toBeInTheDocument()
    const waiting = section('Waiting on you')
    expect(within(waiting).getByRole('link', { name: 'Submit it' })).toHaveAttribute('href', '/apply/sample-app-02')
    expect(within(waiting).getByRole('button', { name: 'Mark done' })).toBeInTheDocument()
    expect(within(section('Worth applying to')).getAllByRole('button', { name: 'Start application' })).toHaveLength(5)
  })

  it('marks a follow-up as sent', async () => {
    const user = userEvent.setup()
    const source = sampleSource()
    renderApp('/today', undefined, source)
    await screen.findByText('2 days late')
    await user.click(within(section('Follow-ups')).getByRole('button', { name: 'Mark sent' }))

    await waitFor(async () => {
      const app = (await source.repo.listApplications()).find((entry) => entry.id === 'sample-app-04')
      expect(app?.followUp?.sentAt).toBeDefined()
    })
    expect(await within(section('Follow-ups')).findByText(/No follow-ups due/)).toBeInTheDocument()
  })

  it('starts an application from a suggested job and opens the apply kit', async () => {
    const user = userEvent.setup()
    const source = sampleSource()
    const { router } = renderApp('/today', undefined, source)
    const matches = await screen.findAllByRole('button', { name: 'Start application' })
    await user.click(matches[0])

    expect(await screen.findByRole('heading', { level: 1, name: /^Apply to / })).toBeInTheDocument()
    expect(router.state.location.pathname).toMatch(/^\/apply\/app-/)
    const created = (await source.repo.listApplications()).find((app) => router.state.location.pathname.endsWith(app.id))
    expect(created).toMatchObject({ status: 'draft', history: [{ status: 'draft', by: 'me' }] })
  })
})
