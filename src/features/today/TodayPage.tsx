import { useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { defaultTimeZone } from '../../engine/dates.ts'
import { transition } from '../../engine/states.ts'
import type { Application } from '../../engine/types.ts'
import { useRepo, useRepoData } from '../../data/data-context.ts'
import { AppStatusBadge, Badge } from '../../ui/Badge.tsx'
import { Button } from '../../ui/Button.tsx'
import { Card, CardHeader } from '../../ui/Card.tsx'
import { cx } from '../../ui/cx.ts'
import { IconButton } from '../../ui/IconButton.tsx'
import { PageHeader } from '../../ui/PageHeader.tsx'
import { Skeleton, SkeletonText } from '../../ui/Skeleton.tsx'
import { buttonClass } from '../../ui/styles.ts'
import { useToast } from '../../ui/toast-context.ts'
import { useStartApplication } from '../apply/useStartApplication.ts'
import { copyText } from '../jobs/clipboard.ts'
import { formatAge, formatDay, formatDayTime, plural, relativeDay, WORKPLACE_LABEL } from '../jobs/format.ts'
import { CheckIcon, CopyIcon } from '../../ui/icons.tsx'
import { tierLabel } from '../jobs/jobView.ts'
import { LoadProblem } from '../../ui/LoadProblem.tsx'
import { ScoreMark } from '../jobs/ScoreParts.tsx'
import { useNow } from '../jobs/useNow.ts'
import { followUpNote, planToday, practiceSummary, summaryLine, type PracticeSummary, type TodayPlan } from './todayModel.ts'

export function TodayPage() {
  const now = useNow()
  const timeZone = defaultTimeZone()
  const jobs = useRepoData('jobs', (repo) => repo.listJobs())
  const applications = useRepoData('applications', (repo) => repo.listApplications())
  const profile = useRepoData('profile', (repo) => repo.getProfile())
  const practice = useRepoData('practice-summary', async (repo) => {
    const [decks, progress] = await Promise.all([repo.listDecks(), repo.getProgress()])
    return { decks, progress }
  })

  const plan = useMemo(
    () =>
      jobs.data && applications.data && profile.data !== undefined
        ? planToday(applications.data, jobs.data, profile.data, now, timeZone)
        : null,
    [jobs.data, applications.data, profile.data, now, timeZone],
  )
  const summary = useMemo(
    () => (practice.data ? practiceSummary(practice.data.decks, practice.data.progress, now, timeZone) : null),
    [practice.data, now, timeZone],
  )

  const failed = [jobs, applications, profile].find((result) => result.error && result.data === undefined)
  if (failed?.error) {
    return (
      <>
        <PageHeader title="Today" />
        <LoadProblem what="today's work" error={failed.error} onRetry={failed.reload} />
      </>
    )
  }

  return (
    <>
      <PageHeader title="Today" description={plan ? summaryLine(plan) : 'Working out what needs you today.'} />
      {plan ? (
        <div className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_18rem]">
          <div className="min-w-0 space-y-6">
            <InterviewsSection plan={plan} now={now} timeZone={timeZone} />
            <FollowUpsSection plan={plan} timeZone={timeZone} signature={profile.data?.coverLetter.signature ?? ''} />
            <WaitingSection plan={plan} />
            <MatchesSection plan={plan} now={now} applications={applications.data ?? []} hasProfile={Boolean(profile.data)} />
          </div>
          <aside aria-label="Today at a glance" className="min-w-0 space-y-6">
            <TargetCard submitted={plan.submittedToday} target={plan.dailyTarget} />
            <PracticeCard summary={summary} error={practice.error} />
          </aside>
        </div>
      ) : (
        <TodaySkeleton />
      )}
    </>
  )
}

// ---------- Layout pieces ----------

function Section({ title, count, description, children }: { title: string; count: number; description?: string; children: ReactNode }) {
  return (
    <Card role="region" aria-label={title}>
      <CardHeader
        title={
          <>
            {title} <span className="ml-1 font-mono text-xs font-normal text-fg-subtle tabular-nums">{count}</span>
          </>
        }
        description={description}
      />
      {children}
    </Card>
  )
}

function Rows({ children }: { children: ReactNode }) {
  return <ul className="divide-y divide-line">{children}</ul>
}

