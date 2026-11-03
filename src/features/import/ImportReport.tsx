import { useId, useState, type ReactNode } from 'react'
import { planHasChanges, type Finding, type ImportPlan } from '../../../scripts/lib/jobhunter-map.ts'
import { APP_STATUS_DISPLAY, QUEUE_STATUS_DISPLAY } from '@/ui/status.ts'
import { Badge } from '@/ui/Badge.tsx'
import { Button } from '@/ui/Button.tsx'
import { Card, CardBody, CardHeader } from '@/ui/Card.tsx'
import { cx } from '@/ui/cx.ts'
import type { AppStatus, QueueStatus } from '@/engine/types.ts'
import type { ApplyChoices } from './applyImport.ts'

export interface ImportReportProps {
  folder: string
  plan: ImportPlan
  /** Why Apply is unavailable, e.g. in the demo. Null when it can run. */
  applyBlocked: string | null
  applying: boolean
  onApply: (choices: ApplyChoices) => void
}

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`
}

function statusLabel(domain: 'queue' | 'application', status: string): string {
  return domain === 'queue' ? QUEUE_STATUS_DISPLAY[status as QueueStatus].label : APP_STATUS_DISPLAY[status as AppStatus].label
}

export function ImportReport({ folder, plan, applyBlocked, applying, onApply }: ImportReportProps) {
  const profileId = useId()
  const [writeProfile, setWriteProfile] = useState(plan.profile?.action === 'add')
  const profileChanges = writeProfile && plan.profile !== null && plan.profile.action !== 'same'
  const willWrite = planHasChanges({ ...plan, profile: null }) || profileChanges
  const decksChanging = plan.decks.filter((entry) => entry.action !== 'same')
  const cardsChanging = decksChanging.reduce((sum, entry) => sum + entry.deck.cards.length, 0)

  return (
    <section aria-labelledby="preview-heading" className="mt-8 space-y-4">
      <div>
        <h2 id="preview-heading" className="text-base font-semibold text-fg">
          Preview
        </h2>
        <p className="mt-0.5 text-[0.8125rem] text-fg-muted">
          Read from <span className="font-mono break-all text-fg">{folder}</span>. Nothing has been written yet.
        </p>
      </div>

      <dl className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-line bg-line sm:grid-cols-4">
        <Tile label="Jobs to add" value={plan.jobs.add.length} note={plan.jobs.fromApplications > 0 ? `${plan.jobs.fromApplications} made from applications` : undefined} />
        <Tile label="Applications to add" value={plan.applications.add.length} />
        <Tile label="Already in Shortlist" value={plan.jobs.already + plan.applications.already} note="left as they are" />
        <Tile label="Practice cards" value={cardsChanging} note={decksChanging.length > 0 ? `in ${plural(decksChanging.length, 'deck')}` : 'no deck changes'} />
      </dl>

      {plan.statusMapping.length > 0 ? (
        <Card>
          <CardHeader title="Status mapping" description="How job-hunter's statuses become Shortlist's. Its 'submitted' means you applied." />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[28rem] text-left text-[0.8125rem]">
              <thead className="text-xs text-fg-muted">
                <tr className="border-b border-line">
                  <th scope="col" className="px-4 py-2 font-medium">
                    File
                  </th>
                  <th scope="col" className="px-4 py-2 font-medium">
                    job-hunter
                  </th>
                  <th scope="col" className="px-4 py-2 font-medium">
                    Shortlist
                  </th>
                  <th scope="col" className="px-4 py-2 text-right font-medium">
                    Rows
                  </th>
                </tr>
              </thead>
              <tbody>
                {plan.statusMapping.map((entry) => (
                  <tr key={`${entry.domain}-${entry.from}-${entry.to}`} className="border-b border-line last:border-0">
                    <td className="px-4 py-2 text-fg-muted">{entry.domain === 'queue' ? 'Queue' : 'Applications'}</td>
                    <td className="px-4 py-2 font-mono break-all text-fg">{entry.from}</td>
                    <td className="px-4 py-2">
                      <Badge tone={entry.from === entry.to ? 'muted' : 'info'}>{statusLabel(entry.domain, entry.to)}</Badge>
                    </td>
                    <td className="px-4 py-2 text-right font-mono text-fg tabular-nums">{entry.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      ) : null}

      <Findings title="Mismatches" description="job-hunter's files disagree here. Shortlist goes with the application log." findings={plan.mismatches} />
      <Findings title="Duplicates" description="Repeated postings are imported once." findings={plan.duplicates} />
      <Findings title="Set aside" description="Rows in the application log that are not applications." findings={plan.setAside} />
      <Findings title="Check these" description="Lines that were skipped or need a look after the import." findings={plan.problems} tone="warn" />

      <Card>
        <CardHeader title="What will be written" description="New rows are added; nothing already in Shortlist is changed, except decks, exercises and stories with newer copies." />
        <CardBody className="space-y-3">
          <ul className="space-y-1 text-[0.8125rem]">
            <WriteLine file="jobs.jsonl" what={plan.jobs.add.length > 0 ? `${plural(plan.jobs.add.length, 'new row')}` : null} />
            <WriteLine file="applications.jsonl" what={plan.applications.add.length > 0 ? plural(plan.applications.add.length, 'new row') : null} />
            {plan.decks.map((entry) => (
              <WriteLine
                key={entry.deck.id}
                file={`practice/decks/${entry.deck.id}.json`}
                what={entry.action === 'same' ? null : `${entry.action === 'add' ? 'new deck' : 'newer copy'}, ${plural(entry.deck.cards.length, 'card')}`}
              />
            ))}
            <WriteLine file="practice/exercises.json" what={changeText(plan.exercises.added, plan.exercises.updated, 'exercise')} />
            <WriteLine file="practice/stories.json" what={changeText(plan.stories.added, plan.stories.updated, 'story', 'stories')} />
            <WriteLine file="companies.json" what={plan.companies.added > 0 ? `${plural(plan.companies.added, 'company', 'companies')} added to the watchlist` : null} />
          </ul>
          {plan.jobs.scoresDropped > 0 ? (
            <p className="text-[0.8125rem] text-fg-muted">
              {plural(plan.jobs.scoresDropped, 'old score')} stay behind. job-hunter's scores were written by a language model and often broke their own caps, so Shortlist scores every job again.
            </p>
          ) : null}
          {plan.profile ? (
            <ProfileChoice id={profileId} action={plan.profile.action} checked={writeProfile} onChange={setWriteProfile} />
          ) : null}
        </CardBody>
      </Card>

      <div className="flex flex-wrap items-center gap-3 border-t border-line pt-4">
        <Button variant="primary" disabled={applyBlocked !== null || applying || !willWrite} onClick={() => onApply({ profile: writeProfile })}>
          {applying ? 'Applying…' : 'Apply import'}
        </Button>
        <p className="text-[0.8125rem] text-fg-muted">
          {applyBlocked ?? (willWrite ? 'You can run the import again later; it skips what is already saved.' : 'Everything here is already in Shortlist.')}
        </p>
      </div>
    </section>
  )
}

function changeText(added: number, updated: number, one: string, many = `${one}s`): string | null {
  const parts = [added > 0 ? `${plural(added, one, many)} added` : null, updated > 0 ? `${plural(updated, one, many)} updated` : null].filter(Boolean)
  return parts.length > 0 ? parts.join(', ') : null
}

function Tile({ label, value, note }: { label: string; value: number; note?: string }) {
  return (
    <div className="min-w-0 bg-surface px-4 py-3">
      <dt className="text-xs text-fg-muted">{label}</dt>
      <dd>
        <span className="font-mono text-xl font-semibold text-fg tabular-nums">{value}</span>
        {note ? <span className="block text-xs text-fg-subtle">{note}</span> : null}
      </dd>
    </div>
  )
}

function WriteLine({ file, what }: { file: string; what: string | null }) {
  return (
    <li className="flex flex-wrap items-baseline gap-x-2">
      <span className={cx('font-mono text-xs break-all', what ? 'text-fg' : 'text-fg-subtle')}>{file}</span>
      <span className={what ? 'text-fg-muted' : 'text-fg-subtle'}>{what ?? 'no change'}</span>
    </li>
  )
}

function Findings({ title, description, findings, tone = 'neutral' }: { title: string; description: ReactNode; findings: Finding[]; tone?: 'neutral' | 'warn' }) {
  if (findings.length === 0) return null
  return (
    <Card>
      <CardHeader
        title={
          <span className="inline-flex items-center gap-2">
            {title}
            <Badge tone={tone === 'warn' ? 'warn' : 'neutral'}>{findings.length}</Badge>
          </span>
        }
        description={description}
      />
      <ul className="divide-y divide-line">
        {findings.map((finding, index) => (
          <li key={index} className="px-4 py-2.5 text-[0.8125rem]">
            {finding.file ? (
              <span className="mr-2 font-mono text-xs break-all text-fg-muted">
                {finding.file}
                {finding.line ? `:${finding.line}` : null}
              </span>
            ) : null}
            <span className="break-words text-fg">{finding.message}</span>
          </li>
        ))}
      </ul>
    </Card>
  )
}

function ProfileChoice({ id, action, checked, onChange }: { id: string; action: 'add' | 'update' | 'same'; checked: boolean; onChange: (checked: boolean) => void }) {
  if (action === 'same') return <p className="text-[0.8125rem] text-fg-muted">profile.json matches your profile in Shortlist; nothing to do.</p>
  return (
    <div className="flex items-start gap-2.5 rounded-md bg-surface-2 px-3 py-2.5">
      <input id={id} type="checkbox" className="mt-0.5 size-4 shrink-0" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <label htmlFor={id} className="min-w-0 text-[0.8125rem]">
        <span className="block font-medium text-fg">{action === 'add' ? 'Add the profile from job-hunter' : 'Replace your profile with the one from job-hunter'}</span>
        <span className="block text-fg-muted">
          {action === 'add'
            ? 'Shortlist has no profile yet. It holds your contact details, skills and saved answers, and stays in your data folder.'
            : 'Off by default: any edits you made on the Profile page would be lost.'}
        </span>
      </label>
    </div>
  )
}
