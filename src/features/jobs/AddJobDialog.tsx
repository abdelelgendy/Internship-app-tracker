import { useDeferredValue, useMemo, useState, type FormEvent } from 'react'
import { useNavigate } from 'react-router'
import { findDuplicate } from '../../engine/dedup.ts'
import { queueStatusFor } from '../../engine/gates.ts'
import type { Job, Profile } from '../../engine/types.ts'
import { useRepo } from '../../data/data-context.ts'
import { QueueStatusBadge } from '../../ui/Badge.tsx'
import { Button } from '../../ui/Button.tsx'
import { Dialog } from '../../ui/Dialog.tsx'
import { Field } from '../../ui/Field.tsx'
import { Input } from '../../ui/Input.tsx'
import { Textarea } from '../../ui/Textarea.tsx'
import { useToast } from '../../ui/toast-context.ts'
import { fromLocalInputValue, toLocalInputValue, WORKPLACE_LABEL } from './format.ts'
import {
  companyFromUrl,
  ghostFor,
  manualJob,
  parsePostingUrl,
  postedFromText,
  scoreFor,
  skillMentions,
  tierLabel,
  titleFromText,
} from './jobView.ts'
import { ScoreMark, VerdictBadge } from './ScoreParts.tsx'

interface Fields {
  url: string
  title: string
  company: string
  location: string
  posted: string
  jdText: string
}

const EMPTY: Fields = { url: '', title: '', company: '', location: '', posted: '', jdText: '' }

type Errors = Partial<Record<keyof Fields, string>>

function validate(fields: Fields): Errors {
  const errors: Errors = {}
  if (!parsePostingUrl(fields.url)) errors.url = 'Paste the full posting address, starting with https://'
  if (!fields.title.trim()) errors.title = 'Add the job title as the posting writes it.'
  if (!fields.company.trim()) errors.company = 'Add the company name.'
  if (fields.jdText.trim().length < 40) errors.jdText = 'Paste the full description. Scoring reads the requirements from it.'
  return errors
}

/**
 * Adds a posting by hand: a URL plus the pasted description. Facts are read and the score is
 * shown as you type, so you see why it fits before saving it.
 */
