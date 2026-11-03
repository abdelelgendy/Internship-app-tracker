import { useMemo, useState, type FormEvent, type ReactNode } from 'react'
import { Link, useParams } from 'react-router'
import { defaultTimeZone } from '../../engine/dates.ts'
import { factsFor } from '../../engine/score.ts'
import { canQueueTransition, isTerminal } from '../../engine/states.ts'
import type { Application, Job, JobFacts, Profile, QueueStatus, ScoreResult } from '../../engine/types.ts'
import { useRepo, useRepoData } from '../../data/data-context.ts'
import { AppStatusBadge, QueueStatusBadge } from '../../ui/Badge.tsx'
import { Button } from '../../ui/Button.tsx'
import { Card, CardBody, CardHeader } from '../../ui/Card.tsx'
import { cx } from '../../ui/cx.ts'
import { EmptyState } from '../../ui/EmptyState.tsx'
import { Field } from '../../ui/Field.tsx'
import { Input } from '../../ui/Input.tsx'
import { PageHeader } from '../../ui/PageHeader.tsx'
import { Skeleton, SkeletonText } from '../../ui/Skeleton.tsx'
import { buttonClass } from '../../ui/styles.ts'
import { useToast } from '../../ui/toast-context.ts'
import { useStartApplication } from '../apply/useStartApplication.ts'
import { formatAge, formatDay, formatDayTime, fromLocalInputValue, sourceLabel, WORKPLACE_LABEL } from './format.ts'
import { ExternalIcon } from './icons.tsx'
import { duplicateIndex, ghostFor, markSkills, scoreFor, skillMentions, tierLabel, tierMeaning, type SkillMention } from './jobView.ts'
import { LoadProblem } from './LoadProblem.tsx'
import { ScoreBreakdown, ScoreMark, VerdictBadge } from './ScoreParts.tsx'
import { useNow } from './useNow.ts'

export function JobDetailPage() {
  const { id = '' } = useParams()
  const now = useNow()
  const jobs = useRepoData('jobs', (repo) => repo.listJobs())
  const applications = useRepoData('applications', (repo) => repo.listApplications())
  const profile = useRepoData('profile', (repo) => repo.getProfile())

  const failed = [jobs, applications, profile].find((result) => result.error && result.data === undefined)
  if (failed?.error) {
    return (
      <>
        <PageHeader title="Job" />
        <LoadProblem what="this job" error={failed.error} onRetry={failed.reload} />
      </>
    )
  }
  if (!jobs.data || !applications.data || profile.data === undefined) return <DetailSkeleton />

  const job = jobs.data.find((entry) => entry.id === id)
  if (!job) {
    return (
      <>
        <PageHeader title="Job" />
        <EmptyState
          title="No job with this id"
          description={
            <>
              Nothing in your jobs has the id <span className="font-mono break-all text-fg">{id}</span>. It may have been removed or
              imported under a new id.
            </>
          }
          action={
            <Link to="/jobs" className={buttonClass()}>
              Back to jobs
            </Link>
          }
        />
      </>
    )
  }
  return <JobDetail job={job} jobs={jobs.data} applications={applications.data} profile={profile.data} now={now} />
}

