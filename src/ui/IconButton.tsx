import type { ComponentPropsWithRef, ReactNode } from 'react'
import { cx } from './cx.ts'
import type { ButtonVariant } from './styles.ts'

const variants: Record<Exclude<ButtonVariant, 'danger'>, string> = {
  primary: 'bg-fg text-surface hover:bg-fg/85',
  secondary: 'border border-line-strong bg-surface text-fg hover:bg-surface-2',
  ghost: 'text-fg-muted hover:bg-surface-2 hover:text-fg aria-pressed:bg-surface-2 aria-pressed:text-fg',
}

export interface IconButtonProps extends Omit<ComponentPropsWithRef<'button'>, 'aria-label' | 'children'> {
  /** What the button does, read by screen readers and shown as the tooltip. Required: the icon alone says nothing. */
  label: string
  icon: ReactNode
  variant?: Exclude<ButtonVariant, 'danger'>
  size?: 'sm' | 'md'
}

export function IconButton({ label, icon, variant = 'ghost', size = 'md', type = 'button', className, ...props }: IconButtonProps) {
  return (
    <button
      type={type}
      aria-label={label}
      title={label}
      className={cx(
        'inline-flex shrink-0 items-center justify-center rounded-md transition-colors disabled:cursor-not-allowed disabled:opacity-50 [&_svg]:size-4',
        size === 'sm' ? 'size-8' : 'size-9',
        variants[variant],
        className,
      )}
      {...props}
    >
      {icon}
    </button>
  )
}