export function AddJobDialog({
  open,
  onClose,
  jobs,
  profile,
  now,
}: {
  open: boolean
  onClose: () => void
  jobs: readonly Job[]
  profile: Profile | null
  now: Date
}) {
  const repo = useRepo()
  const toast = useToast()
  const navigate = useNavigate()
  const [fields, setFields] = useState<Fields>(EMPTY)
  const [showErrors, setShowErrors] = useState(false)
  const [saving, setSaving] = useState(false)
  const deferred = useDeferredValue(fields)
  const errors = validate(fields)

  const preview = useMemo(() => {
    if (!deferred.title.trim() || deferred.jdText.trim().length < 40) return null
    const job = manualJob({ ...deferred, id: 'preview', postedAt: fromLocalInputValue(deferred.posted) }, now)
    const score = scoreFor(job, profile, now)
    const duplicate = findDuplicate(job, jobs)
    const ghost = ghostFor(job, jobs)
    return {
      job,
      score,
      duplicate,
      ghost,
      status: score ? queueStatusFor(score, { duplicate: Boolean(duplicate), ghost }) : ('queued' as const),
      skills: skillMentions(job.facts ?? {}, profile),
    }
  }, [deferred, jobs, profile, now])

  function update(name: keyof Fields, value: string) {
    setFields((current) => {
      const next = { ...current, [name]: value }
      // Fill what the URL or the paste already says. A field that still holds what was filled in
      // keeps following its source; once you type in it, it is yours.
      if (name === 'url') {
        const before = parsePostingUrl(current.url)
        const after = parsePostingUrl(value)
        if (!current.company.trim() || current.company === (before && companyFromUrl(before)))
          next.company = (after && companyFromUrl(after)) ?? ''
      }
      if (name === 'jdText') {
        if (!current.title.trim() || current.title === titleFromText(current.jdText)) next.title = titleFromText(value) ?? ''
        const postedBefore = postedFromText(current.jdText, now)
        if (!current.posted || (postedBefore && current.posted === toLocalInputValue(postedBefore))) {
          const posted = postedFromText(value, now)
          next.posted = posted ? toLocalInputValue(posted) : ''
        }
      }
      return next
    })
  }

  function close() {
    setFields(EMPTY)
    setShowErrors(false)
    onClose()
  }

  async function submit(event: FormEvent) {
    event.preventDefault()
    if (Object.keys(errors).length > 0) {
      setShowErrors(true)
      return
    }
    setSaving(true)
    try {
      const base = manualJob({ ...fields, id: `manual-${crypto.randomUUID()}`, postedAt: fromLocalInputValue(fields.posted) }, now)
      const score = scoreFor(base, profile, now)
      const duplicate = findDuplicate(base, jobs)
      const ghost = ghostFor(base, jobs)
      const job: Job = score ? { ...base, score, status: queueStatusFor(score, { duplicate: Boolean(duplicate), ghost }) } : base
      await repo.saveJob(job)
      toast.show({ title: 'Job added', description: `${job.company}, ${job.title}`, tone: 'success' })
      close()
      navigate(`/jobs/${job.id}`)
    } catch (error) {
      toast.show({ title: "Couldn't add the job", description: error instanceof Error ? error.message : String(error), tone: 'danger' })
    } finally {
      setSaving(false)
    }
  }

  const errorFor = (name: keyof Fields) => (showErrors ? errors[name] : undefined)

  return (
    <Dialog
      open={open}
      onClose={close}
      size="lg"
      title="Add a job"
      description="Paste the posting's address and its description. Shortlist reads the requirements and scores it as you go."
      footer={
        <>
          <Button onClick={close}>Cancel</Button>
          <Button variant="primary" type="submit" form="add-job-form" disabled={saving}>
            {saving ? 'Adding...' : 'Add job'}
          </Button>
        </>
      }
    >
      <div className="grid gap-5 md:grid-cols-[minmax(0,1fr)_15rem]">
        <form id="add-job-form" noValidate onSubmit={submit} className="min-w-0 space-y-4">
          <Field label="Posting URL" error={errorFor('url')}>
            {(control) => (
              <Input
                {...control}
                type="url"
                inputMode="url"
                placeholder="https://"
                value={fields.url}
                onChange={(event) => update('url', event.target.value)}
              />
            )}
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Job title" error={errorFor('title')}>
              {(control) => <Input {...control} value={fields.title} onChange={(event) => update('title', event.target.value)} />}
            </Field>
            <Field label="Company" error={errorFor('company')}>
              {(control) => <Input {...control} value={fields.company} onChange={(event) => update('company', event.target.value)} />}
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Location" hint='As written, e.g. "Toronto, ON (Hybrid)" or "Remote, Canada".'>
              {(control) => <Input {...control} value={fields.location} onChange={(event) => update('location', event.target.value)} />}
            </Field>
            <Field label="Posted" hint="From the posting. Leave it empty if it doesn't say; the job waits on hold until you add it.">
              {(control) => (
                <Input
                  {...control}
                  type="datetime-local"
                  value={fields.posted}
                  onChange={(event) => update('posted', event.target.value)}
                />
              )}
            </Field>
          </div>
          <Field label="Description" error={errorFor('jdText')}>
            {(control) => (
              <Textarea {...control} rows={10} value={fields.jdText} onChange={(event) => update('jdText', event.target.value)} />
            )}
          </Field>
        </form>

        <section aria-label="Score preview" aria-live="polite" className="min-w-0 rounded-md bg-surface-2 p-3 text-[0.8125rem]">
          {preview ? (
            <div className="space-y-3">
              <div className="flex items-center gap-3">
                <ScoreMark score={preview.score} size="lg" />
                <div className="min-w-0 space-y-1">
                  {preview.score ? <VerdictBadge verdict={preview.score.gate.verdict} /> : null}
                  <p className="text-xs text-fg-muted">{preview.score ? tierLabel(preview.score.tier) : 'Add your profile to score it'}</p>
                </div>
              </div>
              {preview.score ? <p className="break-words text-fg-muted">{preview.score.gate.reason}</p> : null}
              <dl className="space-y-1">
                <div className="flex justify-between gap-2">
                  <dt className="text-fg-muted">Workplace</dt>
                  <dd className="text-right text-fg">{WORKPLACE_LABEL[preview.job.workplace]}</dd>
                </div>
                <div className="flex justify-between gap-2">
                  <dt className="text-fg-muted">Status if added</dt>
                  <dd>
                    <QueueStatusBadge status={preview.status} />
                  </dd>
                </div>
              </dl>
              {preview.skills.length > 0 ? (
                <p className="break-words text-fg-muted">
                  <span className="text-fg">Skills found:</span> {preview.skills.map((skill) => skill.name).join(', ')}
                </p>
              ) : null}
              {preview.duplicate ? (
                <p className="break-words text-warn-ink">
                  Looks like a duplicate of {preview.duplicate.match.company}, {preview.duplicate.match.title} (same{' '}
                  {preview.duplicate.reason === 'url' ? 'address' : 'company and title'}).
                </p>
              ) : null}
              {preview.ghost ? <p className="break-words text-warn-ink">{preview.ghost}</p> : null}
            </div>
          ) : (
            <p className="text-fg-muted">The score appears here once there is a title and a description.</p>
          )}
        </section>
      </div>
    </Dialog>
  )
}