function Row({ children, action }: { children: ReactNode; action: ReactNode }) {
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3">
      <div className="min-w-0 flex-1 basis-56">{children}</div>
      <div className="flex shrink-0 items-center gap-1.5">{action}</div>
    </li>
  )
}

function Empty({ children }: { children: ReactNode }) {
  return <p className="px-4 py-4 text-[0.8125rem] text-fg-muted">{children}</p>
}

function Heading({ company, title, to }: { company: string; title: string; to?: string }) {
  return (
    <p className="text-sm break-words text-fg">
      <span className="font-semibold">{company}</span>
      <span className="text-fg-subtle"> · </span>
      {to ? (
        <Link to={to} className="underline-offset-2 hover:underline">
          {title}
        </Link>
      ) : (
        title
      )}
    </p>
  )
}

function Meta({ children }: { children: ReactNode }) {
  return <p className="mt-0.5 text-[0.8125rem] break-words text-fg-muted">{children}</p>
}

// ---------- Sections ----------

function InterviewsSection({ plan, now, timeZone }: { plan: TodayPlan; now: Date; timeZone: string }) {
  return (
    <Section title="Interviews coming up" count={plan.interviews.length} description="The next two weeks.">
      {plan.interviews.length === 0 ? (
        <Empty>No interviews in the next two weeks.</Empty>
      ) : (
        <Rows>
          {plan.interviews.map(({ app, interview }) => (
            <Row
              key={`${app.id}:${interview.at}`}
              action={
                <Link to="/practice" className={buttonClass({ size: 'sm' })}>
                  Practice
                </Link>
              }
            >
              <Heading company={app.company} title={app.title} to={`/jobs/${app.jobId}`} />
              <Meta>
                <span className="font-medium text-fg tabular-nums">{formatDayTime(interview.at, timeZone)}</span>
                {' · '}
                {relativeDay(interview.at, now, timeZone)}
                {' · '}
                {interview.kind}
                {interview.with ? ` with ${interview.with}` : ''}
              </Meta>
            </Row>
          ))}
        </Rows>
      )}
    </Section>
  )
}

function FollowUpsSection({ plan, timeZone, signature }: { plan: TodayPlan; timeZone: string; signature: string }) {
  const repo = useRepo()
  const toast = useToast()
  const [busyId, setBusyId] = useState<string | null>(null)

  async function save(app: Application, next: Application, title: string) {
    setBusyId(app.id)
    try {
      await repo.saveApplication(next)
      toast.show({ title, tone: 'success', action: { label: 'Undo', onAction: () => void repo.saveApplication(app) } })
    } catch (error) {
      toast.show({ title: "Couldn't save", description: error instanceof Error ? error.message : String(error), tone: 'danger' })
    } finally {
      setBusyId(null)
    }
  }

  function markSent(app: Application, dueAt: string) {
    void save(app, { ...app, followUp: { dueAt, sentAt: new Date().toISOString() } }, 'Follow-up marked sent')
  }

  function markQuiet(app: Application) {
    const moved = transition(app, 'ghosted', new Date().toISOString(), 'me')
    if (moved.ok) void save(app, moved.app, 'Marked as no reply')
  }

  async function copyNote(app: Application) {
    const copied = await copyText(followUpNote(app, timeZone, signature))
    toast.show(
      copied
        ? { title: 'Follow-up note copied' }
        : { title: "Couldn't copy", description: 'Your browser blocked the clipboard.', tone: 'danger' },
    )
  }

  const total = plan.followUps.length + plan.quiet.length
  return (
    <Section title="Follow-ups" count={total} description="One short note on day 7. You send it; Shortlist only reminds you.">
      {total === 0 ? (
        <Empty>
          No follow-ups due.
          {plan.nextFollowUp ? ` The next one is due ${formatDay(plan.nextFollowUp, timeZone)}.` : ''}
        </Empty>
      ) : (
        <Rows>
          {plan.followUps.map(({ app, action, daysLate }) => (
            <Row
              key={app.id}
              action={
                <>
                  <IconButton
                    label={`Copy a follow-up note for ${app.company}`}
                    icon={<CopyIcon />}
                    size="sm"
                    onClick={() => copyNote(app)}
                  />
                  <Button size="sm" disabled={busyId === app.id} onClick={() => action.dueAt && markSent(app, action.dueAt)}>
                    <CheckIcon />
                    Mark sent
                  </Button>
                </>
              }
            >
              <div className="flex flex-wrap items-center gap-2">
                <Heading company={app.company} title={app.title} to={`/jobs/${app.jobId}`} />
                {daysLate > 0 ? <Badge tone="warn">{plural(daysLate, 'day')} late</Badge> : <Badge tone="info">Due today</Badge>}
              </div>
              <Meta>
                Applied {app.appliedAt ? formatDay(app.appliedAt, timeZone) : 'on an unknown date'}
                {action.dueAt ? ` · follow-up due ${formatDay(action.dueAt, timeZone)}` : ''}
              </Meta>
            </Row>
          ))}
          {plan.quiet.map(({ app, action }) => (
            <Row
              key={app.id}
              action={
                <Button size="sm" disabled={busyId === app.id} onClick={() => markQuiet(app)}>
                  Mark no reply
                </Button>
              }
            >
              <Heading company={app.company} title={app.title} to={`/jobs/${app.jobId}`} />
              <Meta>
                {action.label} Applied {app.appliedAt ? formatDay(app.appliedAt, timeZone) : 'on an unknown date'}.
              </Meta>
            </Row>
          ))}
        </Rows>
      )}
    </Section>
  )
}

