import { useState, type FormEvent } from 'react'
import { planImport, type ExistingData } from '../../../scripts/lib/jobhunter-map.ts'
import type { ImportPreview } from '@/data/import-middleware.ts'
import { useData } from '@/data/data-context.ts'
import { errorFrom, LOCAL_API_BASE, LOCAL_API_HEADER } from '@/data/localApi.ts'
import type { Repo } from '@/data/repo.ts'
import { Button } from '@/ui/Button.tsx'
import { Card, CardBody, CardHeader } from '@/ui/Card.tsx'
import { Field } from '@/ui/Field.tsx'
import { Input } from '@/ui/Input.tsx'
import { PageHeader } from '@/ui/PageHeader.tsx'
import { useToast } from '@/ui/toast-context.ts'
import { applyImportPlan, type ApplyChoices } from './applyImport.ts'
import { DEMO_FOLDER, DEMO_JOBHUNTER_SOURCE } from './demoJobHunter.ts'
import { ImportReport } from './ImportReport.tsx'

const FOLDER_KEY = 'shortlist:import-folder'
const DEFAULT_FOLDER = '../job-hunter'

type State =
  | { kind: 'idle' }
  | { kind: 'reading' }
  /** `run` counts previews, so each new one starts the report with fresh choices. */
  | { kind: 'ready'; preview: ImportPreview; run: number }
  | { kind: 'failed'; message: string }

function rememberedFolder(): string {
  try {
    return localStorage.getItem(FOLDER_KEY) ?? DEFAULT_FOLDER
  } catch {
    return DEFAULT_FOLDER
  }
}

async function readExisting(repo: Repo): Promise<ExistingData> {
  const [jobs, applications, profile, decks, exercises, stories, companies] = await Promise.all([
    repo.listJobs(),
    repo.listApplications(),
    repo.getProfile(),
    repo.listDecks(),
    repo.listExercises(),
    repo.listStories(),
    repo.listCompanies(),
  ])
  return { jobs, applications, profile, decks, exercises, stories, companies }
}

async function fetchPreview(folder: string): Promise<ImportPreview> {
  const response = await fetch(`${LOCAL_API_BASE}/import/preview?folder=${encodeURIComponent(folder)}`, { headers: { [LOCAL_API_HEADER]: '1' } })
  if (!response.ok) throw await errorFrom(response)
  return (await response.json()) as ImportPreview
}

export function ImportPage() {
  const { mode, repo } = useData()
  const toast = useToast()
  const [folder, setFolder] = useState(rememberedFolder)
  const [state, setState] = useState<State>({ kind: 'idle' })
  const [applying, setApplying] = useState(false)
  const [runs, setRuns] = useState(0)
  const local = mode.kind === 'local'

  function show(preview: ImportPreview) {
    setRuns((count) => count + 1)
    setState({ kind: 'ready', preview, run: runs + 1 })
  }

  async function preview(event?: FormEvent) {
    event?.preventDefault()
    setState({ kind: 'reading' })
    try {
      if (local) {
        try {
          localStorage.setItem(FOLDER_KEY, folder)
        } catch {
          // Blocked storage: the folder is simply not remembered.
        }
        show(await fetchPreview(folder))
      } else {
        const plan = planImport(DEMO_JOBHUNTER_SOURCE, await readExisting(repo), { now: new Date() })
        show({ folder: DEMO_FOLDER, plan })
      }
    } catch (error) {
      setState({ kind: 'failed', message: error instanceof Error ? error.message : String(error) })
    }
  }

  async function apply(previewed: ImportPreview, choices: ApplyChoices) {
    setApplying(true)
    try {
      const written = await applyImportPlan(previewed.plan, choices)
      toast.show({ title: 'Import applied', description: `Saved ${written.join(', ')}.`, tone: 'success' })
      show(await fetchPreview(previewed.folder))
    } catch (error) {
      toast.show({ title: "Couldn't apply the import", description: error instanceof Error ? error.message : String(error), tone: 'danger' })
    } finally {
      setApplying(false)
    }
  }

  return (
    <>
      <PageHeader
        title="Import"
        description="Bring in your job-hunter history, practice decks and profile. You see everything that would change before anything is written."
      />

      {local ? (
        <Card>
          <CardHeader title="Choose a folder" description="Shortlist only reads it. Nothing in job-hunter is changed." />
          <CardBody>
            <form onSubmit={preview} className="space-y-3">
              <Field
                className="max-w-2xl"
                label="job-hunter folder"
                hint="The job-hunter folder, which has data/ and copilot-data/ inside, or the copilot-data folder itself. A relative path starts at the Shortlist folder."
              >
                {(control) => (
                  <Input {...control} className="font-mono" spellCheck={false} autoComplete="off" value={folder} onChange={(event) => setFolder(event.target.value)} />
                )}
              </Field>
              <Button type="submit" variant="primary" disabled={state.kind === 'reading' || folder.trim() === ''}>
                {state.kind === 'reading' ? 'Reading…' : 'Preview import'}
              </Button>
            </form>
          </CardBody>
        </Card>
      ) : (
        <Card>
          <CardHeader title="Import works on your own computer" description="It reads a folder on disk, so it needs Shortlist running locally." />
          <CardBody className="space-y-3">
            <p className="text-fg-muted">
              Clone the repo, run <code className="rounded bg-surface-2 px-1 font-mono text-fg">npm run dev</code>, then point Import at your job-hunter folder. Here you can preview a demo import of
              Sam Rivera's old job-hunter files to see what the check finds.
            </p>
            <Button variant="primary" onClick={() => preview()} disabled={state.kind === 'reading'}>
              {state.kind === 'reading' ? 'Reading…' : 'Preview the demo import'}
            </Button>
          </CardBody>
        </Card>
      )}

      {state.kind === 'failed' ? (
        <p role="alert" className="mt-4 rounded-md border border-danger-ink/30 bg-danger-soft px-3 py-2.5 text-[0.8125rem] break-words text-danger-ink">
          {state.message}
        </p>
      ) : null}

      {state.kind === 'ready' ? (
        <ImportReport
          key={state.run}
          folder={state.preview.folder}
          plan={state.preview.plan}
          applyBlocked={local ? null : 'Apply is off in the demo: there is no folder on disk to write to.'}
          applying={applying}
          onApply={(choices) => apply(state.preview, choices)}
        />
      ) : null}
    </>
  )
}
