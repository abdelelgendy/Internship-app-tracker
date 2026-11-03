import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Button } from './Button.tsx'
import { cx } from './cx.ts'
import { IconButton } from './IconButton.tsx'
import { CloseIcon } from './icons.tsx'
import { ToastContext, type ToastApi, type ToastOptions } from './toast-context.ts'

interface ToastEntry extends ToastOptions {
  id: number
}

const MAX_VISIBLE = 3

const stripes = {
  neutral: 'border-l-line-strong',
  success: 'border-l-success-ink',
  danger: 'border-l-danger-ink',
}

/**
 * Renders toasts in the corner and announces each one through a live region that is always in
 * the page; screen readers miss live regions that are inserted together with their text.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastEntry[]>([])
  const [announcement, setAnnouncement] = useState({ polite: '', assertive: '' })
  const nextId = useRef(1)
  const timers = useRef(new Map<number, ReturnType<typeof setTimeout>>())

  const dismiss = useCallback((id: number) => {
    clearTimeout(timers.current.get(id))
    timers.current.delete(id)
    setToasts((current) => current.filter((toast) => toast.id !== id))
  }, [])

  const show = useCallback(
    (options: ToastOptions) => {
      const id = nextId.current++
      setToasts((current) => [...current.slice(-(MAX_VISIBLE - 1)), { ...options, id }])
      const text = options.description ? `${options.title}. ${options.description}` : options.title
      setAnnouncement(options.tone === 'danger' ? { polite: '', assertive: text } : { polite: text, assertive: '' })
      timers.current.set(id, setTimeout(() => dismiss(id), options.durationMs ?? (options.action ? 10_000 : 5_000)))
      return id
    },
    [dismiss],
  )

  useEffect(() => {
    const pending = timers.current
    return () => pending.forEach((timer) => clearTimeout(timer))
  }, [])

  const api = useMemo<ToastApi>(() => ({ show, dismiss }), [show, dismiss])

  return (
    <ToastContext value={api}>
      {children}
      <div aria-live="polite" className="sr-only">
        {announcement.polite}
      </div>
      <div aria-live="assertive" className="sr-only">
        {announcement.assertive}
      </div>
      <section
        aria-label="Notifications"
        className="pointer-events-none fixed inset-x-4 bottom-4 z-50 flex flex-col gap-2 md:right-6 md:bottom-6 md:left-auto md:w-[22rem]"
      >
        {toasts.map((toast) => (
          <div
            key={toast.id}
            className={cx(
              'pointer-events-auto flex items-start gap-3 rounded-lg border border-l-4 border-line bg-surface py-2.5 pr-2 pl-3 shadow-pop',
              stripes[toast.tone ?? 'neutral'],
            )}
          >
            <div className="min-w-0 flex-1 py-0.5">
              <p className="text-sm font-medium text-fg">{toast.title}</p>
              {toast.description ? <p className="mt-0.5 text-[0.8125rem] text-fg-muted">{toast.description}</p> : null}
            </div>
            {toast.action ? (
              <Button
                size="sm"
                onClick={() => {
                  toast.action?.onAction()
                  dismiss(toast.id)
                }}
              >
                {toast.action.label}
              </Button>
            ) : null}
            <IconButton label="Dismiss notification" icon={<CloseIcon />} size="sm" onClick={() => dismiss(toast.id)} />
          </div>
        ))}
      </section>
    </ToastContext>
  )
}
