import type { ReactNode } from 'react'

/**
 * Icons used by the pipeline pages, drawn on the same 24px grid and stroke as src/ui/icons.tsx.
 * Decorative: the text or label next to each one carries the meaning.
 */
function Icon({ className = 'size-4', children }: { className?: string; children: ReactNode }) {
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

export function PlusIcon({ className }: { className?: string }) {
  return (
    <Icon className={className}>
      <path d="M12 5v14M5 12h14" />
    </Icon>
  )
}

export function ExternalIcon({ className }: { className?: string }) {
  return (
    <Icon className={className}>
      <path d="M14 4h6v6M20 4l-9 9M18 14v4.5a1.5 1.5 0 0 1-1.5 1.5h-11A1.5 1.5 0 0 1 4 18.5v-11A1.5 1.5 0 0 1 5.5 6H10" />
    </Icon>
  )
}

export function CopyIcon({ className }: { className?: string }) {
  return (
    <Icon className={className}>
      <rect x="8.5" y="8.5" width="11.5" height="11.5" rx="2" />
      <path d="M15.5 8.5V5.5A1.5 1.5 0 0 0 14 4H5.5A1.5 1.5 0 0 0 4 5.5V14a1.5 1.5 0 0 0 1.5 1.5h3" />
    </Icon>
  )
}

export function CheckIcon({ className }: { className?: string }) {
  return (
    <Icon className={className}>
      <path d="m5 12.5 4.5 4.5L19 7.5" />
    </Icon>
  )
}

export function GripIcon({ className }: { className?: string }) {
  return (
    <Icon className={className}>
      <circle cx="9" cy="6.5" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="15" cy="6.5" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="9" cy="12" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="15" cy="12" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="9" cy="17.5" r="1.1" fill="currentColor" stroke="none" />
      <circle cx="15" cy="17.5" r="1.1" fill="currentColor" stroke="none" />
    </Icon>
  )
}

export function SortIcon({ direction, className }: { direction: 'ascending' | 'descending' | 'none'; className?: string }) {
  return (
    <Icon className={className}>
      {direction === 'none' ? <path d="m8 9 4-4 4 4M8 15l4 4 4-4" opacity={0.5} /> : null}
      {direction === 'ascending' ? <path d="m7 14 5-5 5 5" /> : null}
      {direction === 'descending' ? <path d="m7 10 5 5 5-5" /> : null}
    </Icon>
  )
}

export function SparkIcon({ className }: { className?: string }) {
  return (
    <Icon className={className}>
      <path d="M12 3.5 13.6 9a2 2 0 0 0 1.4 1.4l5.5 1.6-5.5 1.6a2 2 0 0 0-1.4 1.4L12 20.5 10.4 15A2 2 0 0 0 9 13.6L3.5 12 9 10.4A2 2 0 0 0 10.4 9Z" />
    </Icon>
  )
}
