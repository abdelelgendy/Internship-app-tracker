import { useSyncExternalStore } from 'react'

/**
 * Whether the single-key shortcuts (g then a letter, ?, and 1 to 4 on a practice card) are on.
 * WCAG 2.1.4: a person using speech input, or one who presses keys by accident, must be able to
 * turn them off. Kept per browser; on by default.
 */
const STORAGE_KEY = 'shortlist:shortcuts'
const listeners = new Set<() => void>()
// Used when storage is blocked (some private windows): the choice then lasts until a reload.
let unsaved = true

export function shortcutsEnabled(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== 'off'
  } catch {
    return unsaved
  }
}

export function setShortcutsEnabled(enabled: boolean) {
  unsaved = enabled
  try {
    if (enabled) localStorage.removeItem(STORAGE_KEY)
    else localStorage.setItem(STORAGE_KEY, 'off')
  } catch {
    // Blocked storage: shortcutsEnabled falls back to `unsaved`.
  }
  listeners.forEach((listener) => listener())
}

function subscribe(listener: () => void): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === STORAGE_KEY) listener()
  }
  listeners.add(listener)
  window.addEventListener('storage', onStorage)
  return () => {
    listeners.delete(listener)
    window.removeEventListener('storage', onStorage)
  }
}

export function useShortcutsEnabled(): [boolean, (enabled: boolean) => void] {
  return [useSyncExternalStore(subscribe, shortcutsEnabled, shortcutsEnabled), setShortcutsEnabled]
}
