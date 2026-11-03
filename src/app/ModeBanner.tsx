import { useState } from 'react'
import { useData } from '../data/data-context.ts'
import type { DataMode } from '../data/mode.ts'
import { Button } from '../ui/Button.tsx'
import { Dialog } from '../ui/Dialog.tsx'
import { useToast } from '../ui/toast-context.ts'

const STORAGE_NOTE = {
  browser: 'Your changes stay in this browser.',
  memory: "This browser can't keep changes, so they last until you reload.",
}

function ResetSampleData({ reset }: { reset: () => Promise<void> }) {
  const toast = useToast()
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)

  async function confirm() {
    setBusy(true)
    try {
      await reset()
      setConfirming(false)
      toast.show({ title: 'Sample data reset', tone: 'success' })
    } catch (error) {
      toast.show({
        title: "Couldn't reset sample data",
        description: error instanceof Error ? error.message : String(error),
        tone: 'danger',
      })
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <button
        type="button"
        // The padding makes a 24px tap target; the negative margin keeps the banner's height.
        className="-my-1 rounded-sm py-1 font-medium text-fg underline underline-offset-2 hover:text-fg-muted"
        onClick={() => setConfirming(true)}
      >
        Reset sample data
      </button>
      <Dialog
        open={confirming}
        onClose={() => setConfirming(false)}
        size="sm"
        title="Reset sample data?"
        description="Everything you changed in this demo goes back to the original sample data. Only this browser is affected."
        footer={
          <>
            <Button onClick={() => setConfirming(false)}>Cancel</Button>
            <Button variant="danger" disabled={busy} onClick={confirm}>
              Reset sample data
            </Button>
          </>
        }
      />
    </>
  )
}

function SampleBanner({ mode }: { mode: Extract<DataMode, { kind: 'sample' }> }) {
  const { resetSampleData } = useData()
  return (
    <div className="border-b border-line bg-accent-soft px-4 py-1.5 text-xs text-fg md:px-8">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p>
          <strong className="font-semibold">Sample data</strong>
          <span className="text-fg-muted">
            {' '}
            · Sam Rivera is a fictional new grad. Nothing here is a real application.
            {mode.storage ? ` ${STORAGE_NOTE[mode.storage]}` : null}
          </span>
        </p>
        {resetSampleData ? <ResetSampleData reset={resetSampleData} /> : null}
      </div>
      {mode.notice ? <p className="mt-1 font-medium text-warn-ink">{mode.notice}</p> : null}
    </div>
  )
}

export function ModeBanner({ mode }: { mode: DataMode }) {
  if (mode.kind === 'sample') return <SampleBanner mode={mode} />
  return (
    <div className="border-b border-line bg-surface-2 px-4 py-1.5 text-xs text-fg-muted md:px-8">
      <p>
        <strong className="font-semibold text-fg">Local data:</strong> <span className="font-mono break-all">{mode.dataDir}</span>
      </p>
    </div>
  )
}
