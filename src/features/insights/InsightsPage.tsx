import { useMemo } from 'react'
import { Link } from 'react-router'
import { defaultTimeZone } from '../../engine/dates.ts'
import { MIN_SAMPLE } from '../../engine/stats.ts'
import { useRepoData } from '../../data/data-context.ts'
import { AppStatusBadge } from '../../ui/Badge.tsx'
import { Card, CardHeader } from '../../ui/Card.tsx'
import { EmptyState } from '../../ui/EmptyState.tsx'
import { PageHeader } from '../../ui/PageHeader.tsx'
import { Skeleton, SkeletonText } from '../../ui/Skeleton.tsx'
import { buttonClass } from '../../ui/styles.ts'
import { LoadProblem } from '../../ui/LoadProblem.tsx'
import { useNow } from '../jobs/useNow.ts'
import { DIMENSION_IDS, funnelOf, headline, percent, rateText, segmentOf, weeklyCounts, type Funnel, type Segment, type SegmentGroup } from './insightsModel.ts'
import { WeeklyChart } from './WeeklyChart.tsx'

export function InsightsPage() {
  const now = useNow()
  const timeZone = defaultTimeZone()
  const jobs = useRepoData('jobs', (repo) => repo.listJobs())
  const applications = useRepoData('applications', (repo) => repo.listApplications())

  const view = useMemo(() => {
    if (!jobs.data || !applications.data) return null
    return {
      funnel: funnelOf(applications.data),
      weeks: weeklyCounts(applications.data, now, timeZone),
      segments: DIMENSION_IDS.map((id) => segmentOf(id, applications.data ?? [], jobs.data ?? [])),
    }
  }, [jobs.data, applications.data, now, timeZone])

  const failed = [jobs, applications].find((result) => result.error && result.data === undefined)
  if (failed?.error) {
    return (
      <>
        <PageHeader title="Insights" />
        <LoadProblem what="your applications" error={failed.error} onRetry={failed.reload} />
      </>
    )
  }

  if (view && applications.data?.length === 0) {
    return (
      <>
        <PageHeader title="Insights" />
        <EmptyState
          title="No applications yet"
          description="Insights count what happens to the applications you send: replies, interviews and offers. Start one from a job you like."
          action={
            <Link to="/jobs" className={buttonClass({ variant: 'primary' })}>
              Browse jobs
            </Link>
          }
        />
      </>
    )
  }

  return (
    <>
      <PageHeader title="Insights" description={view ? headline(view.funnel) : 'Counting your applications.'} />
      {view ? (
        <div className="space-y-6">
          <div className="grid items-start gap-6 xl:grid-cols-2">
            <FunnelCard funnel={view.funnel} />
            <Card role="region" aria-label="Applications per week">
              <CardHeader title="Applications per week" description="Sent applications, Monday to Sunday, for the last 12 weeks." />
              <WeeklyChart weeks={view.weeks} />
            </Card>
          </div>
          <SegmentsCard segments={view.segments} />
        </div>
      ) : (
        <InsightsSkeleton />
      )}
    </>
  )
}

// ---------- Funnel ----------

function FunnelCard({ funnel }: { funnel: Funnel }) {
  const sent = funnel.stages[0].count
  return (
    <Card role="region" aria-label="From sent to offer">
      <CardHeader title="From sent to offer" description="How many sent applications reached each step." />
      <ol className="space-y-4 p-4">
        {funnel.stages.map((stage) => {
          const share = stage.id === 'submitted' ? null : stage.rate.shown && stage.rate.rate !== null ? percent(stage.rate.rate) : null
          return (
            <li key={stage.id}>
              <div className="flex flex-wrap items-baseline justify-between gap-x-3">
                <span className="text-sm text-fg">{stage.label}</span>
                <span className="text-sm text-fg-muted">
                  <span className="font-mono font-semibold text-fg tabular-nums">{stage.count}</span>
                  {share ? <span className="ml-1.5 tabular-nums">{share} of sent</span> : null}
                </span>
              </div>
              <div className="mt-1.5 h-3 rounded-r bg-surface-2" aria-hidden="true">
                <div className="h-3 rounded-r bg-accent-ink" style={{ width: `${sent > 0 ? (stage.count / sent) * 100 : 0}%` }} />
              </div>
            </li>
          )
        })}
      </ol>
      <div className="border-t border-line px-4 py-3">
        <p className="text-[0.8125rem] text-fg-muted">
          {sent < MIN_SAMPLE ? `Shares show from ${MIN_SAMPLE} sent. ` : ''}
          {funnel.awaitingReply} waiting on a reply{funnel.unsent > 0 ? `, ${funnel.unsent} not sent yet` : ''}.
        </p>
        <h3 className="mt-3 text-xs font-semibold text-fg-muted">Where they are now</h3>
        <ul className="mt-1.5 flex flex-wrap gap-x-3 gap-y-2" aria-label="Applications by status">
          {funnel.byStatus.map(({ status, count }) => (
            <li key={status} className="flex items-center gap-1.5">
              <AppStatusBadge status={status} />
              <span className="font-mono text-[0.8125rem] text-fg tabular-nums">{count}</span>
            </li>
          ))}
        </ul>
      </div>
    </Card>
  )
}

