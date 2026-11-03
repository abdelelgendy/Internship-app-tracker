import type { ComponentType } from 'react'
import {
  BoardIcon,
  ImportIcon,
  InsightsIcon,
  JobsIcon,
  PracticeIcon,
  ProfileIcon,
  SettingsIcon,
  TodayIcon,
} from '../ui/icons.tsx'

export interface NavItem {
  to: string
  label: string
  /** Pressed after g to jump here, e.g. g then t opens Today. */
  shortcut: string
  icon: ComponentType<{ className?: string }>
  /** "work" is the daily loop; "setup" is visited now and then. */
  group: 'work' | 'setup'
}

export const NAV_ITEMS: NavItem[] = [
  { to: '/today', label: 'Today', shortcut: 't', icon: TodayIcon, group: 'work' },
  { to: '/jobs', label: 'Jobs', shortcut: 'j', icon: JobsIcon, group: 'work' },
  { to: '/board', label: 'Board', shortcut: 'b', icon: BoardIcon, group: 'work' },
  { to: '/practice', label: 'Practice', shortcut: 'p', icon: PracticeIcon, group: 'work' },
  { to: '/insights', label: 'Insights', shortcut: 'i', icon: InsightsIcon, group: 'work' },
  { to: '/profile', label: 'Profile', shortcut: 'o', icon: ProfileIcon, group: 'setup' },
  { to: '/import', label: 'Import', shortcut: 'm', icon: ImportIcon, group: 'setup' },
  { to: '/settings', label: 'Settings', shortcut: 's', icon: SettingsIcon, group: 'setup' },
]
