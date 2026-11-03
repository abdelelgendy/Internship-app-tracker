import { createContext, useContext } from 'react'

export interface ToastOptions {
  /** Past tense for a finished action, named like the control that did it: "Saved", "Moved to Applied". */
  title: string
  description?: string
  tone?: 'neutral' | 'success' | 'danger'
  /** One follow-up, such as Undo. Toasts with an action stay up longer. */
  action?: { label: string; onAction: () => void }
  durationMs?: number
}

export interface ToastApi {
  show: (options: ToastOptions) => number
  dismiss: (id: number) => void
}

export const ToastContext = createContext<ToastApi | null>(null)

export function useToast(): ToastApi {
  const api = useContext(ToastContext)
  if (!api) throw new Error('useToast needs a <ToastProvider> above it (App.tsx renders one).')
  return api
}
