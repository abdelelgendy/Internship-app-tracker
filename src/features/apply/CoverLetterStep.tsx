import { useDeferredValue, useId, useMemo, useState } from 'react'
import { lintCoverLetter } from '../../engine/coverLint.ts'
import type { Job, Profile } from '../../engine/types.ts'
import { Button } from '../../ui/Button.tsx'
import { cx } from '../../ui/cx.ts'
import { Dialog } from '../../ui/Dialog.tsx'
import { Textarea } from '../../ui/Textarea.tsx'
import { useToast } from '../../ui/toast-context.ts'
import { SparkIcon } from '../jobs/icons.tsx'
import { draftRequest, requestCoverDraft } from './aiDraft.ts'

export type SaveState = 'idle' | 'saving' | 'saved' | 'error'

const SAVE_TEXT: Record<SaveState, string> = {
  idle: '',
  saving: 'Saving...',
  saved: 'Draft saved',
  error: "Couldn't save. Your text is still here.",
}

/**
 * The cover letter editor with the linter running as you type: the word limit, banned phrases,
 * dashes and semicolons, and the claims check, which flags numbers and names your profile does
 * not back. "Draft with Claude" appears only in local mode with an API key on the dev server.
 */
export function CoverLetterStep({
  value,
  onChange,
  saveState,
  profile,
  job,
  noCover,
  onNoCover,
  canDraft,
}: {
  value: string
  onChange: (value: string) => void
  saveState: SaveState
  profile: Profile
  job: Pick<Job, 'company' | 'title' | 'jdText'>
  noCover: boolean
  onNoCover: (noCover: boolean) => void
  canDraft: boolean
}) {
  const id = useId()
  const deferred = useDeferredValue(value)
  const lint = useMemo(
    () => (deferred.trim() ? lintCoverLetter(deferred, profile, { company: job.company }) : null),
    [deferred, profile, job.company],
  )
  const errors = lint?.issues.filter((issue) => issue.severity === 'error') ?? []
  const warnings = lint?.issues.filter((issue) => issue.severity === 'warning') ?? []
  const maxWords = profile.coverLetter.maxWords || 150

  return (
    <div className="space-y-4">
      <label className="flex items-center gap-2 text-[0.8125rem] text-fg">
        <input type="checkbox" checked={noCover} onChange={(event) => onNoCover(event.target.checked)} />
        This form has no cover letter
      </label>
      {noCover ? null : (
        <>
          <div>
            <div className="mb-1 flex flex-wrap items-end justify-between gap-2">
              <label htmlFor={`${id}-letter`} className="text-[0.8125rem] font-medium text-fg">
                Cover letter for {job.company}
              </label>
              {canDraft ? <DraftWithClaude job={job} profile={profile} current={value} onDraft={onChange} /> : null}
            </div>
            <Textarea
              id={`${id}-letter`}
              rows={12}
              value={value}
              onChange={(event) => onChange(event.target.value)}
              aria-describedby={`${id}-lint`}
              placeholder={`Name something true and specific about ${job.company}, then one project that matches the posting. Plain words, ${maxWords} at most.`}
            />
            <p className="mt-1 min-h-4 text-xs text-fg-muted" aria-live="polite">
              {SAVE_TEXT[saveState]}
            </p>
          </div>

          <section id={`${id}-lint`} aria-label="Cover letter checks" className="rounded-md bg-surface-2 p-3 text-[0.8125rem]">
            {lint ? (
              <>
                <p className="flex flex-wrap gap-x-4 gap-y-1 text-fg">
                  <span>
                    <span className={cx('font-mono tabular-nums', lint.words > maxWords && 'text-danger-ink')}>{lint.words}</span>
                    <span className="text-fg-muted"> / {maxWords} words</span>
                  </span>
                  <span>
                    <span className="font-mono tabular-nums">{lint.paragraphs}</span>
                    <span className="text-fg-muted"> paragraph{lint.paragraphs === 1 ? '' : 's'}</span>
                  </span>
                  <span className={lint.ok ? 'font-medium text-success-ink' : 'font-medium text-danger-ink'}>
                    {lint.ok ? 'Passes every rule' : `${errors.length} to fix`}
                  </span>
                </p>
                {lint.issues.length > 0 ? (
                  <ul className="mt-2 space-y-1.5">
                    {[...errors, ...warnings].map((issue, index) => (
                      <li key={`${issue.rule}-${index}`} className="flex gap-2">
                        <span
                          className={cx(
                            'mt-0.5 shrink-0 text-xs font-semibold uppercase',
                            issue.severity === 'error' ? 'text-danger-ink' : 'text-warn-ink',
                          )}
                        >
                          {issue.severity === 'error' ? 'Fix' : 'Check'}
                        </span>
                        <span className="min-w-0 break-words text-fg">
                          {issue.message}
                          {issue.excerpt && issue.excerpt !== issue.message && issue.rule !== 'banned_phrase' ? (
                            <span className="mt-0.5 block text-xs text-fg-muted">"{issue.excerpt}"</span>
                          ) : null}
                        </span>
                      </li>
                    ))}
                  </ul>
                ) : null}
              </>
            ) : (
              <p className="text-fg-muted">
                The checks run as you write: length, banned phrases, dashes, and every claim against your approved facts.
              </p>
            )}
          </section>
        </>
      )}
    </div>
  )
}

