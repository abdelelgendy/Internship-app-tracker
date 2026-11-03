import { useEffect, useEffectEvent } from 'react'
import { NAV_ITEMS } from './nav.ts'

/** How long after g the second key still counts, in milliseconds. */
const SEQUENCE_WINDOW_MS = 1500

function isTyping(target: EventTarget | null): boolean {
  return (
    target instanceof HTMLElement &&
    (target.isContentEditable || target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.tagName === 'SELECT')
  )
}

/**
 * App-wide shortcuts: g then a letter opens a page (see NAV_ITEMS), ? shows the list.
 * They stay out of the way while typing, while a dialog is open, and when a modifier is held.
 */
export function useKeyboardShortcuts({ onNavigate, onShowHelp }: { onNavigate: (to: string) => void; onShowHelp: () => void }) {
  const handleKeyDown = useEffectEvent((event: KeyboardEvent, goPressedAt: { current: number | null }) => {
    const pressedG = goPressedAt.current
    goPressedAt.current = null
    if (
      event.defaultPrevented ||
      event.repeat ||
      event.metaKey ||
      event.ctrlKey ||
      event.altKey ||
      isTyping(event.target) ||
      document.querySelector('dialog[open]')
    ) {
      return
    }
    if (pressedG !== null && event.timeStamp - pressedG <= SEQUENCE_WINDOW_MS) {
      const item = NAV_ITEMS.find((navItem) => navItem.shortcut === event.key.toLowerCase())
      if (item) {
        event.preventDefault()
        onNavigate(item.to)
      }
      return
    }
    if (event.key === '?') {
      event.preventDefault()
      onShowHelp()
    } else if (event.key === 'g') {
      goPressedAt.current = event.timeStamp
    }
  })

  useEffect(() => {
    const goPressedAt = { current: null as number | null }
    const listener = (event: KeyboardEvent) => handleKeyDown(event, goPressedAt)
    window.addEventListener('keydown', listener)
    return () => window.removeEventListener('keydown', listener)
  }, [])
}