function JobDetail({
  job,
  jobs,
  applications,
  profile,
  now,
}: {
  job: Job
  jobs: Job[]
  applications: Application[]
  profile: Profile | null
  now: Date
}) {
  const timeZone = defaultTimeZone()
  const { start, startingId } = useStartApplication()
  const facts = useMemo(() => factsFor(job), [job])
  const score = useMemo(() => scoreFor(job, profile, now), [job, profile, now])
  const duplicate = useMemo(() => duplicateIndex(jobs).get(job.id) ?? null, [jobs, job.id])
  const ghost = useMemo(() => ghostFor(job, jobs), [job, jobs])
  const skills = useMemo(() => skillMentions(facts, profile), [facts, profile])
  const jobApps = applications.filter((app) => app.jobId === job.id)
  const openApp = jobApps.find((app) => !isTerminal(app.status))

  return (
    <>
      <Link to="/jobs" className="mb-3 inline-block text-[0.8125rem] text-fg-muted underline-offset-2 hover:text-fg hover:underline">
        All jobs
      </Link>
      <PageHeader
        title={job.title}
        description={
          <>
            <span className="font-medium text-fg">{job.company}</span>
            {job.location ? ` · ${job.location}` : ''} · {WORKPLACE_LABEL[job.workplace]}
          </>
        }
        actions={
          <>
            <a href={job.url} target="_blank" rel="noopener noreferrer" className={buttonClass()}>
              Open posting
              <ExternalIcon />
              <span className="sr-only">(opens in a new tab)</span>
            </a>
            <Button variant="primary" disabled={startingId === job.id} onClick={() => void start(job, applications)}>
              {openApp ? 'Continue application' : 'Start application'}
            </Button>
          </>
        }
      />

      <div className="mb-6 space-y-2 empty:hidden">
        {duplicate ? (
          <Callout tone="warn">
            Looks like a repeat of{' '}
            <Link to={`/jobs/${duplicate.original.id}`} className="font-medium underline underline-offset-2">
              {duplicate.original.company}, {duplicate.original.title}
            </Link>
            , found earlier ({duplicate.reason === 'url' ? 'same address' : 'same company and title'}).
          </Callout>
        ) : null}
        {ghost ? <Callout tone="warn">Possible ghost job. {ghost}</Callout> : null}
        {job.verified === false ? <UnverifiedCallout job={job} /> : null}
      </div>

      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="min-w-0 space-y-6 xl:col-start-2 xl:row-start-1">
          <VerdictCard job={job} score={score} />
          <StatusCard job={job} applications={jobApps} />
          <FactsCard job={job} facts={facts} skills={skills} now={now} timeZone={timeZone} />
        </div>
        <div className="min-w-0 space-y-6 xl:col-start-1 xl:row-start-1">
          <Card>
            <CardHeader
              title="Why this score"
              description="Each part of the rubric, what it scored and why. The parts add up to the total."
            />
            <CardBody>
              {score ? <ScoreBreakdown score={score} /> : <p className="text-fg-muted">Add your profile to score this job.</p>}
            </CardBody>
          </Card>
          <Card>
            <CardHeader
              title="Posting"
              description={
                skills.some((skill) => skill.level === 'strong' || skill.level === 'working') ? (
                  <>
                    <mark className="rounded-sm bg-accent-soft px-0.5 text-fg">Highlighted</mark>: skills you list as strong or working.
                  </>
                ) : (
                  'The description as it was saved.'
                )
              }
            />
            <CardBody>
              {job.jdText ? (
                <PostingText text={job.jdText} skills={skills} />
              ) : (
                <p className="text-fg-muted">No description saved. Open the posting to read it, and paste it in to improve the score.</p>
              )}
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  )
}

function Callout({ tone, children }: { tone: 'warn' | 'info'; children: ReactNode }) {
  return (
    <div
      className={cx(
        'rounded-md border-l-4 px-3 py-2 text-[0.8125rem] break-words',
        tone === 'warn' ? 'border-warn-ink bg-warn-soft text-warn-ink' : 'border-info-ink bg-info-soft text-info-ink',
      )}
    >
      {children}
    </div>
  )
}

function UnverifiedCallout({ job }: { job: Job }) {
  const repo = useRepo()
  return (
    <Callout tone="info">
      <span className="mr-2">
        Found by {sourceLabel(job.source).toLowerCase()} and not opened yet. Open the posting to check it is real and still open.
      </span>
      <button
        type="button"
        className="font-medium underline underline-offset-2"
        onClick={() => void repo.saveJob({ ...job, verified: true })}
      >
        I checked it
      </button>
    </Callout>
  )
}

function VerdictCard({ job, score }: { job: Job; score: ScoreResult | null }) {
  return (
    <Card>
      <CardHeader title="Fit" />
      <CardBody className="space-y-3">
        <div className="flex items-center gap-4">
          <p className="flex items-baseline gap-2.5 pl-1">
            <ScoreMark score={score} size="lg" />
            <span className="text-[0.8125rem] text-fg-muted">of 100</span>
          </p>
          {score ? (
            <div className="min-w-0 space-y-1">
              <VerdictBadge verdict={score.gate.verdict} />
              <p className="text-xs text-fg-muted">
                {tierLabel(score.tier)}: {tierMeaning(score.tier).toLowerCase()}
              </p>
            </div>
          ) : null}
        </div>
        {score ? <p className="text-[0.8125rem] break-words text-fg-muted">{score.gate.reason}</p> : null}
        {score && score.disqualifiers.length > 0 ? (
          <ul className="list-disc space-y-1 pl-5 text-[0.8125rem] text-danger-ink">
            {score.disqualifiers.map((reason) => (
              <li key={reason} className="break-words">
                {reason}
              </li>
            ))}
          </ul>
        ) : null}
        {job.postedAt === null ? <PostedDateForm job={job} /> : null}
      </CardBody>
    </Card>
  )
}

