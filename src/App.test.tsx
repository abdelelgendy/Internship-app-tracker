import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { NAV_ITEMS } from './app/nav.ts'
import { renderApp } from './test/renderApp.tsx'

describe('app shell', () => {
  it('redirects / to Today', async () => {
    const { router } = renderApp('/')
    expect(await screen.findByRole('heading', { level: 1, name: 'Today' })).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/today')
  })

  // One test per page: rendered in one loop they shared the 5-second budget and timed out under load.
  it.each(NAV_ITEMS.map((item) => [item.label, item.to] as const))('renders the %s page from the navigation', async (label, to) => {
    renderApp(to)
    expect(await screen.findByRole('heading', { level: 1, name: label })).toBeInTheDocument()
  })

  it('renders the detail routes with their ids', async () => {
    for (const [path, heading] of [
      ['/jobs/sample-job-1', 'Job'],
      ['/apply/app-7', 'Apply'],
      ['/practice/deck-react', 'Deck'],
    ]) {
      const view = renderApp(path)
      expect(await screen.findByRole('heading', { level: 1, name: heading })).toBeInTheDocument()
      expect(screen.getByText(path.split('/')[2])).toBeInTheDocument()
      view.unmount()
    }
  })

  it('marks the current page in the navigation and moves focus to the new heading', async () => {
    const user = userEvent.setup()
    renderApp('/today')
    await screen.findByRole('heading', { level: 1, name: 'Today' })
    const nav = screen.getByRole('navigation', { name: 'Main' })
    expect(nav.querySelector('[aria-current="page"]')).toHaveTextContent('Today')

    await user.click(screen.getByRole('link', { name: /Board/ }))
    const heading = await screen.findByRole('heading', { level: 1, name: 'Board' })
    expect(nav.querySelector('[aria-current="page"]')).toHaveTextContent('Board')
    await waitFor(() => expect(heading).toHaveFocus())
  })

  it('opens pages with g then a letter, but not while typing', async () => {
    const user = userEvent.setup()
    const { router } = renderApp('/today')
    await screen.findByRole('heading', { level: 1, name: 'Today' })

    await user.keyboard('gj')
    expect(await screen.findByRole('heading', { level: 1, name: 'Jobs' })).toBeInTheDocument()

    const field = document.createElement('input')
    document.body.append(field)
    field.focus()
    await user.keyboard('gb')
    expect(router.state.location.pathname).toBe('/jobs')
    field.remove()
  })

  it('shows the shortcut list on ? and closes it on Escape', async () => {
    const user = userEvent.setup()
    renderApp('/today')
    await screen.findByRole('heading', { level: 1, name: 'Today' })
    await user.keyboard('?')
    expect(screen.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeInTheDocument()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('shows a not-found page for unknown paths', async () => {
    renderApp('/nowhere')
    expect(await screen.findByRole('heading', { level: 1, name: 'Page not found' })).toBeInTheDocument()
    expect(screen.getByText('/nowhere')).toBeInTheDocument()
  })

  it('says which data the app is showing', async () => {
    const sample = renderApp('/today')
    expect(await screen.findByText('Sample data')).toBeInTheDocument()
    sample.unmount()

    renderApp('/today', { kind: 'local', dataDir: '/tmp/copilot-data' })
    expect(await screen.findByText('Local data:')).toBeInTheDocument()
    expect(screen.getByText('/tmp/copilot-data')).toBeInTheDocument()
  })
})
