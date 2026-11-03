import type { ComponentPropsWithRef, ReactNode } from 'react'
import { cx } from './cx.ts'

export function Card({ className, ...props }: ComponentPropsWithRef<'div'>) {
  return <div className={cx('min-w-0 rounded-lg border border-line bg-surface', className)} {...props} />
}

export interface CardHeaderProps {
  title: ReactNode
  description?: ReactNode
  /** Buttons or links on the right; they wrap below the title on narrow screens. */
  actions?: ReactNode
  /** Pick the level that fits the page outline; cards on a page are usually h2. */
  headingLevel?: 'h2' | 'h3' | 'h4'
}

export function CardHeader({ title, description, actions, headingLevel: Heading = 'h2' }: CardHeaderProps) {
  return (
    <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2 border-b border-line px-4 py-3">
      <div className="min-w-0">
        <Heading className="text-sm font-semibold text-fg">{title}</Heading>
        {description ? <p className="mt-0.5 text-[0.8125rem] text-fg-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex shrink-0 flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  )
}

export function CardBody({ className, ...props }: ComponentPropsWithRef<'div'>) {
  return <div className={cx('p-4', className)} {...props} />
}