// ---------- Reply rate by group ----------

function SegmentsCard({ segments }: { segments: Segment[] }) {
  return (
    <Card role="region" aria-label="Reply rate by group">
      <CardHeader
        title="Reply rate by group"
        description={`A rate shows once a group has ${MIN_SAMPLE} sent applications, with the range it likely falls in (95% of the time). Fewer than that and a difference is mostly chance, so only the counts show.`}
      />
      <div className="grid gap-x-8 gap-y-6 p-4 xl:grid-cols-2">
        {segments.map((segment) => (
          <section key={segment.id} aria-labelledby={`segment-${segment.id}`} className="min-w-0">
            <h3 id={`segment-${segment.id}`} className="text-[0.8125rem] font-semibold text-fg">
              {segment.title}
            </h3>
            {segment.groups.length === 0 ? (
              <p className="mt-2 text-[0.8125rem] text-fg-muted">No sent applications have this detail yet.</p>
            ) : (
              <ul className="mt-2 divide-y divide-line border-y border-line">
                {segment.groups.map((group) => (
                  <GroupRow key={group.key} group={group} />
                ))}
              </ul>
            )}
            {segment.comparison ? <p className="mt-2 text-[0.8125rem] text-fg-muted">{segment.comparison}</p> : null}
            {segment.missingNote ? <p className="mt-2 text-[0.8125rem] text-fg-subtle">{segment.missingNote}</p> : null}
          </section>
        ))}
      </div>
    </Card>
  )
}

function GroupRow({ group }: { group: SegmentGroup }) {
  const { rate } = group
  const text = rateText(rate)
  const counts = `${rate.n} sent, ${rate.successes} ${rate.successes === 1 ? 'reply' : 'replies'}`
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-1.5 py-2.5">
      <span className="min-w-0 flex-1 basis-40 text-sm break-words text-fg">{group.label}</span>
      {text && rate.rate !== null && rate.interval ? (
        <span className="flex min-w-0 flex-1 basis-56 flex-wrap items-center gap-x-3 gap-y-1.5">
          <span className="text-[0.8125rem] text-fg-muted">
            <span className="font-mono font-semibold text-fg tabular-nums">{percent(rate.rate)}</span>
            <span className="ml-1.5 tabular-nums">
              likely {percent(rate.interval.low)} to {percent(rate.interval.high)}
            </span>
            <span className="ml-1.5 tabular-nums text-fg-subtle">({counts})</span>
          </span>
          <RangeBar rate={rate.rate} low={rate.interval.low} high={rate.interval.high} />
        </span>
      ) : (
        <span className="flex-1 basis-56 text-[0.8125rem] text-fg-muted">
          <span className="tabular-nums">{counts}.</span>{' '}
          <span className="text-fg-subtle tabular-nums">Rate shows at {MIN_SAMPLE}, {MIN_SAMPLE - rate.n} to go.</span>
        </span>
      )}
    </li>
  )
}

/** The likely range as a band on a 0 to 100% track, with the measured rate as a dot. The text beside it carries the numbers. */
function RangeBar({ rate, low, high }: { rate: number; low: number; high: number }) {
  return (
    <span className="relative block h-2.5 w-full min-w-24 flex-1 basis-28 rounded-full bg-surface-2" aria-hidden="true">
      <span className="absolute inset-y-0 rounded-full bg-accent-ink/30" style={{ left: `${low * 100}%`, width: `${(high - low) * 100}%` }} />
      <span className="absolute top-1/2 size-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-accent-ink ring-2 ring-surface" style={{ left: `${rate * 100}%` }} />
    </span>
  )
}

// ---------- Loading ----------

function InsightsSkeleton() {
  return (
    <div className="space-y-6" aria-busy="true">
      <div className="grid items-start gap-6 xl:grid-cols-2">
        {[0, 1].map((index) => (
          <Card key={index}>
            <div className="border-b border-line px-4 py-3">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="mt-1.5 h-3 w-64 max-w-full" />
            </div>
            <div className="space-y-4 p-4">
              {[0, 1, 2, 3].map((row) => (
                <div key={row}>
                  <Skeleton className="h-3 w-32" />
                  <Skeleton className="mt-2 h-3 w-full" />
                </div>
              ))}
            </div>
          </Card>
        ))}
      </div>
      <Card>
        <div className="border-b border-line px-4 py-3">
          <Skeleton className="h-4 w-36" />
          <SkeletonText lines={2} className="mt-2" />
        </div>
        <div className="grid gap-x-8 gap-y-6 p-4 xl:grid-cols-2">
          {[0, 1, 2, 3].map((index) => (
            <SkeletonText key={index} lines={3} />
          ))}
        </div>
      </Card>
    </div>
  )
}
