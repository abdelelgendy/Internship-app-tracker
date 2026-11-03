import type { ReactNode } from 'react'

export interface PageHeaderProps {
  /** Also sets the browser tab title, "<title> · Shortlist". */
  title: string
  description?: ReactNode
  /** The page's main actions, right of the title on wide screens and below it on phones. */
  actions?: ReactNode
}

export function PageHeader({ title, description, actions }: PageHeaderProps) {
  return (
    <header className="mb-6 flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
      <title>{`${title} · Shortlist`}</title>
      <div className="min-w-0">
        {/* The shell moves focus here after each navigation so screen readers announce the new page. */}
        <h1 tabIndex={-1} className="text-xl font-semibold tracking-tight text-fg outline-none">
          {title}
        </h1>
        {description ? <p className="mt-1 max-w-prose text-fg-muted">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </header>
  )
}
