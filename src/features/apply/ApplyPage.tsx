import { useEffect, useEffectEvent, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router'
import { defaultTimeZone } from '../../engine/dates.ts'
import { followUpDue } from '../../engine/followups.ts'
import { factsFor } from '../../engine/score.ts'
import { transition } from '../../engine/states.ts'
import type { Application, Job, Profile } from '../../engine/types.ts'
import { useData, useRepo, useRepoData } from '../../data/data-context.ts'
import { AppStatusBadge } from '../../ui/Badge.tsx'
import { Button } from '../../ui/Button.tsx'
import { Card, CardBody, CardHeader } from '../../ui/Card.tsx'
import { cx } from '../../ui/cx.ts'
import { Dialog } from '../../ui/Dialog.tsx'
import { EmptyState } from '../../ui/EmptyState.tsx'
import { Field } from '../../ui/Field.tsx'
import { Input } from '../../ui/Input.tsx'
import { PageHeader } from '../../ui/PageHeader.tsx'
import { Skeleton, SkeletonText } from '../../ui/Skeleton.tsx'
import { buttonClass } from '../../ui/styles.ts'
import { useToast } from '../../ui/toast-context.ts'
import { formatDay, formatDayTime, fromLocalInputValue, plural, toLocalInputValue } from '../jobs/format.ts'
import { CheckIcon, ExternalIcon } from '../../ui/icons.tsx'
import { scoreFor, tierLabel } from '../jobs/jobView.ts'
import { LoadProblem } from '../../ui/LoadProblem.tsx'
import { ScoreMark, VerdictBadge } from '../jobs/ScoreParts.tsx'
import { useNow } from '../jobs/useNow.ts'
import { answerRows, answerStates, recordSubmission, resumeAdvice, resumeVersions, submissionTimeProblem } from './applyModel.ts'
import { AnswersStep } from './AnswersStep.tsx'
import { CoverLetterStep, type SaveState } from './CoverLetterStep.tsx'
import { useKitDraft } from './kitDraft.ts'

export function ApplyPage() {
  const { applicationId = '' } = useParams()
  const applications = useRepoData('applications', (repo) => repo.listApplications())
  const jobs = useRepoData('jobs', (repo) => repo.listJobs())
  const profile = useRepoData('profile', (repo) => repo.getProfile())
  const cover = useRepoData(`cover:${applicationId}`, (repo) => repo.getCoverLetter(applicationId))

  const failed = [applications, jobs, profile, cover].find((result) => result.error && result.data === undefined)
  if (failed?.error) {
    return (
      <>
        <PageHeader title="Apply" />
        <LoadProblem what="this application" error={failed.error} onRetry={failed.reload} />
      </>
    )
  }
  if (!applications.data || !jobs.data || profile.data === undefined || cover.data === undefined) return <ApplySkeleton />

  const app = applications.data.find((entry) => entry.id === applicationId)
  if (!app) {
    return (
      <>
        <PageHeader title="Apply" />
        <EmptyState
          title="No application with this id"
          description={
            <>
              Nothing in your applications has the id <span className="font-mono break-words text-fg">{applicationId}</span>. Start one from a
              job instead.
            </>
          }
          action={
            <Link to="/jobs" className={buttonClass()}>
              Go to jobs
            </Link>
          }
        />
      </>
    )
  }
  if (!profile.data) {
    return (
      <>
        <PageHeader title="Apply" />
        <EmptyState
          title="Add your profile first"
          description="The apply kit suggests answers and checks the cover letter against your profile, so it needs one."
          action={
            <Link to="/profile" className={buttonClass({ variant: 'primary' })}>
              Open profile
            </Link>
          }
        />
      </>
    )
  }

  const job = jobs.data.find((entry) => entry.id === app.jobId) ?? null
  if (app.status !== 'draft' && app.status !== 'prepared') {
    return <SubmittedView app={app} job={job} coverText={cover.data} />
  }
  return (
    <ApplyKit key={app.id} app={app} job={job} profile={profile.data} applications={applications.data} initialCover={cover.data ?? ''} />
  )
}

// ---------- The kit ----------

/** A job record for the kit when the posting is missing: the application keeps company, title and URL. */
function jobFor(app: Application, job: Job | null): Job {
  return (
    job ?? {
      id: app.jobId,
      source: 'unknown',
      company: app.company,
      title: app.title,
      location: '',
      workplace: 'unknown',
      url: app.url,
      postedAt: null,
      postedAtSource: 'unknown',
      discoveredAt: app.history[0]?.at ?? new Date().toISOString(),
      status: 'shortlisted',
    }
  )
}

function useDraftAvailable(): boolean {
  const { mode } = useData()
  const [available, setAvailable] = useState(false)
  useEffect(() => {
    if (!import.meta.env.DEV || mode.kind !== 'local') return
    let current = true
    void import('./aiDraft.ts')
      .then((module) => module.fetchDraftAvailable())
      .then((value) => {
        if (current) setAvailable(value)
      })
    return () => {
      current = false
    }
  }, [mode.kind])
  return mode.kind === 'local' && available
}

function ApplyKit({
  app,
  job: storedJob,
  profile,
  applications,
  initialCover,
}: {
  app: Application
  job: Job | null
  profile: Profile
  applications: Application[]
  initialCover: string
}) {
  const repo = useRepo()
  const toast = useToast()
  const now = useNow()
  const timeZone = defaultTimeZone()
  const canDraft = useDraftAvailable()
  const job = useMemo(() => jobFor(app, storedJob), [app, storedJob])
  const facts = useMemo(() => factsFor(job), [job])
  const score = useMemo(() => (storedJob ? scoreFor(storedJob, profile, now) : null), [storedJob, profile, now])
  const { draft, update, clear } = useKitDraft(app.id)

  // Questions for this form; "applied before" looks only at your other applications.
  const others = useMemo(() => applications.filter((entry) => entry.id !== app.id), [applications, app.id])
  const rows = useMemo(() => answerRows(profile, job, facts, others, draft.custom), [profile, job, facts, others, draft.custom])
  const states = answerStates(rows, draft)
  // Answers npm run prefill already recorded count as used too; the kit's own value wins for the same question.
  const usedAnswers = {
    ...(app.answersUsed ?? {}),
    ...Object.fromEntries(states.filter((state) => state.used && state.value.trim()).map((state) => [state.row.question, state.value.trim()])),
  }

  // The cover letter saves itself a moment after you stop typing.
  const [letter, setLetter] = useState(initialCover)
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const savedLetter = useRef(initialCover)
  async function saveLetter(text: string): Promise<boolean> {
    setSaveState('saving')
    try {
      await repo.saveCoverLetter(app.id, text)
      if (app.coverLetterId !== app.id) await repo.saveApplication({ ...app, coverLetterId: app.id })
      savedLetter.current = text
      setSaveState('saved')
      return true
    } catch {
      setSaveState('error')
      return false
    }
  }

  const saveWhenIdle = useEffectEvent((text: string) => void saveLetter(text))
  useEffect(() => {
    if (letter === savedLetter.current) return
    const timer = setTimeout(() => saveWhenIdle(letter), 800)
    return () => clearTimeout(timer)
  }, [letter])

  const [resume, setResume] = useState(app.resumeVersion ?? '')
  const versions = useMemo(() => resumeVersions(applications), [applications])
  async function commitResume() {
    const value = resume.trim()
    if (value === (app.resumeVersion ?? '')) return
    await repo.saveApplication({ ...app, resumeVersion: value || undefined })
    toast.show({ title: value ? 'Resume version saved' : 'Resume version cleared' })
  }

  const hasLetter = letter.trim() !== ''
  const steps = [
    { title: 'Open the posting', done: draft.opened },
    { title: 'Choose a resume', done: (app.resumeVersion ?? '').trim() !== '' },
    { title: 'Answer the form', done: Object.keys(usedAnswers).length > 0 },
    { title: 'Cover letter', done: draft.noCover || hasLetter },
  ]

  const [recording, setRecording] = useState(false)

  async function markPrepared() {
    const moved = transition(app, 'prepared', new Date().toISOString(), 'me')
    if (!moved.ok) return
    await repo.saveApplication(moved.app)
    toast.show({ title: 'Marked as prepared', description: 'It shows on Today until you submit it.', tone: 'success' })
  }

  async function record(at: string) {
    if (!draft.noCover && letter !== savedLetter.current && !(await saveLetter(letter))) {
      toast.show({ title: "Couldn't save the cover letter", description: 'Nothing was recorded. Try again.', tone: 'danger' })
      return
    }
    const result = recordSubmission(
      app,
      {
        at,
        answers: usedAnswers,
        resumeVersion: resume,
        coverLetterId: !draft.noCover && hasLetter ? app.id : undefined,
      },
      timeZone,
    )
    if (!result.ok) {
      toast.show({ title: "Couldn't record it", description: result.reason, tone: 'danger' })
      return
    }
    await repo.saveApplication(result.app)
    clear()
    setRecording(false)
    toast.show({
      title: 'Recorded as applied',
      description: result.app.followUp ? `Follow-up reminder set for ${formatDay(result.app.followUp.dueAt, timeZone)}.` : undefined,
      tone: 'success',
    })
  }

  return (
    <>
      <Link
        to={`/jobs/${job.id}`}
        className="mb-3 inline-block text-[0.8125rem] text-fg-muted underline-offset-2 hover:text-fg hover:underline"
      >
        Back to the job
      </Link>
      <PageHeader
        title={`Apply to ${app.company}`}
        description={
          <>{app.title}. You fill in and submit the form on their site; this keeps your answers consistent and records what you sent.</>
        }
        actions={<AppStatusBadge status={app.status} />}
      />

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_18rem]">
        <ol className="min-w-0 space-y-6">
          <Step number={1} title="Open the posting" done={draft.opened}>
            <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
              <a
                href={job.url}
                target="_blank"
                rel="noopener noreferrer"
                className={buttonClass({ variant: draft.opened ? 'secondary' : 'primary' })}
                onClick={() => update((current) => ({ ...current, opened: true }))}
              >
                Open the posting
                <ExternalIcon />
                <span className="sr-only">(opens in a new tab)</span>
              </a>
              <span className="min-w-0 font-mono text-xs break-words text-fg-muted">{hostOf(job.url)}</span>
            </div>
            {score ? (
              <div className="mt-4 flex flex-wrap items-center gap-x-3 gap-y-2 border-t border-line pt-3 text-[0.8125rem]">
                <ScoreMark score={score} />
                <VerdictBadge verdict={score.gate.verdict} />
                <span className="text-fg-muted">{tierLabel(score.tier)}</span>
                <span className="min-w-0 basis-full break-words text-fg-muted">{score.gate.reason}</span>
              </div>
            ) : null}
            <p className="mt-3 text-xs text-fg-muted">
              Check that it is still open. Shortlist never logs in or fills the form for you, and never stores a password.
            </p>
          </Step>

          <Step number={2} title="Choose a resume" done={steps[1].done}>
            <p className="mb-3 text-[0.8125rem] text-fg">{resumeAdvice(score, facts)}</p>
            <Field label="Resume version" hint="The file name or label of the resume you upload, so you know later which one they saw.">
              {(control) => (
                <>
                  <Input
                    {...control}
                    list={`${control.id}-versions`}
                    value={resume}
                    placeholder="e.g. resume-2026-11-base"
                    onChange={(event) => setResume(event.target.value)}
                    onBlur={() => void commitResume()}
                    onKeyDown={(event) => {
                      if (event.key === 'Enter') void commitResume()
                    }}
                  />
                  <datalist id={`${control.id}-versions`}>
                    {versions.map((version) => (
                      <option key={version} value={version} />
                    ))}
                  </datalist>
                </>
              )}
            </Field>
          </Step>

          <Step number={3} title="Answer the form" done={steps[2].done}>
            <AnswersStep
              states={states}
              profile={profile}
              onChange={(question, next) => update((current) => ({ ...current, answers: { ...current.answers, [question]: next } }))}
              onAddQuestion={(question) =>
                update((current) => (current.custom.includes(question) ? current : { ...current, custom: [...current.custom, question] }))
              }
            />
          </Step>

          <Step number={4} title="Cover letter" done={steps[3].done}>
            <CoverLetterStep
              value={letter}
              onChange={setLetter}
              saveState={saveState}
              profile={profile}
              job={job}
              noCover={draft.noCover}
              onNoCover={(noCover) => update((current) => ({ ...current, noCover }))}
              canDraft={canDraft}
            />
          </Step>
        </ol>

        <aside aria-label="Submit" className="min-w-0 xl:sticky xl:top-6">
          <Card>
            <div className="flex items-start gap-3 border-b border-line px-4 py-3">
              <StepNumber number={5} done={false} />
              <div className="min-w-0">
                <h2 className="text-sm font-semibold text-fg">
                  <span className="sr-only">Step 5: </span>
                  Submit and record
                </h2>
                <p className="mt-0.5 text-[0.8125rem] text-fg-muted">Submit on their site first. Then record it here.</p>
              </div>
            </div>
            <CardBody className="space-y-4">
              {/* Status marks, not checkbox shapes: these follow the steps and can't be ticked here. */}
              <ul className="space-y-1.5 text-[0.8125rem]">
                {steps.map((step) => (
                  <li key={step.title} className="flex items-center gap-2">
                    <span aria-hidden="true" className="flex size-4 shrink-0 items-center justify-center">
                      {step.done ? <CheckIcon className="size-3.5 text-success-ink" /> : <span className="size-1.5 rounded-full bg-line-strong" />}
                    </span>
                    <span className={cx('min-w-0 flex-1', step.done ? 'text-fg' : 'text-fg-muted')}>{step.title}</span>
                    <span className={cx('text-xs', step.done ? 'text-success-ink' : 'text-fg-subtle')}>{step.done ? 'Done' : 'To do'}</span>
                  </li>
                ))}
              </ul>
              <div className="flex flex-col gap-2">
                <Button variant="primary" onClick={() => setRecording(true)}>
                  I submitted it
                </Button>
                {app.status === 'draft' ? <Button onClick={() => void markPrepared()}>Ready, submit later</Button> : null}
              </div>
              <p className="text-xs text-fg-muted">
                Recording sets the applied date, keeps the answers you marked as used, and schedules one follow-up for day 7.
              </p>
            </CardBody>
          </Card>
        </aside>
      </div>

      {recording ? (
        <RecordDialog
          open
          onClose={() => setRecording(false)}
          onConfirm={record}
          now={now}
          timeZone={timeZone}
          answers={usedAnswers}
          resume={resume.trim()}
          letterWords={!draft.noCover && hasLetter ? letter.trim().split(/\s+/).length : 0}
        />
      ) : null}
    </>
  )
}

