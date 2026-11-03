import { Button } from '../ui/Button.tsx'
import { IconButton } from '../ui/IconButton.tsx'
import { MoonIcon, SunIcon } from '../ui/icons.tsx'
import { useTheme } from './useTheme.ts'

/** Flips between light and dark. Settings is where "match the system" lives. */
export function ThemeToggle({ compact = false }: { compact?: boolean }) {
  const { theme, setPreference } = useTheme()
  const next = theme === 'dark' ? 'light' : 'dark'
  const icon = next === 'dark' ? <MoonIcon /> : <SunIcon />
  const label = `Use ${next} theme`
  if (compact) return <IconButton label={label} icon={icon} onClick={() => setPreference(next)} />
  return (
    <Button variant="ghost" size="sm" className="w-full justify-start" onClick={() => setPreference(next)}>
      {icon}
      {label}
    </Button>
  )
}