function WaitingSection({ plan }: { plan: TodayPlan }) {
  const repo = useRepo()
  const toast = useToast()

  async function assessmentDone(app: Application) {
    const moved = transition(app, 'reviewing', new Date().toISOString(), 'me')
    if (!moved.ok) return
    await repo.saveApplication(moved.app)
    toast.show({ title: 'Moved to In review', tone: 'success', action: { label: 'Undo', onAction: () => void repo.saveApplication(app) } })
  }

  function actionFor(app: Application) {
    switch (app.status) {
      case 'draft':
        return (
          <Link to={`/apply/${app.id}`} className={buttonClass({ size: 'sm' })}>
            Continue
          </Link>
        )
      case 'prepared':
        return (
          <Link to={`/apply/${app.id}`} className={buttonClass({ size: 'sm' })}>
            Submit it
          </Link>
        )
      case 'assessment_pending':
        return (
          <Button size="sm" onClick={() => void assessmentDone(app)}>
            Mark done
          </Button>
        )
      default:
        return (
          <Link to="/board" className={buttonClass({ size: 'sm' })}>
            Open board
          </Link>
        )
    }
  }

  return (
    <Section title="Waiting on you" count={plan.waiting.length} description="Drafts, applications ready to submit, assessments and offers.">
      {plan.waiting.length === 0 ? (
        <Empty>Nothing is waiting on you.</Empty>
      ) : (
        <Rows>
          {plan.waiting.map(({ app, action }) => (
            <Row key={app.id} action={actionFor(app)}>
              <div className="flex flex-wrap items-center gap-2">
                <Heading company={app.company} title={app.title} to={`/jobs/${app.jobId}`} />
                <AppStatusBadge status={app.status} />
              </div>
              <Meta>{action.label}</Meta>
            </Row>
          ))}
        </Rows>
      )}
    </Section>
  )
}

function MatchesSection({
  plan,
  now,
  applications,
  hasProfile,
}: {
  plan: TodayPlan
  now: Date
  applications: Application[]
  hasProfile: boolean
}) {
  const { start, startingId } = useStartApplication()
  const more = plan.matchCount - plan.matches.length
  return (
    <Section
      title="Worth applying to"
      count={plan.matchCount}
      description="Queued jobs that pass the recency gate, in queue order: tier 1 first, then the newest."
    >
      {plan.matches.length === 0 ? (
        <Empty>
          {hasProfile ? (
            <>
              No queued job passes the gate right now.{' '}
              <Link to="/jobs" className="font-medium text-fg underline underline-offset-2">
                Look through all jobs
              </Link>
            </>
          ) : (
            <>
              Jobs are scored against your profile.{' '}
              <Link to="/profile" className="font-medium text-fg underline underline-offset-2">
                Add your profile
              </Link>
            </>
          )}
        </Empty>
      ) : (
        <>
          <Rows>
            {plan.matches.map(({ job, score }) => (
              <Row
                key={job.id}
                action={
                  <Button size="sm" disabled={startingId === job.id} onClick={() => void start(job, applications)}>
                    Start application
                  </Button>
                }
              >
                <div className="flex items-start gap-3">
                  <span className="w-9 shrink-0 pt-px text-right">
                    <ScoreMark score={score} />
                  </span>
                  <div className="min-w-0">
                    <Heading company={job.company} title={job.title} to={`/jobs/${job.id}`} />
                    <Meta>
                      {tierLabel(score.tier)} · {formatAge(job.postedAt, now)} · {WORKPLACE_LABEL[job.workplace]}
                    </Meta>
                  </div>
                </div>
              </Row>
            ))}
          </Rows>
          {more > 0 ? (
            <p className="border-t border-line px-4 py-3 text-[0.8125rem]">
              <Link to="/jobs?gate=apply" className="font-medium text-fg underline underline-offset-2">
                See {plural(more, 'more job')}
              </Link>
            </p>
          ) : null}
        </>
      )}
    </Section>
  )
}