function DraftWithClaude({
  job,
  profile,
  current,
  onDraft,
}: {
  job: Pick<Job, 'company' | 'title' | 'jdText'>
  profile: Profile
  current: string
  onDraft: (value: string) => void
}) {
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const request = draftRequest(job, profile)
  const postingWords = request.jdText.split(/\s+/).filter(Boolean).length

  async function send() {
    setBusy(true)
    setError(null)
    try {
      const draft = await requestCoverDraft(request)
      const signature = profile.coverLetter.signature.trim()
      const letter = signature && !draft.trimEnd().endsWith(signature) ? `${draft.trimEnd()}\n\n${signature}` : draft
      const previous = current
      onDraft(letter)
      setOpen(false)
      toast.show({
        title: 'Draft added',
        description: 'Read it and edit it before you use it. The checks below ran on it.',
        action: previous.trim() ? { label: 'Undo', onAction: () => onDraft(previous) } : undefined,
      })
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <SparkIcon />
        Draft with Claude
      </Button>
      <Dialog
        open={open}
        onClose={() => !busy && setOpen(false)}
        title="Draft a cover letter with Claude"
        description="This sends text to Anthropic's API. Read what goes before you send it."
        footer={
          <>
            <Button onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => void send()} disabled={busy || postingWords < 8}>
              {busy ? 'Drafting...' : 'Send and draft'}
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-[0.8125rem]">
          <p className="font-medium text-fg">What is sent</p>
          <ul className="list-disc space-y-1 pl-5 text-fg">
            <li className="break-words">
              The posting: {job.company}, {job.title} ({postingWords} words of description)
            </li>
            <li className="break-words">
              {request.facts.length} approved fact{request.facts.length === 1 ? '' : 's'}
              {request.facts.length > 0 ? `: ${request.facts.map((fact) => fact.label).join(', ')}` : ''}
            </li>
            <li>Your style rules: at most {request.style.maxWords} words, voice notes and banned phrases</li>
          </ul>
          <p className="text-fg-muted">
            Not sent: your name, email, phone, links, location, work authorization, form answers or application history. Email addresses and
            phone numbers are removed from the text before it leaves this computer.
          </p>
          {postingWords < 8 ? (
            <p className="text-danger-ink">This job has no description to write from. Paste it into the job first.</p>
          ) : null}
          {current.trim() ? <p className="text-warn-ink">The draft replaces the text in the editor. You can undo it.</p> : null}
          {error ? (
            <p role="alert" className="break-words text-danger-ink">
              {error}
            </p>
          ) : null}
        </div>
      </Dialog>
    </>
  )
}
