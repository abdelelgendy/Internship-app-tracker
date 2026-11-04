import { useState, type ReactNode } from 'react'
import { useShortcutsEnabled } from '@/app/shortcutsSetting.ts'
import { useTheme } from '@/app/useTheme.ts'
import type { ThemePreference } from '@/app/theme.ts'
import { useData } from '@/data/data-context.ts'
import type { DataMode } from '@/data/mode.ts'
import { Button } from '@/ui/Button.tsx'
import { Card, CardBody, CardHeader } from '@/ui/Card.tsx'
import { cx } from '@/ui/cx.ts'
import { ResetSampleDialog } from '@/app/ResetSampleDialog.tsx'
import { Kbd } from '@/ui/Kbd.tsx'
import { PageHeader } from '@/ui/PageHeader.tsx'
import { useToast } from '@/ui/toast-context.ts'
import { collectExport, exportFileName } from './exportData.ts'

function Code({ children }: { children: ReactNode }) {
  // break-words, not break-all: "npm run dev" wraps at its spaces, and only a long path breaks mid-word.
  return <code className="rounded bg-surface-2 px-1 py-px font-mono text-[0.8125rem] break-words text-fg">{children}</code>
}

export function SettingsPage() {
  const { mode } = useData()
  return (
    <>
      <PageHeader title="Settings" description="Where your data lives, how Shortlist looks, keyboard shortcuts, and a full export." />
      <div className="max-w-3xl space-y-4">
        {mode.kind === 'local' ? <LocalData dataDir={mode.dataDir} /> : <SampleData mode={mode} />}
        <Appearance />
        <Keyboard />
        <Export />
      </div>
    </>
  )
}

function LocalData({ dataDir }: { dataDir: string }) {
  return (
    <Card>
      <CardHeader title="Data folder" description="Everything you save is written here, on this computer, and nowhere else." />
      <CardBody className="space-y-3 text-fg-muted">
        <p className="font-mono text-[0.8125rem] break-all text-fg">{dataDir}</p>
        <p>
          To use another folder, set <Code>COPILOT_DATA_DIR</Code> in <Code>.env.local</Code> and restart <Code>npm run dev</Code>. A folder inside the repo must be
          ignored by git, or Shortlist refuses to open it.
        </p>
        <p>
          Turn on the commit guard once per clone with <Code>git config core.hooksPath .githooks</Code>. It blocks any commit that contains a line from{' '}
          <Code>denylist.txt</Code> in this folder.
        </p>
      </CardBody>
    </Card>
  )
}

function SampleData({ mode }: { mode: Extract<DataMode, { kind: 'sample' }> }) {
  const { resetSampleData } = useData()
  const [confirming, setConfirming] = useState(false)
  const kept = mode.storage === 'memory' ? "This browser can't keep changes, so they last until you reload." : 'Your changes stay in this browser and are never uploaded.'

  return (
    <Card>
      <CardHeader
        title="Sample data"
        description="You are looking at the demo: Sam Rivera is a fictional new grad."
        actions={
          resetSampleData ? (
            <Button size="sm" onClick={() => setConfirming(true)}>
              Reset sample data
            </Button>
          ) : null
        }
      />
      <CardBody className="space-y-2 text-fg-muted">
        <p>{kept}</p>
        <p>
          To use your own data, clone the repo and run <Code>npm run dev</Code>. It reads and writes a private folder on your computer.
        </p>
      </CardBody>
      <ResetSampleDialog open={confirming} onClose={() => setConfirming(false)} />
    </Card>
  )
}

const THEMES: readonly { value: ThemePreference; label: string; note: string }[] = [
  { value: 'system', label: 'Match the system', note: 'Light or dark, following your device.' },
  { value: 'light', label: 'Light', note: 'Always light.' },
  { value: 'dark', label: 'Dark', note: 'Always dark.' },
]

function Appearance() {
  const { preference, setPreference } = useTheme()
  return (
    <Card>
      <CardHeader title="Appearance" />
      <CardBody>
        <fieldset>
          <legend className="mb-2 text-[0.8125rem] font-medium text-fg">Theme</legend>
          <div className="grid gap-2 sm:grid-cols-3">
            {THEMES.map((theme) => (
              <label
                key={theme.value}
                className={cx(
                  'flex cursor-pointer items-start gap-2.5 rounded-md border px-3 py-2.5 transition-colors',
                  preference === theme.value ? 'border-fg bg-surface-2' : 'border-line hover:border-line-strong',
                )}
              >
                <input type="radio" name="theme" className="mt-0.5 size-4 shrink-0" checked={preference === theme.value} onChange={() => setPreference(theme.value)} />
                <span className="min-w-0 text-[0.8125rem]">
                  <span className="block font-medium text-fg">{theme.label}</span>
                  <span className="block text-fg-muted">{theme.note}</span>
                </span>
              </label>
            ))}
          </div>
        </fieldset>
      </CardBody>
    </Card>
  )
}

function Keyboard() {
  const [enabled, setEnabled] = useShortcutsEnabled()
  return (
    <Card>
      <CardHeader title="Keyboard shortcuts" />
      <CardBody>
        <label className="flex cursor-pointer items-start gap-2.5 text-[0.8125rem]">
          <input type="checkbox" className="mt-0.5 size-4 shrink-0" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
          <span className="min-w-0">
            <span className="block font-medium text-fg">Use single-key shortcuts</span>
            <span className="block text-fg-muted">
              <Kbd>g</Kbd> then a letter opens a page, <Kbd>?</Kbd> lists them, and <Kbd>1</Kbd> to <Kbd>4</Kbd> grade a practice card. Turn them off if you
              use speech input or press keys by accident. This is saved in this browser.
            </span>
          </span>
        </label>
      </CardBody>
    </Card>
  )
}

function Export() {
  const { mode, repo } = useData()
  const toast = useToast()
  const [busy, setBusy] = useState(false)

  async function download() {
    setBusy(true)
    try {
      const now = new Date()
      const bundle = await collectExport(repo, mode, now)
      const url = URL.createObjectURL(new Blob([`${JSON.stringify(bundle, null, 2)}\n`], { type: 'application/json' }))
      const link = document.createElement('a')
      link.href = url
      link.download = exportFileName(now)
      link.click()
      setTimeout(() => URL.revokeObjectURL(url), 1000)
      toast.show({ title: 'Export downloaded', description: link.download, tone: 'success' })
    } catch (error) {
      toast.show({ title: "Couldn't export", description: error instanceof Error ? error.message : String(error), tone: 'danger' })
    } finally {
      setBusy(false)
    }
  }

  return (
    <Card>
      <CardHeader
        title="Export"
        description="One JSON file with your profile, jobs, applications, watchlist, practice and cover letter drafts."
        actions={
          <Button variant="primary" size="sm" disabled={busy} onClick={download}>
            {busy ? 'Exporting…' : 'Download export'}
          </Button>
        }
      />
      <CardBody className="text-fg-muted">
        {mode.kind === 'local' ? (
          <p>It holds your personal details. Keep it somewhere private, and never commit it to a repo.</p>
        ) : (
          <p>The demo export leaves out self-identification answers, like the Profile page does.</p>
        )}
      </CardBody>
    </Card>
  )
}
