import { useState } from 'react'
import { useData } from '../data/data-context.ts'
import type { DataMode } from '../data/mode.ts'
import { ResetSampleDialog } from './ResetSampleDialog.tsx'

const STORAGE_NOTE = {
  browser: 'Your changes stay in this browser.',
  memory: "This browser can't keep changes, so they last until you reload.",
}

function ResetSampleData() {
  const [confirming, setConfirming] = useState(false)
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
      <ResetSampleDialog open={confirming} onClose={() => setConfirming(false)} />
    </>
  )
}

function SampleBanner({ mode }: { mode: Extract<DataMode, { kind: 'sample' }> }) {
  const { resetSampleData } = useData()
  return (
    <aside aria-label="Data source" className="border-b border-line bg-accent-soft px-4 py-1.5 text-xs text-fg md:px-8">
      <div className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p>
          <strong className="font-semibold">Sample data</strong>
          <span className="text-fg-muted">
            {' '}
            · Sam Rivera is a fictional new grad. Nothing here is a real application.
            {mode.storage ? ` ${STORAGE_NOTE[mode.storage]}` : null}
          </span>
        </p>
        {resetSampleData ? <ResetSampleData /> : null}
      </div>
      {mode.notice ? <p className="mt-1 font-medium text-warn-ink">{mode.notice}</p> : null}
    </aside>
  )
}

/** The data-source banner. An <aside> landmark, so screen readers never find it outside every landmark. */
export function ModeBanner({ mode }: { mode: DataMode }) {
  if (mode.kind === 'sample') return <SampleBanner mode={mode} />
  return (
    <aside aria-label="Data source" className="border-b border-line bg-surface-2 px-4 py-1.5 text-xs text-fg-muted md:px-8">
      <p>
        <strong className="font-semibold text-fg">Local data:</strong> <span className="font-mono break-all">{mode.dataDir}</span>
      </p>
    </aside>
  )
}
