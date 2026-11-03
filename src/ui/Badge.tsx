import type { ReactNode } from 'react'
import type { AppStatus, QueueStatus } from '../engine/types.ts'
import { cx } from './cx.ts'
import { APP_STATUS_DISPLAY, QUEUE_STATUS_DISPLAY, type BadgeTone } from './status.ts'

const tones: Record<BadgeTone, string> = {
  neutral: 'bg-neutral-soft text-neutral-ink',
  info: 'bg-info-soft text-info-ink',
  warn: 'bg-warn-soft text-warn-ink',
  violet: 'bg-violet-soft text-violet-ink',
  success: 'bg-success-soft text-success-ink',
  danger: 'bg-danger-soft text-danger-ink',
  muted: 'bg-muted-soft text-muted-ink',
  accent: 'bg-accent text-on-accent',
}

export function Badge({ tone = 'neutral', className, children }: { tone?: BadgeTone; className?: string; children: ReactNode }) {
  return (
    <span
      className={cx(
        'inline-flex h-5 shrink-0 items-center rounded px-1.5 text-xs leading-none font-medium whitespace-nowrap',
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  )
}

export function AppStatusBadge({ status }: { status: AppStatus }) {
  const { label, tone } = APP_STATUS_DISPLAY[status]
  return <Badge tone={tone}>{label}</Badge>
}

export function QueueStatusBadge({ status }: { status: QueueStatus }) {
  const { label, tone } = QUEUE_STATUS_DISPLAY[status]
  return <Badge tone={tone}>{label}</Badge>
}
