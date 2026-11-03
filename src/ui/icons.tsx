import type { ReactNode } from 'react'

/**
 * Inline stroke icons (24px grid). They are decorative: the control or text next to them carries
 * the meaning, so they are hidden from assistive tech.
 */
interface IconProps {
  className?: string
}

function Icon({ className = 'size-4', children }: IconProps & { children: ReactNode }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.75}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      className={className}
    >
      {children}
    </svg>
  )
}

export function TodayIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="3.5" y="5" width="17" height="15" rx="2" />
      <path d="M3.5 10h17M8 3v4M16 3v4" />
      <circle cx="12" cy="15" r="1.4" fill="currentColor" stroke="none" />
    </Icon>
  )
}

export function JobsIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="3" y="7" width="18" height="13" rx="2" />
      <path d="M9 7V5.5A1.5 1.5 0 0 1 10.5 4h3A1.5 1.5 0 0 1 15 5.5V7M3 12.5h18" />
    </Icon>
  )
}

export function BoardIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="3.5" y="4" width="4.5" height="13" rx="1.2" />
      <rect x="9.75" y="4" width="4.5" height="9" rx="1.2" />
      <rect x="16" y="4" width="4.5" height="16" rx="1.2" />
    </Icon>
  )
}

export function PracticeIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="3.5" y="7" width="13" height="13" rx="2" />
      <path d="M7.5 3.5h11a2 2 0 0 1 2 2v11" />
    </Icon>
  )
}

export function InsightsIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 20h16M7.5 16.5v-5M12 16.5V6M16.5 16.5v-8" />
    </Icon>
  )
}

export function ProfileIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="8.5" r="3.5" />
      <path d="M5 20c.8-3.6 3.6-5.5 7-5.5s6.2 1.9 7 5.5" />
    </Icon>
  )
}

export function ImportIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M12 3.5v11M7.5 10l4.5 4.5 4.5-4.5M4 15.5V19a1.5 1.5 0 0 0 1.5 1.5h13A1.5 1.5 0 0 0 20 19v-3.5" />
    </Icon>
  )
}

export function SettingsIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 7h9.5M18.5 7H20M4 17h3.5M12.5 17H20" />
      <circle cx="16" cy="7" r="2.5" />
      <circle cx="10" cy="17" r="2.5" />
    </Icon>
  )
}

export function MenuIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M4 7h16M4 12h16M4 17h16" />
    </Icon>
  )
}

export function CloseIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M6 6l12 12M18 6 6 18" />
    </Icon>
  )
}

export function SunIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <circle cx="12" cy="12" r="4" />
      <path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M5.3 18.7l1.4-1.4M17.3 6.7l1.4-1.4" />
    </Icon>
  )
}

export function MoonIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M19.5 14.6A7.5 7.5 0 0 1 9.4 4.5a7.5 7.5 0 1 0 10.1 10.1z" />
    </Icon>
  )
}

export function KeyboardIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <rect x="2.5" y="6" width="19" height="12" rx="2" />
      <path d="M6.5 10h.01M10 10h.01M13.5 10h.01M17 10h.01M7.5 14h9" />
    </Icon>
  )
}

export function ChevronDownIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="m6.5 9.5 5.5 5.5 5.5-5.5" />
    </Icon>
  )
}

export function AlertIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M10.3 4.3 2.9 17.5A2 2 0 0 0 4.6 20.5h14.8a2 2 0 0 0 1.7-3L13.7 4.3a2 2 0 0 0-3.4 0z" />
      <path d="M12 9.5v4M12 17h.01" />
    </Icon>
  )
}

/** The Shortlist mark: a highlighter swipe with a check, the way you pick a posting off a list. */
export function LogoMark({ className = 'size-6' }: IconProps) {
  return (
    <svg viewBox="0 0 32 32" aria-hidden="true" focusable="false" className={className}>
      <path
        d="M3.2 10.6c0-1 .7-1.8 1.7-1.9L27 6.6c1.1-.1 2 .7 2.1 1.8l.6 13.5c0 1-.7 1.9-1.7 2L5.1 25.4c-1.1.1-2-.7-2-1.8z"
        fill="var(--accent)"
      />
      <path
        d="m9.6 16.4 4.6 4.3 8.6-10"
        fill="none"
        stroke="var(--on-accent)"
        strokeWidth={3.2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
