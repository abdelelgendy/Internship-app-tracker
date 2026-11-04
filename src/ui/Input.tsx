import type { ComponentPropsWithRef } from 'react'
import { cx } from './cx.ts'
import { controlClass, readOnlyValueClass } from './styles.ts'

export interface InputProps extends Omit<ComponentPropsWithRef<'input'>, 'size'> {
  size?: 'sm' | 'md'
}

/**
 * A text field. Read-only, it renders its value as text instead: a box that looks editable but
 * ignores typing misleads, and a long value (a URL on a phone) is cut off inside an input.
 */
export function Input({ size = 'md', type = 'text', className, readOnly, ...props }: InputProps) {
  if (readOnly) {
    const value = String(props.value ?? props.defaultValue ?? '')
    return (
      <p id={props.id} aria-describedby={props['aria-describedby']} className={cx(readOnlyValueClass, size === 'sm' ? 'min-h-8' : 'min-h-9', className)}>
        {value || <span className="text-fg-subtle">Not set</span>}
      </p>
    )
  }
  return <input type={type} className={cx(controlClass, size === 'sm' ? 'h-8' : 'h-9', className)} {...props} />
}
