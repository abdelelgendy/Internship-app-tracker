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
/** Alt+N, the one shortcut that works anywhere, also while typing: it has a modifier (WCAG 2.1.4). */
const TOAST_SHORTCUT = 'Alt+N'

const stripes = {
  neutral: 'border-l-line-strong',
  success: 'border-l-success-ink',
  danger: 'border-l-danger-ink',
}

/** Ends a phrase with a period unless it already ends a sentence ("submit it.." reads badly). */
function sentence(text: string): string {
  const trimmed = text.trim()
  return /[.!?]$/.test(trimmed) ? trimmed : `${trimmed}.`
}

function announcementFor(options: ToastOptions): string {
  const text = options.description ? `${sentence(options.title)} ${sentence(options.description)}` : sentence(options.title)
  return options.action ? `${text} ${options.action.label} is available: press ${TOAST_SHORTCUT}.` : text
}

/**
 * Renders toasts in the corner and announces each one through a live region that is always in
 * the page; screen readers miss live regions that are inserted together with their text.
 *
 * A toast with an action (Undo) must be reachable by keyboard before it goes: Alt+N moves focus
 * to the newest one, a toast pauses while it is hovered or holds focus, and when it closes with
 * focus inside, focus goes back to where it came from instead of dropping to the page.
 */
export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastEntry[]>([])
  const [announcement, setAnnouncement] = useState({ polite: '', assertive: '' })
  const nextId = useRef(1)
  const region = useRef<HTMLElement>(null)
  // Where focus was before it moved into a toast, to return it there.
  const returnTo = useRef<HTMLElement | null>(null)

  const dismiss = useCallback((id: number) => {
    const holder = document.activeElement?.closest(`[data-toast-id="${id}"]`)
    if (holder) {
      const back = returnTo.current?.isConnected ? returnTo.current : document.getElementById('main')
      back?.focus({ preventScroll: true })
    }
    setToasts((current) => current.filter((toast) => toast.id !== id))
  }, [])

  const show = useCallback((options: ToastOptions) => {
    const id = nextId.current++
    setToasts((current) => [...current.slice(-(MAX_VISIBLE - 1)), { ...options, id }])
    const text = announcementFor(options)
    setAnnouncement(options.tone === 'danger' ? { polite: '', assertive: text } : { polite: text, assertive: '' })
    return id
  }, [])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (!event.altKey || event.ctrlKey || event.metaKey || event.code !== 'KeyN') return
      const newest = region.current?.querySelector<HTMLElement>('[data-toast-id]:last-of-type')
      const target = newest?.querySelector<HTMLElement>('[data-toast-action]') ?? newest?.querySelector<HTMLElement>('button')
      if (!target) return
      event.preventDefault()
      target.focus()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
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
        ref={region}
        aria-label="Notifications"
        onFocus={(event) => {
          const from = event.relatedTarget
          if (from instanceof HTMLElement && !event.currentTarget.contains(from)) returnTo.current = from
        }}
        className="pointer-events-none fixed inset-x-4 bottom-4 z-50 flex flex-col gap-2 md:right-6 md:bottom-6 md:left-auto md:w-[22rem]"
      >
        {toasts.map((toast) => (
          <ToastItem key={toast.id} toast={toast} onDismiss={dismiss} />
        ))}
      </section>
    </ToastContext>
  )
}

function ToastItem({ toast, onDismiss }: { toast: ToastEntry; onDismiss: (id: number) => void }) {
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const remaining = useRef(toast.durationMs ?? (toast.action ? 15_000 : 5_000))
  const paused = hovered || focused

  useEffect(() => {
    if (paused) return
    const started = Date.now()
    const timer = setTimeout(() => onDismiss(toast.id), remaining.current)
    return () => {
      clearTimeout(timer)
      remaining.current = Math.max(1_000, remaining.current - (Date.now() - started))
    }
  }, [paused, onDismiss, toast.id])

  return (
    <div
      data-toast-id={toast.id}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false)
      }}
      className={cx(
        'pointer-events-auto flex items-start gap-3 rounded-lg border border-l-4 border-line bg-surface py-2.5 pr-2 pl-3 shadow-pop',
        stripes[toast.tone ?? 'neutral'],
      )}
    >
      <div className="min-w-0 flex-1 py-0.5">
        <p className="text-sm font-medium text-fg">{toast.title}</p>
        {toast.description ? <p className="mt-0.5 text-[0.8125rem] break-words text-fg-muted">{toast.description}</p> : null}
      </div>
      {toast.action ? (
        <Button
          size="sm"
          data-toast-action
          aria-keyshortcuts="Alt+N"
          onClick={() => {
            toast.action?.onAction()
            onDismiss(toast.id)
          }}
        >
          {toast.action.label}
        </Button>
      ) : null}
      <IconButton label="Dismiss notification" icon={<CloseIcon />} size="sm" onClick={() => onDismiss(toast.id)} />
    </div>
  )
}