function PostedDateForm({ job }: { job: Job }) {
  const repo = useRepo()
  const toast = useToast()
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function submit(event: FormEvent) {
    event.preventDefault()
    const postedAt = fromLocalInputValue(value)
    if (!postedAt) {
      setError('Pick the date and time from the posting.')
      return
    }
    await repo.saveJob({ ...job, postedAt, postedAtSource: 'manual' })
    toast.show({ title: 'Posting date saved', tone: 'success' })
  }

  return (
    <form onSubmit={submit} className="space-y-2 border-t border-line pt-3">
      <Field label="When was it posted?" error={error ?? undefined} hint="The recency check needs it.">
        {(control) => <Input {...control} type="datetime-local" value={value} onChange={(event) => setValue(event.target.value)} />}
      </Field>
      <Button type="submit" size="sm">
        Save date
      </Button>
    </form>
  )
}

function StatusCard({ job, applications }: { job: Job; applications: Application[] }) {
  const repo = useRepo()
  const toast = useToast()

  async function move(to: QueueStatus, title: string) {
    await repo.saveJob({ ...job, status: to })
    toast.show({ title, tone: 'success', action: { label: 'Undo', onAction: () => void repo.saveJob(job) } })
  }

  const actions: { to: QueueStatus; label: string; done: string }[] = [
    { to: 'shortlisted', label: 'Shortlist', done: 'Shortlisted' },
    { to: 'queued', label: 'Back to queue', done: 'Back in the queue' },
    { to: 'archived', label: 'Skip', done: 'Skipped. It moved to Archived.' },
  ]
  const available = actions.filter((action) => action.to !== job.status && canQueueTransition(job.status, action.to))

  return (
    <Card>
      <CardHeader title="Status" />
      <CardBody className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <QueueStatusBadge status={job.status} />
          {available.map((action) => (
            <Button key={action.to} size="sm" variant="ghost" onClick={() => void move(action.to, action.done)}>
              {action.label}
            </Button>
          ))}
        </div>
        {applications.length > 0 ? (
          <ul className="space-y-1.5 border-t border-line pt-3">
            {applications.map((app) => (
              <li key={app.id} className="flex flex-wrap items-center justify-between gap-2 text-[0.8125rem]">
                <AppStatusBadge status={app.status} />
                <Link
                  to={app.status === 'draft' || app.status === 'prepared' ? `/apply/${app.id}` : '/board'}
                  className="font-medium text-fg underline underline-offset-2"
                >
                  {app.status === 'draft' || app.status === 'prepared' ? 'Open apply kit' : 'See it on the board'}
                </Link>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-[0.8125rem] text-fg-muted">No application yet.</p>
        )}
      </CardBody>
    </Card>
  )
}

const LEVEL_TEXT: Record<NonNullable<JobFacts['level']>, string> = {
  intern: 'Internship or co-op',
  new_grad: 'New grad or entry level',
  junior: 'Junior',
  mid: 'Mid level',
  senior: 'Senior',
  unknown: 'Not stated',
}

function yearsText(facts: JobFacts): string {
  const min = facts.yearsMin ?? null
  const max = facts.yearsMax ?? null
  if (min === null && max === null) return 'Not stated'
  if (max === null) return `${min}+ years`
  if (min === null || min === max) return `${max} years`
  return `${min} to ${max} years`
}

function FactsCard({
  job,
  facts,
  skills,
  now,
  timeZone,
}: {
  job: Job
  facts: JobFacts
  skills: SkillMention[]
  now: Date
  timeZone: string
}) {
  const required = skills.filter((skill) => !skill.preferred)
  const preferred = skills.filter((skill) => skill.preferred)
  const flags = [
    facts.usOnly ? 'Requires US residence or work authorization' : null,
    facts.requiresEnrollment ? 'Requires current enrollment as a student' : null,
    facts.advancedDegreeRequired ? "Requires a master's or PhD" : null,
  ].filter((flag): flag is string => flag !== null)

  return (
    <Card>
      <CardHeader title="What the posting says" description="Read from the description by rules, not AI." />
      <CardBody>
        <dl className="space-y-3 text-[0.8125rem]">
          <Fact label="Level">{LEVEL_TEXT[facts.level ?? 'unknown']}</Fact>
          <Fact label="Experience">{yearsText(facts)}</Fact>
          <Fact label="Skills">{required.length > 0 ? <SkillChips skills={required} /> : 'None found'}</Fact>
          {preferred.length > 0 ? (
            <Fact label="Nice to have">
              <SkillChips skills={preferred} />
            </Fact>
          ) : null}
          <Fact label="Pay">{facts.salaryText ?? 'Not stated'}</Fact>
          {flags.length > 0 ? (
            <Fact label="Watch for">
              <ul className="space-y-0.5 text-danger-ink">
                {flags.map((flag) => (
                  <li key={flag}>{flag}</li>
                ))}
              </ul>
            </Fact>
          ) : null}
          {facts.ghostPhrases && facts.ghostPhrases.length > 0 ? (
            <Fact label="Ghost wording">{facts.ghostPhrases.map((phrase) => `"${phrase}"`).join(', ')}</Fact>
          ) : null}
          <Fact label="Posted">
            {job.postedAt ? (
              <>
                {formatAge(job.postedAt, now)}
                <span className="block text-fg-muted">{formatDayTime(job.postedAt, timeZone)}</span>
              </>
            ) : (
              'Unknown'
            )}
          </Fact>
          <Fact label="Found">
            {formatDay(job.discoveredAt, timeZone)} via {sourceLabel(job.source)}
          </Fact>
        </dl>
      </CardBody>
    </Card>
  )
}

function Fact({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[6.5rem_minmax(0,1fr)] gap-2">
      <dt className="text-fg-muted">{label}</dt>
      <dd className="break-words text-fg">{children}</dd>
    </div>
  )
}

function SkillChips({ skills }: { skills: SkillMention[] }) {
  return (
    <ul className="flex flex-wrap gap-1">
      {skills.map((skill) => {
        const yours = skill.level === 'strong' || skill.level === 'working'
        return (
          <li
            key={skill.name}
            className={cx(
              'rounded-sm border px-1.5 py-0.5 text-xs',
              yours ? 'border-transparent bg-accent-soft text-fg' : 'border-line-strong text-fg',
            )}
          >
            {skill.name}
            <span className="ml-1 text-fg-muted">{skill.level ?? 'not on profile'}</span>
          </li>
        )
      })}
    </ul>
  )
}

function PostingText({ text, skills }: { text: string; skills: SkillMention[] }) {
  const segments = useMemo(() => markSkills(text, skills), [text, skills])
  return (
    <div className="max-w-prose text-sm leading-relaxed break-words whitespace-pre-wrap text-fg">
      {segments.map((segment, index) =>
        segment.skill ? (
          <mark key={index} className="rounded-sm bg-accent-soft px-0.5 text-fg">
            {segment.text}
          </mark>
        ) : (
          <span key={index}>{segment.text}</span>
        ),
      )}
    </div>
  )
}

function DetailSkeleton() {
  return (
    <div aria-busy="true">
      <span className="sr-only">Loading job</span>
      <Skeleton className="mb-3 h-4 w-16" />
      <div className="mb-6">
        <Skeleton className="h-7 w-72 max-w-full" />
        <Skeleton className="mt-2 h-4 w-56 max-w-full" />
      </div>
      <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_20rem]">
        <div className="space-y-6 xl:col-start-2 xl:row-start-1">
          <Skeleton className="h-36 w-full rounded-lg" />
          <Skeleton className="h-28 w-full rounded-lg" />
        </div>
        <div className="space-y-6 rounded-lg border border-line bg-surface p-4 xl:col-start-1 xl:row-start-1">
          <Skeleton className="h-4 w-32" />
          <SkeletonText lines={8} />
        </div>
      </div>
    </div>
  )
}
