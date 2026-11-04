import { cx } from './cx.ts'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
export type ButtonSize = 'sm' | 'md'

const buttonBase =
  'inline-flex shrink-0 items-center justify-center gap-1.5 rounded-md font-medium whitespace-nowrap select-none transition-colors disabled:cursor-not-allowed disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0'

const buttonVariants: Record<ButtonVariant, string> = {
  primary: 'bg-fg text-surface hover:bg-fg/85',
  secondary: 'border border-line-strong bg-surface text-fg hover:bg-surface-2',
  ghost: 'text-fg-muted hover:bg-surface-2 hover:text-fg aria-pressed:bg-surface-2 aria-pressed:text-fg',
  danger: 'bg-danger text-on-danger hover:bg-danger/90',
}

const buttonSizes: Record<ButtonSize, string> = {
  sm: 'h-8 px-2.5 text-[0.8125rem]',
  md: 'h-9 px-3.5 text-sm',
}

/** Button look for elements that are not a <Button>, such as a router <Link> or an external <a>. */
export function buttonClass({ variant = 'secondary', size = 'md' }: { variant?: ButtonVariant; size?: ButtonSize } = {}): string {
  return cx(buttonBase, buttonVariants[variant], buttonSizes[size])
}

/** Shared look for text inputs, textareas and selects. */
export const controlClass =
  'block w-full min-w-0 rounded-md border border-line-input bg-surface px-3 text-sm text-fg placeholder:text-fg-subtle transition-colors hover:border-fg-subtle disabled:cursor-not-allowed disabled:opacity-60 aria-invalid:border-danger [&[readonly]]:border-dashed [&[readonly]]:border-line [&[readonly]]:bg-transparent [&[readonly]]:hover:border-line'

/** A read-only value shown as text in the shape of a field: dashed, no fill, and it wraps. */
export const readOnlyValueClass = 'block w-full min-w-0 rounded-md border border-dashed border-line px-3 py-1.5 text-sm break-words text-fg'
