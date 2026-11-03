import { useEffect, useId, useRef, type KeyboardEvent, type MouseEvent, type ReactNode, type RefObject } from 'react'
import { cx } from './cx.ts'
import { getFocusable } from './focus.ts'
import { IconButton } from './IconButton.tsx'
import { CloseIcon } from './icons.tsx'

export interface DialogProps {
  open: boolean
  /** Called on Escape, the close button, or a click on the backdrop. Set open to false in response. */
  onClose: () => void
  title: ReactNode
  description?: ReactNode
  children?: ReactNode
  /** Actions row pinned below the scrolling content, right-aligned. Put the primary action last. */
  footer?: ReactNode
  /** Receives focus when the dialog opens. Defaults to the first focusable control in the content. */
  initialFocusRef?: RefObject<HTMLElement | null>
  size?: 'sm' | 'md' | 'lg'
  /** "sheet" slides from the left edge at full height, for navigation on small screens. */
  variant?: 'center' | 'sheet'
}

const widths = { sm: 'w-[min(26rem,calc(100vw-2rem))]', md: 'w-[min(34rem,calc(100vw-2rem))]', lg: 'w-[min(48rem,calc(100vw-2rem))]' }

/**
 * A modal built on the native <dialog>: showModal() puts it in the top layer and makes the page
 * behind it inert. Focus is also kept inside by hand, because Tab could otherwise reach the
 * browser chrome, and it returns to the control that opened the dialog when it closes.
 */
export function Dialog({
  open,
  onClose,
  title,
  description,
  children,
  footer,
  initialFocusRef,
  size = 'md',
  variant = 'center',
}: DialogProps) {
  const dialogRef = useRef<HTMLDialogElement>(null)
  const contentRef = useRef<HTMLDivElement>(null)
  const closeRef = useRef<HTMLButtonElement>(null)
  // Escape can arrive as a keydown and then as a native cancel event; report it once per opening.
  const closeRequested = useRef(false)
  const titleId = useId()
  const descriptionId = useId()

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog || !open) return
    const opener = document.activeElement instanceof HTMLElement ? document.activeElement : null
    closeRequested.current = false
    if (!dialog.open) dialog.showModal()
    const target = initialFocusRef?.current ?? (contentRef.current && getFocusable(contentRef.current)[0]) ?? closeRef.current
    target?.focus()
    return () => {
      if (dialog.open) dialog.close()
      if (opener?.isConnected) opener.focus()
    }
  }, [open, initialFocusRef])

  function requestClose() {
    if (closeRequested.current) return
    closeRequested.current = true
    onClose()
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDialogElement>) {
    if (event.key === 'Escape') {
      event.preventDefault()
      event.stopPropagation()
      requestClose()
      return
    }
    if (event.key !== 'Tab' || !dialogRef.current) return
    const focusable = getFocusable(dialogRef.current)
    if (focusable.length === 0) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    const active = document.activeElement
    if (event.shiftKey && (active === first || !dialogRef.current.contains(active))) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && active === last) {
      event.preventDefault()
      first.focus()
    }
  }

  function handleClick(event: MouseEvent<HTMLDialogElement>) {
    // The dialog element itself is only hit outside the panel, i.e. on the backdrop.
    if (event.target === event.currentTarget) requestClose()
  }

  if (!open) return null

  return (
    <dialog
      ref={dialogRef}
      aria-labelledby={titleId}
      aria-describedby={description ? descriptionId : undefined}
      onKeyDown={handleKeyDown}
      onClick={handleClick}
      onCancel={(event) => {
        event.preventDefault()
        requestClose()
      }}
      className={cx(
        'overflow-hidden border border-line bg-surface p-0 text-fg shadow-pop',
        variant === 'sheet'
          ? 'm-0 h-dvh max-h-dvh w-[min(20rem,85vw)] max-w-none rounded-r-lg border-l-0'
          : cx('m-auto max-h-[calc(100dvh-2rem)] max-w-none rounded-lg', widths[size]),
      )}
    >
      <div className={cx('flex flex-col', variant === 'sheet' ? 'h-full' : 'max-h-[calc(100dvh-2rem)]')}>
        <div className="flex shrink-0 items-start justify-between gap-3 px-4 pt-4 pb-2">
          <div className="min-w-0">
            <h2 id={titleId} className="text-base font-semibold text-fg">
              {title}
            </h2>
            {description ? (
              <p id={descriptionId} className="mt-0.5 text-[0.8125rem] text-fg-muted">
                {description}
              </p>
            ) : null}
          </div>
          <IconButton ref={closeRef} label="Close" icon={<CloseIcon />} size="sm" className="-mt-1 -mr-1" onClick={requestClose} />
        </div>
        <div ref={contentRef} className="flex min-h-0 flex-1 flex-col">
          <div className="min-h-0 flex-1 overflow-y-auto px-4 pt-2 pb-4">{children}</div>
          {footer ? <div className="flex shrink-0 flex-wrap justify-end gap-2 border-t border-line px-4 py-3">{footer}</div> : null}
        </div>
      </div>
    </dialog>
  )
}
