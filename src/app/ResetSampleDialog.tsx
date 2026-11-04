import { useState } from 'react'
import { useData } from '../data/data-context.ts'
import { Button } from '../ui/Button.tsx'
import { Dialog } from '../ui/Dialog.tsx'
import { useToast } from '../ui/toast-context.ts'

/** The confirmation before the demo goes back to the bundled sample data. The banner and Settings both open it. */
export function ResetSampleDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { resetSampleData } = useData()
  const toast = useToast()
  const [busy, setBusy] = useState(false)

  async function confirm() {
    if (!resetSampleData) return
    setBusy(true)
    try {
      await resetSampleData()
      onClose()
      toast.show({ title: 'Sample data reset', tone: 'success' })
    } catch (error) {
      toast.show({ title: "Couldn't reset sample data", description: error instanceof Error ? error.message : String(error), tone: 'danger' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      size="sm"
      title="Reset sample data?"
      description="Everything you changed in this demo goes back to the original sample data. Only this browser is affected."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="danger" disabled={busy} onClick={confirm}>
            Reset sample data
          </Button>
        </>
      }
    />
  )
}
