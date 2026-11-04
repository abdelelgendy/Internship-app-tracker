export type ThemePreference = 'system' | 'light' | 'dark'
export type Theme = 'light' | 'dark'

// index.html reads the same key before first paint; change both together.
const STORAGE_KEY = 'shortlist:theme'
const DARK_QUERY = '(prefers-color-scheme: dark)'

interface ThemeState {
  preference: ThemePreference
  theme: Theme
}

// Used when storage is blocked (some private windows): the choice then lasts until a reload.
let unsavedPreference: ThemePreference = 'system'

function readPreference(): ThemePreference {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    return saved === 'light' || saved === 'dark' ? saved : 'system'
  } catch {
    return unsavedPreference
  }
}

function darkQuery(): MediaQueryList | null {
  return typeof window.matchMedia === 'function' ? window.matchMedia(DARK_QUERY) : null
}

function compute(): ThemeState {
  const preference = readPreference()
  const theme = preference === 'system' ? (darkQuery()?.matches ? 'dark' : 'light') : preference
  return { preference, theme }
}

let state: ThemeState | null = null
const listeners = new Set<() => void>()

export function getThemeState(): ThemeState {
  state ??= compute()
  return state
}

// The --bg of each theme in src/index.css, for the phone's browser bar. index.html sets it before first paint.
const THEME_COLORS: Record<Theme, string> = { light: '#f4f4f0', dark: '#1a1b18' }

function refresh() {
  const next = compute()
  document.documentElement.dataset.theme = next.theme
  document.querySelector<HTMLMetaElement>('meta[name="theme-color"]')?.setAttribute('content', THEME_COLORS[next.theme])
  if (state && next.preference === state.preference && next.theme === state.theme) return
  state = next
  listeners.forEach((listener) => listener())
}

function onStorage(event: StorageEvent) {
  if (event.key === STORAGE_KEY) refresh()
}

/** For useSyncExternalStore. Follows the system setting and changes made in other tabs. */
export function subscribeTheme(listener: () => void): () => void {
  if (listeners.size === 0) {
    darkQuery()?.addEventListener('change', refresh)
    window.addEventListener('storage', onStorage)
  }
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
    if (listeners.size === 0) {
      darkQuery()?.removeEventListener('change', refresh)
      window.removeEventListener('storage', onStorage)
    }
  }
}

export function setThemePreference(preference: ThemePreference) {
  unsavedPreference = preference
  try {
    if (preference === 'system') localStorage.removeItem(STORAGE_KEY)
    else localStorage.setItem(STORAGE_KEY, preference)
  } catch {
    // Blocked storage: readPreference falls back to unsavedPreference.
  }
  refresh()
}
