import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import { APP_STATUSES } from '../../engine/states.ts'
import type { AppStatus } from '../../engine/types.ts'
import { renderApp } from '../../test/renderApp.tsx'
import { sampleSource } from '../../test/sampleSource.ts'

/**
 * jsdom has no layout, so dnd-kit would see every element at 0,0. This lays the board out:
 * columns 260px apart in status order, each card near the top of its column, and the drag
 * overlay where the picked-up card is.
 */
function layOutBoard() {
  const rect = (x: number, y: number, width: number, height: number) => DOMRect.fromRect({ x, y, width, height })
  const cardRect = (element: Element) => {
    const column = element.closest('[data-board-column]')
    const index = APP_STATUSES.indexOf(column?.getAttribute('data-board-column') as AppStatus)
    return rect(index * 260 + 8, 60, 224, 100)
  }
  return vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function (this: Element) {
    const column = this.closest('[data-board-column]')
    if (column === this) return rect(APP_STATUSES.indexOf(this.getAttribute('data-board-column') as AppStatus) * 260, 0, 240, 800)
    if (column) return cardRect(this)
    // Outside the columns: the drag overlay follows the card whose handle is pressed.
    const pressed = document.querySelector('[data-board-column] [aria-pressed="true"]')
    return pressed ? cardRect(pressed) : rect(0, 0, 0, 0)
  })
}

/** The keyboard sensor listens from the next tick after pick-up, so each key gets its own turn. */
async function press(user: ReturnType<typeof userEvent.setup>, key: string) {
  await user.keyboard(key)
  await new Promise((resolve) => setTimeout(resolve, 0))
}

// The routes load each page on first visit. Loading it once up front keeps the first test from
// spending its query timeout on compiling the page when the whole suite runs in parallel.
beforeAll(async () => {
  await import('./BoardPage.tsx')
})

// Interaction tests type and re-render a lot; the default 5s is tight when the suite runs in parallel.
describe('Board moves', { timeout: 15_000 }, () => {
  let layout: ReturnType<typeof layOutBoard>
  beforeEach(() => {
    layout = layOutBoard()
  })
  afterEach(() => layout.mockRestore())

  it('refuses a disallowed keyboard move, says why, and leaves the application where it was', async () => {
    const user = userEvent.setup()
    const source = sampleSource()
    renderApp('/board', undefined, source)

    const handle = await screen.findByRole('button', { name: 'Move Cobalt Orchard, Frontend Developer' })
    handle.focus()
    await press(user, '[Space]')
    await press(user, '[ArrowLeft]')
    await press(user, '[Space]')

    expect(await screen.findByText("Can't move to Prepared")).toBeInTheDocument()
    expect(screen.getByText("It has been submitted, so it can't go back to Prepared.")).toBeInTheDocument()
    const saved = (await source.repo.listApplications()).find((app) => app.id === 'sample-app-03')
    expect(saved?.status).toBe('applied')
    expect(within(screen.getByRole('region', { name: 'Applied' })).getByText('Cobalt Orchard')).toBeInTheDocument()
  })

  it('moves a card one column with the arrow keys and saves the move through the state machine', async () => {
    const user = userEvent.setup()
    const source = sampleSource()
    renderApp('/board', undefined, source)

    const handle = await screen.findByRole('button', { name: 'Move Cobalt Orchard, Frontend Developer' })
    handle.focus()
    await press(user, '[Space]')
    await press(user, '[ArrowRight]')
    await press(user, '[Space]')

    expect(await screen.findByText('Moved to Confirmed')).toBeInTheDocument()
    await waitFor(async () => {
      const saved = (await source.repo.listApplications()).find((app) => app.id === 'sample-app-03')
      expect(saved?.status).toBe('confirmed')
      expect(saved?.history.at(-1)).toMatchObject({ status: 'confirmed', by: 'me' })
    })
    expect(await within(screen.getByRole('region', { name: 'Confirmed' })).findByText('Cobalt Orchard')).toBeInTheDocument()
  })

  it('offers only allowed statuses in the Move to menu and applies the choice', async () => {
    const user = userEvent.setup()
    const source = sampleSource()
    renderApp('/board', undefined, source)

    const menu = await screen.findByRole('combobox', { name: 'Move Glacier Byte, Junior Developer, Client Projects to another status' })
    const options = within(menu)
      .getAllByRole('option')
      .map((option) => option.textContent)
    expect(options).toEqual(['Move to...', 'Rejected', 'Withdrawn'])

    await user.selectOptions(menu, 'Withdrawn')
    expect(await screen.findByText('Moved to Withdrawn')).toBeInTheDocument()
    await waitFor(async () => {
      const saved = (await source.repo.listApplications()).find((app) => app.id === 'sample-app-09')
      expect(saved?.status).toBe('withdrawn')
    })
  })

  it('has no Move to menu on a final status', async () => {
    renderApp('/board')
    const rejected = await screen.findByRole('region', { name: 'Rejected' })
    expect(within(rejected).getAllByRole('button', { name: /^Move / }).length).toBeGreaterThan(0)
    expect(within(rejected).queryByRole('combobox')).not.toBeInTheDocument()
  })
})
