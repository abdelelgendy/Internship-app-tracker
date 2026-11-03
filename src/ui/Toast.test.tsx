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
})
