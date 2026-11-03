import { useId, type ReactNode } from 'react'

/** Props a Field hands to its control so the label, hint and error are announced with it. */
export interface FieldControlProps {
  id: string
  'aria-describedby'?: string
  'aria-invalid'?: true
}

export interface FieldProps {
  label: ReactNode
  hint?: ReactNode
  /** Shown in place of the hint and marks the control invalid. Say what is wrong and how to fix it. */
  error?: ReactNode
  /** Render the control with the props, e.g. {(control) => <Input {...control} value={v} onChange={...} />} */
  children: (control: FieldControlProps) => ReactNode
  className?: string
}

export function Field({ label, hint, error, children, className }: FieldProps) {
  const id = useId()
  const noteId = `${id}-note`
  const note = error ?? hint
  return (
    <div className={className}>
      <label htmlFor={id} className="mb-1 block text-[0.8125rem] font-medium text-fg">
        {label}
      </label>
      {children({
        id,
        'aria-describedby': note ? noteId : undefined,
        'aria-invalid': error ? true : undefined,
      })}
      {note ? (
        <p id={noteId} className={error ? 'mt-1 text-xs text-danger-ink' : 'mt-1 text-xs text-fg-muted'}>
          {note}
        </p>
      ) : null}
    </div>
  )
}
