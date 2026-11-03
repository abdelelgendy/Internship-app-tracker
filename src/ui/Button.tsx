import type { ComponentPropsWithRef } from 'react'
import { cx } from './cx.ts'
import { buttonClass, type ButtonSize, type ButtonVariant } from './styles.ts'

export interface ButtonProps extends ComponentPropsWithRef<'button'> {
  variant?: ButtonVariant
  size?: ButtonSize
}

/** Defaults to type="button" so a button inside a form never submits it by accident. */
export function Button({ variant = 'secondary', size = 'md', type = 'button', className, ...props }: ButtonProps) {
  return <button type={type} className={cx(buttonClass({ variant, size }), className)} {...props} />
}
