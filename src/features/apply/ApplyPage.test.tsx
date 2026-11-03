import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { followUpDue } from '../../engine/followups.ts'
import { renderApp } from '../../test/renderApp.tsx'
import { sampleSource } from '../../test/sampleSource.ts'

/** The list item for one form question in the apply kit. */
function answerRow(question: string): HTMLElement {
  const row = screen.getByText(question, { selector: 'label' }).closest('li')
  if (!row) throw new Error(`No answer row for "${question}"`)
  return row
}

// The routes load each page on first visit. Loading it once up front keeps the first test from
// spending its query timeout on compiling the page when the whole suite runs in parallel.
beforeAll(async () => {
  await import('./ApplyPage.tsx')
})

// Interaction tests type and re-render a lot; the default 5s is tight when the suite runs in parallel.
describe('Apply kit', { timeout: 15_000 }, () => {
  beforeEach(() => localStorage.clear())

  it('flags every question the engine has no answer for, and shows where each suggestion came from', async () => {
    renderApp('/apply/sample-app-01')
    expect(await screen.findByRole('heading', { level: 1, name: 'Apply to Harbourlight Health' })).toBeInTheDocument()

    const flagged = screen.getAllByText('You answer this').map((badge) => badge.closest('li')?.querySelector('label')?.textContent)
    expect(flagged).toEqual([
      'Will you require sponsorship to work in the United States?',
      'What are your salary expectations?',
      'Demographic and equal opportunity questions',
      'Do you have experience with GraphQL?',
    ])

    const salary = answerRow('What are your salary expectations?')
    expect(within(salary).getByRole('textbox')).toHaveValue('')
    expect(within(salary).getByText(/marked to answer yourself each time/)).toBeInTheDocument()
    expect(within(salary).getByRole('button', { name: /Copy answer/ })).toBeDisabled()

    const authorized = answerRow('Are you legally authorized to work in Canada?')
    expect(within(authorized).queryByText('You answer this')).not.toBeInTheDocument()
    expect(within(authorized).getByRole('textbox')).toHaveValue('Yes')
    expect(within(authorized).getByText('From your saved answer "Are you legally authorized to work in Canada?"')).toBeInTheDocument()

    expect(within(answerRow('Do you have experience with React?')).getByText('You list React as a strong skill.')).toBeInTheDocument()
    expect(within(answerRow('Have you previously applied to Harbourlight Health?')).getByRole('textbox')).toHaveValue('Yes')
  })

  it('records the submission: applied date, the answers used, and the day-7 follow-up', async () => {
    const user = userEvent.setup()
    const source = sampleSource()
    renderApp('/apply/sample-app-01', undefined, source)
    await screen.findByRole('heading', { level: 1, name: 'Apply to Harbourlight Health' })

    // Copying an answer marks it used; typing your own answer does too; the box can be ticked by hand.
    await user.click(within(answerRow('Are you legally authorized to work in Canada?')).getByRole('button', { name: /Copy answer/ }))
    await user.type(within(answerRow('What are your salary expectations?')).getByRole('textbox'), '$75,000')
    await user.click(within(answerRow('When can you start?')).getByRole('checkbox', { name: 'Used on this form' }))
    expect(within(answerRow('What are your salary expectations?')).getByRole('checkbox', { name: 'Used on this form' })).toBeChecked()

    await user.click(screen.getByRole('button', { name: 'I submitted it' }))
    const dialog = await screen.findByRole('dialog', { name: 'Record it as applied' })
    expect(within(dialog).getByText('3 answers marked as used')).toBeInTheDocument()
    const before = Date.now()
    await user.click(within(dialog).getByRole('button', { name: 'Record as applied' }))

    expect(await screen.findByText('Recorded as applied')).toBeInTheDocument()
    expect(await screen.findByRole('heading', { level: 1, name: 'Applied to Harbourlight Health' })).toBeInTheDocument()

    const saved = (await source.repo.listApplications()).find((app) => app.id === 'sample-app-01')
    expect(saved?.status).toBe('applied')
    expect(saved?.answersUsed).toEqual({
      'Are you legally authorized to work in Canada?': 'Yes',
      'What are your salary expectations?': '$75,000',
      'When can you start?': 'Two weeks after an offer',
    })
    // The time comes from a minute-precision field, so it is at most a minute before the click.
    const appliedAt = Date.parse(saved?.appliedAt ?? '')
    expect(before - appliedAt).toBeLessThan(60_000)
    expect(appliedAt).toBeLessThanOrEqual(Date.now())
    expect(saved?.followUp).toEqual({ dueAt: followUpDue({ appliedAt: saved?.appliedAt }) })
    expect(saved?.history.at(-1)).toMatchObject({ status: 'applied', by: 'me' })
    expect(saved?.resumeVersion).toBe('resume-2026-10-frontend')
  })

  it('saves the cover letter and shows the linter results as you type', async () => {
    const user = userEvent.setup()
    const source = sampleSource()
    renderApp('/apply/sample-app-01', undefined, source)
    const letter = await screen.findByRole('textbox', { name: 'Cover letter for Harbourlight Health' })

    await user.type(letter, 'As a new grad I am passionate about clinics; I built 12 apps.')
    const checks = screen.getByRole('region', { name: 'Cover letter checks' })
    await waitFor(() => expect(within(checks).getByText(/to fix/)).toBeInTheDocument())
    expect(within(checks).getByText('Uses "passionate about", which is on the banned list.')).toBeInTheDocument()
    expect(within(checks).getByText('Uses a semicolon. Split it into two sentences.')).toBeInTheDocument()
    expect(within(checks).getByText(/Does not name Harbourlight Health/)).toBeInTheDocument()

    await waitFor(async () => expect(await source.repo.getCoverLetter('sample-app-01')).toContain('passionate about'), { timeout: 2000 })
  })

  it('never offers the Claude draft in sample mode', async () => {
    renderApp('/apply/sample-app-01')
    await screen.findByRole('heading', { level: 1, name: 'Apply to Harbourlight Health' })
    expect(screen.queryByRole('button', { name: /Draft with Claude/ })).not.toBeInTheDocument()
  })

  it('shows what was sent once the application is submitted', async () => {
    renderApp('/apply/sample-app-03')
    expect(await screen.findByRole('heading', { level: 1, name: 'Applied to Cobalt Orchard' })).toBeInTheDocument()
    expect(screen.getByText('Will you now or in the future require sponsorship to work in Canada?')).toBeInTheDocument()
  })
})
