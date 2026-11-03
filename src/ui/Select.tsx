import type { ComponentPropsWithRef } from 'react'
import { cx } from './cx.ts'
import { ChevronDownIcon } from './icons.tsx'
import { controlClass } from './styles.ts'

export interface SelectProps extends Omit<ComponentPropsWithRef<'select'>, 'size'> {
  size?: 'sm' | 'md'
}

/** A native select, so keyboard and screen reader behaviour come from the platform. */
export function Select({ size = 'md', className, children, ...props }: SelectProps) {
  return (
    <span className={cx('relative block min-w-0', className)}>
      <select className={cx(controlClass, 'appearance-none pr-8', size === 'sm' ? 'h-8' : 'h-9')} {...props}>
        {children}
      </select>
      <ChevronDownIcon className="pointer-events-none absolute top-1/2 right-2.5 size-4 -translate-y-1/2 text-fg-muted" />
    </span>
  )
}