function hostOf(url: string): string {
  try {
    return new URL(url).hostname.replace(/^www\./, '')
  } catch {
    return url
  }
}

function StepNumber({ number, done }: { number: number; done: boolean }) {
  return (
    <span
      aria-hidden="true"
      className={cx(
        'flex size-6 shrink-0 items-center justify-center rounded-full border font-mono text-xs font-semibold',
        done ? 'border-fg bg-fg text-surface' : 'border-line-strong text-fg-muted',
      )}
    >
      {done ? <CheckIcon className="size-3.5" /> : number}
    </span>
  )
}

function Step({ number, title, done, children }: { number: number; title: string; done: boolean; children: ReactNode }) {
  return (
    <li>
      <Card>
        <div className="flex items-center gap-3 border-b border-line px-4 py-3">
          <StepNumber number={number} done={done} />
          <h2 className="text-sm font-semibold text-fg">
            <span className="sr-only">Step {number}: </span>
            {title}
            {done ? <span className="sr-only"> (done)</span> : null}
          </h2>
        </div>
        <CardBody>{children}</CardBody>
      </Card>
    </li>
  )
}

function RecordDialog({
  open,
  onClose,
  onConfirm,
  now,
  timeZone,
  answers,
  resume,
  letterWords,
}: {
  open: boolean
  onClose: () => void
  onConfirm: (at: string) => Promise<void>
  now: Date
  timeZone: string
  answers: Record<string, string>
  resume: string
  letterWords: number
}) {
  // The clock when the dialog opens: the page's `now` ticks once a minute and can be a minute behind.
  const [when, setWhen] = useState(() => toLocalInputValue(new Date()))
  const [busy, setBusy] = useState(false)
  const at = fromLocalInputValue(when)
  const problem = submissionTimeProblem(at, now)
  const due = at && !problem ? followUpDue({ appliedAt: at }, timeZone) : null
  const questions = Object.keys(answers)

  async function confirm() {
    if (!at || problem) return
    setBusy(true)
    try {
      await onConfirm(at)
    } finally {
      setBusy(false)
    }
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Record it as applied"
      description="Only after you clicked submit on their form."
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={busy || problem !== null} onClick={() => void confirm()}>
            Record as applied
          </Button>
        </>
      }
    >
      <div className="space-y-4 text-[0.8125rem]">
        <Field label="When you submitted it" error={problem ?? undefined}>
          {(control) => <Input {...control} type="datetime-local" value={when} onChange={(event) => setWhen(event.target.value)} />}
        </Field>
        <dl className="space-y-2">
          <SummaryRow label="Resume">{resume || 'Not recorded'}</SummaryRow>
          <SummaryRow label="Cover letter">{letterWords > 0 ? `Saved, ${plural(letterWords, 'word')}` : 'None'}</SummaryRow>
          <SummaryRow label="Answers">
            {questions.length > 0 ? (
              <details>
                <summary className="cursor-pointer">{plural(questions.length, 'answer')} marked as used</summary>
                <ul className="mt-1 space-y-1 text-fg-muted">
                  {questions.map((question) => (
                    <li key={question} className="break-words">
                      {question} <span className="text-fg">{answers[question]}</span>
                    </li>
                  ))}
                </ul>
              </details>
            ) : (
              'None marked as used'
            )}
          </SummaryRow>
          <SummaryRow label="Follow-up">
            {due ? `${formatDay(due, timeZone)}, a reminder on Today` : 'Scheduled once the date is set'}
          </SummaryRow>
        </dl>
      </div>
    </Dialog>
  )
}

function SummaryRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[6rem_minmax(0,1fr)] gap-2">
      <dt className="text-fg-muted">{label}</dt>
      <dd className="break-words text-fg">{children}</dd>
    </div>
  )
}

// ---------- After submitting ----------

function SubmittedView({ app, job, coverText }: { app: Application; job: Job | null; coverText: string | null }) {
  const timeZone = defaultTimeZone()
  const answers = Object.entries(app.answersUsed ?? {})
  return (
    <>
      <Link
        to={`/jobs/${app.jobId}`}
        className="mb-3 inline-block text-[0.8125rem] text-fg-muted underline-offset-2 hover:text-fg hover:underline"
      >
        Back to the job
      </Link>
      <PageHeader
        title={`Applied to ${app.company}`}
        description={`${app.title}. This is what you sent, kept so you answer the same way next time.`}
        actions={
          <>
            <AppStatusBadge status={app.status} />
            <Link to="/board" className={buttonClass()}>
              Open board
            </Link>
          </>
        }
      />
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="min-w-0 space-y-6">
          <Card>
            <CardHeader
              title="Answers you gave"
              description={answers.length > 0 ? undefined : 'None were recorded for this application.'}
            />
            {answers.length > 0 ? (
              <dl className="divide-y divide-line">
                {answers.map(([question, answer]) => (
                  <div key={question} className="px-4 py-3">
                    <dt className="text-[0.8125rem] break-words text-fg-muted">{question}</dt>
                    <dd className="mt-0.5 text-sm break-words text-fg">{answer}</dd>
                  </div>
                ))}
              </dl>
            ) : null}
          </Card>
          {coverText ? (
            <Card>
              <CardHeader title="Cover letter" />
              <CardBody>
                <p className="max-w-prose text-sm leading-relaxed break-words whitespace-pre-wrap text-fg">{coverText}</p>
              </CardBody>
            </Card>
          ) : null}
        </div>
        <Card>
          <CardHeader title="Record" />
          <CardBody>
            <dl className="space-y-2 text-[0.8125rem]">
              <SummaryRow label="Applied">{app.appliedAt ? formatDayTime(app.appliedAt, timeZone) : 'Date not recorded'}</SummaryRow>
              <SummaryRow label="Resume">{app.resumeVersion ?? 'Not recorded'}</SummaryRow>
              <SummaryRow label="Follow-up">
                {app.followUp?.sentAt
                  ? `Sent ${formatDay(app.followUp.sentAt, timeZone)}`
                  : app.followUp
                    ? `Due ${formatDay(app.followUp.dueAt, timeZone)}`
                    : 'None scheduled'}
              </SummaryRow>
              <SummaryRow label="Posting">
                {job ? (
                  <a href={job.url} target="_blank" rel="noopener noreferrer" className="underline underline-offset-2">
                    Open it<span className="sr-only"> (opens in a new tab)</span>
                  </a>
                ) : (
                  'Not in your jobs'
                )}
              </SummaryRow>
            </dl>
          </CardBody>
        </Card>
      </div>
    </>
  )
}

function ApplySkeleton() {
  return (
    <div aria-busy="true">
      <span className="sr-only">Loading the apply kit</span>
      <Skeleton className="mb-3 h-4 w-24" />
      <div className="mb-6">
        <Skeleton className="h-7 w-72 max-w-full" />
        <Skeleton className="mt-2 h-4 w-96 max-w-full" />
      </div>
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_18rem]">
        <div className="space-y-6">
          {[2, 4, 6].map((lines, index) => (
            <div key={index} className="rounded-lg border border-line bg-surface p-4">
              <Skeleton className="mb-4 h-5 w-40" />
              <SkeletonText lines={lines} />
            </div>
          ))}
        </div>
        <Skeleton className="h-56 w-full rounded-lg" />
      </div>
    </div>
  )
}
