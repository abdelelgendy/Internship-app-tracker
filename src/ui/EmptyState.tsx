import type { ReactNode } from 'react'
import { cx } from './cx.ts'

export interface EmptyStateProps {
  /** Say what is missing, e.g. "No follow-ups due". */
  title: ReactNode
  /** Say what to do next. An empty screen is an invitation to act. */
  description?: ReactNode
  icon?: ReactNode
  /** Usually one Button or link that fills the space. */
  action?: ReactNode
  className?: string
}

export function EmptyState({ title, description, icon, action, className }: EmptyStateProps) {
  return (
    <div
      className={cx(
        'flex flex-col items-center rounded-lg border border-dashed border-line-strong px-6 py-10 text-center',
        className,
      )}
    >
      {icon ? (
        <div className="mb-3 flex size-10 items-center justify-center rounded-full bg-surface-2 text-fg-muted [&_svg]:size-5">{icon}</div>
      ) : null}
      <p className="text-sm font-semibold text-fg">{title}</p>
      {description ? <p className="mt-1 max-w-prose text-[0.8125rem] text-fg-muted">{description}</p> : null}
      {action ? <div className="mt-4">{action}</div> : null}
    </div>
  )
}
