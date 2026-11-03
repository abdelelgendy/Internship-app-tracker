import type { ComponentPropsWithRef } from 'react'
import { cx } from './cx.ts'
import { controlClass } from './styles.ts'

export interface InputProps extends Omit<ComponentPropsWithRef<'input'>, 'size'> {
  size?: 'sm' | 'md'
}

export function Input({ size = 'md', type = 'text', className, ...props }: InputProps) {
  return <input type={type} className={cx(controlClass, size === 'sm' ? 'h-8' : 'h-9', className)} {...props} />
}
