import { lazy, Suspense, useDeferredValue, useId, useMemo } from 'react'
import { lintCoverLetter } from '../../engine/coverLint.ts'
import type { Job, Profile } from '../../engine/types.ts'
import { cx } from '../../ui/cx.ts'
import { Textarea } from '../../ui/Textarea.tsx'

// Drafting only exists on the dev server, so the production build leaves this code out entirely.
const DraftWithClaude = import.meta.env.DEV
  ? lazy(() => import('./DraftWithClaude.tsx').then((module) => ({ default: module.DraftWithClaude })))
  : null

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
              {canDraft && DraftWithClaude ? (
                <Suspense fallback={null}>
                  <DraftWithClaude job={job} profile={profile} current={value} onDraft={onChange} />
                </Suspense>
              ) : null}
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