function TargetCard({ submitted, target }: { submitted: number; target: number }) {
  return (
    <Card>
      <CardHeader title="Applications today" headingLevel="h2" />
      <div className="px-4 py-4">
        {target === 0 ? (
          <p className="text-[0.8125rem] text-fg-muted">
            No target today. {submitted > 0 ? `You submitted ${submitted}.` : 'Weekends are off by default.'}
          </p>
        ) : (
          <>
            <p className="text-sm text-fg">
              <span className="font-mono font-semibold tabular-nums">{submitted}</span>
              <span className="text-fg-muted"> of {target} submitted</span>
            </p>
            <div aria-hidden="true" className="mt-3 flex flex-wrap gap-1">
              {Array.from({ length: Math.max(target, submitted) }, (_, index) => (
                <span
                  key={index}
                  className={cx(
                    'flex size-5 items-center justify-center rounded-sm border',
                    index < submitted ? 'border-fg bg-fg text-surface' : 'border-line-strong',
                  )}
                >
                  {index < submitted ? <CheckIcon className="size-3.5" /> : null}
                </span>
              ))}
            </div>
            <p className="mt-3 text-xs text-fg-muted">A pace, not a quota. You submit every one yourself.</p>
          </>
        )}
      </div>
    </Card>
  )
}

function PracticeCard({ summary, error }: { summary: PracticeSummary | null; error: Error | null }) {
  return (
    <Card>
      <CardHeader title="Practice" />
      <div className="px-4 py-4">
        {summary ? (
          <>
            <dl className="grid grid-cols-3 gap-2 text-center">
              {[
                ['Due', summary.dueReviews],
                ['New', summary.unseen],
                ['Streak', summary.streak],
              ].map(([label, value]) => (
                <div key={label} className="rounded-md bg-surface-2 px-2 py-2">
                  <dt className="text-xs text-fg-muted">{label}</dt>
                  <dd className="font-mono text-base font-semibold text-fg tabular-nums">{value}</dd>
                </div>
              ))}
            </dl>
            <p className="mt-3 text-xs text-fg-muted">
              {summary.dueReviews > 0 ? `${plural(summary.dueReviews, 'card')} to review today. ` : 'No reviews due. '}
              {summary.streak > 0 ? `${plural(summary.streak, 'day')} in a row.` : ''}
            </p>
            <Link to="/practice" className={cx(buttonClass({ size: 'sm' }), 'mt-3 w-full')}>
              Open practice
            </Link>
          </>
        ) : error ? (
          <p className="text-[0.8125rem] break-words text-danger-ink">Couldn't load practice: {error.message}</p>
        ) : (
          <Skeleton className="h-24 w-full" />
        )}
      </div>
    </Card>
  )
}

function TodaySkeleton() {
  return (
    <div aria-busy="true" className="grid items-start gap-6 xl:grid-cols-[minmax(0,1fr)_18rem]">
      <span className="sr-only">Loading today</span>
      <div className="space-y-6">
        {[3, 2, 3].map((lines, index) => (
          <div key={index} className="rounded-lg border border-line bg-surface p-4">
            <Skeleton className="mb-4 h-4 w-40" />
            <SkeletonText lines={lines} />
          </div>
        ))}
      </div>
      <div className="space-y-6">
        <Skeleton className="h-32 w-full rounded-lg" />
        <Skeleton className="h-40 w-full rounded-lg" />
      </div>
    </div>
  )
}
