import type { ReactNode } from 'react'
import { cx } from './cx.ts'

/** One key, drawn as a keycap. */
export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <kbd
      className={cx(
        'inline-flex h-5 min-w-5 items-center justify-center rounded border border-b-2 border-line-strong bg-surface px-1 font-mono text-[0.6875rem] leading-none font-medium text-fg-muted',
        className,
      )}
    >
      {children}
    </kbd>
  )
}

/** A key sequence pressed one after another, such as g then t. */
export function KeySequence({ keys, className }: { keys: string[]; className?: string }) {
  return (
    <span className={cx('inline-flex items-center gap-1', className)}>
      {keys.map((key, index) => (
        <span key={index} className="inline-flex items-center gap-1">
          {index > 0 ? <span className="text-[0.6875rem] text-fg-subtle">then</span> : null}
          <Kbd>{key}</Kbd>
        </span>
      ))}
    </span>
  )
}
