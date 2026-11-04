import type { ComponentPropsWithRef } from 'react'
import { cx } from './cx.ts'
import { controlClass } from './styles.ts'

export interface TextareaProps extends ComponentPropsWithRef<'textarea'> {
  /**
   * Starts one line high and grows with its text (field-sizing where the browser has it, else
   * a row count from the length), for a short value that must never be cut off.
   */
  autoGrow?: boolean
}

export function Textarea({ rows = 4, autoGrow = false, className, ...props }: TextareaProps) {
  if (autoGrow) {
    const length = String(props.value ?? '').length
    return (
      <textarea
        rows={Math.max(1, Math.min(6, Math.ceil(length / 34)))}
        className={cx(controlClass, 'min-h-9 resize-none py-1.5 leading-relaxed [field-sizing:content]', className)}
        {...props}
      />
    )
  }
  return <textarea rows={rows} className={cx(controlClass, 'min-h-20 resize-y py-2 leading-relaxed', className)} {...props} />
}
