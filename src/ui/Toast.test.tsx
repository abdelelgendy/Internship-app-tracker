import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Button } from './Button.tsx'
import { ToastProvider } from './Toast.tsx'
import { useToast } from './toast-context.ts'

function Trigger({ onUndo }: { onUndo?: () => void }) {
  const toast = useToast()
  return (
    <Button
      onClick={() =>
        toast.show({ title: 'Moved to Applied', action: onUndo ? { label: 'Undo', onAction: onUndo } : undefined })
      }
    >
      Move
    </Button>
  )
}

describe('Toast', () => {
  afterEach(() => vi.useRealTimers())

  it('announces the message and hides it after a few seconds', async () => {
    vi.useFakeTimers()
    render(
      <ToastProvider>
        <Trigger />
      </ToastProvider>,
    )
    act(() => screen.getByRole('button', { name: 'Move' }).click())
    const region = screen.getByRole('region', { name: 'Notifications' })
    expect(region).toHaveTextContent('Moved to Applied')
    expect(document.querySelector('[aria-live="polite"]')).toHaveTextContent('Moved to Applied')
    act(() => vi.advanceTimersByTime(5_000))
    expect(region).not.toHaveTextContent('Moved to Applied')
  })

  it('runs the action and dismisses the toast', async () => {
    const user = userEvent.setup()
    const onUndo = vi.fn()
    render(
      <ToastProvider>
        <Trigger onUndo={onUndo} />
      </ToastProvider>,
    )
    await user.click(screen.getByRole('button', { name: 'Move' }))
    await user.click(screen.getByRole('button', { name: 'Undo' }))
    expect(onUndo).toHaveBeenCalledOnce()
    expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument()
  })

  it('says Undo is there and how to reach it, and Alt+N moves focus to it', async () => {
    const user = userEvent.setup()
    render(
      <ToastProvider>
        <Trigger onUndo={() => {}} />
      </ToastProvider>,
    )
    await user.click(screen.getByRole('button', { name: 'Move' }))
    expect(document.querySelector('[aria-live="polite"]')).toHaveTextContent('Moved to Applied. Undo is available: press Alt+N.')
    await user.keyboard('{Alt>}n{/Alt}')
    expect(screen.getByRole('button', { name: 'Undo' })).toHaveFocus()
  })

  it('waits while it is hovered or holds focus, and gives focus back when it closes', async () => {
    vi.useFakeTimers()
    render(
      <ToastProvider>
        <Trigger onUndo={() => {}} />
      </ToastProvider>,
    )
    const move = screen.getByRole('button', { name: 'Move' })
    act(() => move.focus())
    act(() => move.click())
    const undo = screen.getByRole('button', { name: 'Undo' })
    act(() => undo.focus())
    act(() => vi.advanceTimersByTime(60_000))
    expect(undo).toBeInTheDocument()
    act(() => screen.getByRole('button', { name: 'Dismiss notification' }).click())
    expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument()
    expect(move).toHaveFocus()

    act(() => move.click())
    const toast = screen.getByRole('button', { name: 'Undo' }).closest('[data-toast-id]')!
    act(() => toast.dispatchEvent(new MouseEvent('mouseover', { bubbles: true })))
    act(() => vi.advanceTimersByTime(60_000))
    expect(screen.getByRole('button', { name: 'Undo' })).toBeInTheDocument()
    act(() => toast.dispatchEvent(new MouseEvent('mouseout', { bubbles: true })))
    act(() => vi.advanceTimersByTime(15_000))
    expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument()
  })
})
