import { useSyncExternalStore } from 'react'
import { getThemeState, setThemePreference, subscribeTheme } from './theme.ts'

/** The saved preference ("system" follows the OS), the theme in effect, and a setter. */
export function useTheme() {
  const { preference, theme } = useSyncExternalStore(subscribeTheme, getThemeState, getThemeState)
  return { preference, theme, setPreference: setThemePreference }
}
