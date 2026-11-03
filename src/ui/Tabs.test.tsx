import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { Tabs } from './Tabs.tsx'

const items = [
  { id: 'score', label: 'Score', content: <p>Score panel</p> },
  { id: 'posting', label: 'Posting', content: <p>Posting panel</p> },
  { id: 'notes', label: 'Notes', count: 2, content: <p>Notes panel</p> },
]

describe('Tabs', () => {
  it('moves selection with the arrow keys, Home and End, wrapping at the ends', async () => {
    const user = userEvent.setup()
    render(<Tabs label="Job sections" items={items} />)
    expect(screen.getByRole('tablist', { name: 'Job sections' })).toBeInTheDocument()
    expect(screen.getByRole('tabpanel', { name: 'Score' })).toHaveTextContent('Score panel')

    await user.tab()
    expect(screen.getByRole('tab', { name: 'Score' })).toHaveFocus()
    await user.keyboard('{ArrowLeft}')
    expect(screen.getByRole('tab', { name: /Notes/ })).toHaveAttribute('aria-selected', 'true')
    expect(screen.getByRole('tabpanel')).toHaveTextContent('Notes panel')
    await user.keyboard('{Home}')
    expect(screen.getByRole('tab', { name: 'Score' })).toHaveFocus()
    await user.keyboard('{ArrowRight}')
    expect(screen.getByRole('tab', { name: 'Posting' })).toHaveAttribute('aria-selected', 'true')
    await user.keyboard('{End}')
    expect(screen.getByRole('tab', { name: /Notes/ })).toHaveFocus()
  })

  it('keeps only the selected tab in the Tab order', () => {
    render(<Tabs label="Job sections" items={items} defaultValue="posting" />)
    const tabs = screen.getAllByRole('tab')
    expect(tabs.map((tab) => tab.tabIndex)).toEqual([-1, 0, -1])
  })
})
