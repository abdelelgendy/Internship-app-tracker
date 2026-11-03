import type { ComponentPropsWithRef } from 'react'
import { cx } from './cx.ts'
import { controlClass } from './styles.ts'

export function Textarea({ rows = 4, className, ...props }: ComponentPropsWithRef<'textarea'>) {
  return <textarea rows={rows} className={cx(controlClass, 'min-h-20 resize-y py-2 leading-relaxed', className)} {...props} />
}
