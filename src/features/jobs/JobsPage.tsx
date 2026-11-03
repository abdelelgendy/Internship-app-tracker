import { useMemo, useState, type KeyboardEvent, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router'
import { toMillis } from '../../engine/dates.ts'
import { byQueueOrder } from '../../engine/gates.ts'
import { canQueueTransition, isTerminal, QUEUE_STATUSES } from '../../engine/states.ts'
import type { Application, Job, QueueStatus, ScoreResult, Workplace } from '../../engine/types.ts'
import { useRepo, useRepoData } from '../../data/data-context.ts'
import { AppStatusBadge, QueueStatusBadge } from '../../ui/Badge.tsx'
import { Button } from '../../ui/Button.tsx'
import { Card } from '../../ui/Card.tsx'
import { cx } from '../../ui/cx.ts'
import { EmptyState } from '../../ui/EmptyState.tsx'
import { Input } from '../../ui/Input.tsx'
import { PageHeader } from '../../ui/PageHeader.tsx'
import { Select } from '../../ui/Select.tsx'
import { Skeleton } from '../../ui/Skeleton.tsx'
import { QUEUE_STATUS_DISPLAY } from '../../ui/status.ts'
import { useToast } from '../../ui/toast-context.ts'
import { AddJobDialog } from './AddJobDialog.tsx'
import { formatAge, formatAgeShort, plural, sourceLabel, WORKPLACE_LABEL } from './format.ts'
import { PlusIcon, SortIcon } from './icons.tsx'
import { scoreFor, tierLabel } from './jobView.ts'
import { LoadProblem } from './LoadProblem.tsx'
import { ScoreMark } from './ScoreParts.tsx'
import { useNow } from './useNow.ts'

interface JobRow {
  job: Job
  score: ScoreResult | null
  application?: Application
}

type SortKey = 'queue' | 'score' | 'company' | 'tier' | 'posted'

const SORT_TEXT: Record<SortKey, string> = {
  queue: 'queue order: tier, then newest, then score',
  score: 'score',
  company: 'company',
  tier: 'tier',
  posted: 'posting age',
}

const SKIPS: readonly QueueStatus[] = ['skipped_age', 'skipped_dealbreaker', 'skipped_duplicate', 'skipped_ghost']

const STATUS_FILTERS: { value: string; label: string; matches: (status: QueueStatus) => boolean }[] = [
  { value: 'active', label: 'Queued and shortlisted', matches: (status) => status === 'queued' || status === 'shortlisted' },
  { value: 'all', label: 'All statuses', matches: () => true },
  { value: 'skipped', label: 'Skipped, any reason', matches: (status) => SKIPS.includes(status) },
  ...QUEUE_STATUSES.map((status) => ({
    value: status,
    label: QUEUE_STATUS_DISPLAY[status].label,
    matches: (other: QueueStatus) => other === status,
  })),
]

const tierRank = (score: ScoreResult | null) => (score ? (score.tier ?? 4) : 5)

/**
 * The comparator for a sort. `descending` flips only the chosen key; ties fall back to queue
 * order, and a posting with no date always sorts after dated ones.
 */
function compareRows(key: SortKey, descending: boolean): (a: JobRow, b: JobRow) => number {
  const queue = (a: JobRow, b: JobRow) => byQueueOrder({ ...a.job, score: a.score ?? undefined }, { ...b.job, score: b.score ?? undefined })
  const sign = descending ? -1 : 1
  switch (key) {
    case 'queue':
      return queue
    case 'score':
      return (a, b) => sign * ((a.score?.total ?? -1) - (b.score?.total ?? -1)) || queue(a, b)
    case 'company':
      return (a, b) => sign * (a.job.company.localeCompare(b.job.company) || a.job.title.localeCompare(b.job.title))
    case 'tier':
      return (a, b) => sign * (tierRank(a.score) - tierRank(b.score)) || queue(a, b)
    case 'posted':
      return (a, b) => {
        const aMs = toMillis(a.job.postedAt)
        const bMs = toMillis(b.job.postedAt)
        if (aMs === null || bMs === null) return (aMs === null ? 1 : 0) - (bMs === null ? 1 : 0) || queue(a, b)
        // "Descending" age is newest first, so it compares the times the other way round.
        return sign * (aMs - bMs) * -1 || queue(a, b)
      }
  }
}

export function JobsPage() {
  const now = useNow()
  const repo = useRepo()
  const toast = useToast()
  const [params, setParams] = useSearchParams()
  const [adding, setAdding] = useState(false)
  const [selected, setSelected] = useState<ReadonlySet<string>>(new Set())
  const jobs = useRepoData('jobs', (r) => r.listJobs())
  const applications = useRepoData('applications', (r) => r.listApplications())
  const profile = useRepoData('profile', (r) => r.getProfile())

  const filters = {
    q: params.get('q') ?? '',
    status: params.get('status') ?? 'active',
    tier: params.get('tier') ?? 'all',
    workplace: params.get('workplace') ?? 'all',
    source: params.get('source') ?? 'all',
    gate: params.get('gate') === 'apply',
  }
  const sortKey = (params.get('sort') as SortKey | null) ?? 'queue'
  const descending = params.get('dir') === 'desc'

  function setParam(name: string, value: string | null) {
    setParams(
      (current) => {
        const next = new URLSearchParams(current)
        if (value === null || value === '') next.delete(name)
        else next.set(name, value)
        return next
      },
      { replace: true },
    )
  }

  const rows = useMemo<JobRow[]>(() => {
    if (!jobs.data || profile.data === undefined) return []
    const openApps = new Map((applications.data ?? []).filter((app) => !isTerminal(app.status)).map((app) => [app.jobId, app]))
    const latestApps = new Map((applications.data ?? []).map((app) => [app.jobId, app]))
    return jobs.data.map((job) => ({
      job,
      score: scoreFor(job, profile.data ?? null, now),
      application: openApps.get(job.id) ?? latestApps.get(job.id),
    }))
  }, [jobs.data, applications.data, profile.data, now])

  const sources = useMemo(() => [...new Set(rows.map((row) => row.job.source))].sort(), [rows])

  const visible = useMemo(() => {
    const statusFilter = STATUS_FILTERS.find((entry) => entry.value === filters.status) ?? STATUS_FILTERS[0]
    const query = filters.q.trim().toLowerCase()
    const result = rows.filter(
      ({ job, score }) =>
        statusFilter.matches(job.status) &&
        (filters.tier === 'all' || (filters.tier === 'none' ? score?.tier === null : String(score?.tier) === filters.tier)) &&
        (filters.workplace === 'all' || job.workplace === filters.workplace) &&
        (filters.source === 'all' || job.source === filters.source) &&
        (!filters.gate || score?.gate.verdict === 'apply') &&
        (!query || `${job.company} ${job.title} ${job.location}`.toLowerCase().includes(query)),
    )
    return result.sort(compareRows(sortKey, descending))
  }, [rows, filters.status, filters.q, filters.tier, filters.workplace, filters.source, filters.gate, sortKey, descending])

  const visibleIds = visible.map((row) => row.job.id)
  const selectedVisible = visibleIds.filter((id) => selected.has(id))
  const filtered =
    filters.q !== '' ||
    filters.status !== 'active' ||
    filters.tier !== 'all' ||
    filters.workplace !== 'all' ||
    filters.source !== 'all' ||
    filters.gate

  function toggleSort(key: SortKey) {
    // Score and age start high-to-low and newest-first; text starts A to Z.
    const naturalDesc = key === 'score' || key === 'posted'
    const nextDesc = sortKey === key ? !descending : naturalDesc
    setParams(
      (current) => {
        const next = new URLSearchParams(current)
        next.set('sort', key)
        next.set('dir', nextDesc ? 'desc' : 'asc')
        return next
      },
      { replace: true },
    )
  }

  function ariaSort(key: SortKey): 'ascending' | 'descending' | 'none' {
    if (sortKey !== key) return 'none'
    return descending ? 'descending' : 'ascending'
  }

  async function bulkMove(to: 'shortlisted' | 'archived') {
    const chosen = rows.filter((row) => selected.has(row.job.id)).map((row) => row.job)
    const movable = chosen.filter((job) => job.status !== to && canQueueTransition(job.status, to))
    const blocked = chosen.filter((job) => job.status !== to && !canQueueTransition(job.status, to))
    if (movable.length === 0) {
      toast.show({
        title: to === 'shortlisted' ? 'Nothing to shortlist' : 'Nothing to skip',
        description:
          blocked.length > 0
            ? 'Archived and expired jobs go back to the queue before they can be shortlisted.'
            : 'The selected jobs are already there.',
      })
      return
    }
    try {
      await repo.saveJobs(movable.map((job) => ({ ...job, status: to })))
      setSelected(new Set())
      const verb = to === 'shortlisted' ? 'Shortlisted' : 'Skipped'
      toast.show({
        title: `${verb} ${plural(movable.length, 'job')}`,
        description:
          blocked.length > 0
            ? `${plural(blocked.length, 'job')} stayed put: archived and expired jobs go back to the queue first.`
            : to === 'archived'
              ? 'Skipped jobs move to Archived. You can bring them back.'
              : undefined,
        tone: 'success',
        action: { label: 'Undo', onAction: () => void repo.saveJobs(movable) },
      })
    } catch (error) {
      toast.show({ title: "Couldn't update the jobs", description: error instanceof Error ? error.message : String(error), tone: 'danger' })
    }
  }

  function moveRowFocus(event: KeyboardEvent<HTMLTableSectionElement>) {
    const keys = ['ArrowDown', 'ArrowUp', 'Home', 'End']
    if (!keys.includes(event.key) || (event.target as HTMLElement).tagName === 'INPUT') return
    const links = Array.from(event.currentTarget.querySelectorAll<HTMLAnchorElement>('a[data-row-link]'))
    const current = links.findIndex((link) => link.closest('tr')?.contains(event.target as Node))
    const next = { ArrowDown: current + 1, ArrowUp: current - 1, Home: 0, End: links.length - 1 }[event.key] ?? current
    if (next < 0 || next >= links.length) return
    event.preventDefault()
    links[next].focus()
  }

  const loadError = [jobs, applications, profile].find((result) => result.error && result.data === undefined)
  const header = (
    <PageHeader
      title="Jobs"
      description="Postings from the scanner or added by hand, each scored for fit. Arrow keys move between rows."
      actions={
        <Button variant="primary" onClick={() => setAdding(true)} disabled={!jobs.data}>
          <PlusIcon />
          Add job
        </Button>
      }
    />
  )

  if (loadError?.error) {
    return (
      <>
        {header}
        <LoadProblem what="jobs" error={loadError.error} onRetry={loadError.reload} />
      </>
    )
  }

  return (
    <>
      {header}
      <AddJobDialog open={adding} onClose={() => setAdding(false)} jobs={jobs.data ?? []} profile={profile.data ?? null} now={now} />

      <div className="mb-4 flex flex-wrap items-end gap-2" role="search" aria-label="Filter jobs">
        <Input
          type="search"
          aria-label="Search company, title or location"
          placeholder="Search company, title or location"
          className="min-w-0 flex-[1_1_14rem]"
          value={filters.q}
          onChange={(event) => setParam('q', event.target.value)}
        />
        <FilterSelect label="Status" value={filters.status} onChange={(value) => setParam('status', value === 'active' ? null : value)}>
          {STATUS_FILTERS.map((entry) => (
            <option key={entry.value} value={entry.value}>
              {entry.label}
            </option>
          ))}
        </FilterSelect>
        <FilterSelect label="Tier" value={filters.tier} onChange={(value) => setParam('tier', value === 'all' ? null : value)}>
          <option value="all">Any tier</option>
          <option value="1">Tier 1, entry level</option>
          <option value="2">Tier 2</option>
          <option value="3">Tier 3, a stretch</option>
          <option value="none">Disqualified</option>
        </FilterSelect>
        <FilterSelect
          label="Workplace"
          value={filters.workplace}
          onChange={(value) => setParam('workplace', value === 'all' ? null : value)}
        >
          <option value="all">Any workplace</option>
          {(Object.keys(WORKPLACE_LABEL) as Workplace[]).map((workplace) => (
            <option key={workplace} value={workplace}>
              {WORKPLACE_LABEL[workplace]}
            </option>
          ))}
        </FilterSelect>
        <FilterSelect label="Source" value={filters.source} onChange={(value) => setParam('source', value === 'all' ? null : value)}>
          <option value="all">Any source</option>
          {sources.map((source) => (
            <option key={source} value={source}>
              {sourceLabel(source)}
            </option>
          ))}
        </FilterSelect>
        <label className="flex h-9 items-center gap-2 rounded-md px-1 text-[0.8125rem] text-fg">
          <input type="checkbox" checked={filters.gate} onChange={(event) => setParam('gate', event.target.checked ? 'apply' : null)} />
          Passes the gate
        </label>
        {filtered ? (
          <Button variant="ghost" onClick={() => setParams(new URLSearchParams(), { replace: true })}>
            Clear filters
          </Button>
        ) : null}
      </div>

      <div className="mb-2 flex min-h-8 flex-wrap items-center justify-between gap-x-4 gap-y-2 text-[0.8125rem] text-fg-muted">
        <p aria-live="polite">
          {jobs.data ? (
            <>
              Showing <span className="font-mono text-fg tabular-nums">{visible.length}</span> of{' '}
              <span className="font-mono text-fg tabular-nums">{rows.length}</span>, sorted by {SORT_TEXT[sortKey]}.
            </>
          ) : (
            'Loading jobs'
          )}
          {sortKey !== 'queue' ? (
            <>
              {' '}
              <button
                type="button"
                className="font-medium text-fg underline underline-offset-2"
                onClick={() =>
                  setParams(
                    (current) => {
                      const next = new URLSearchParams(current)
                      next.delete('sort')
                      next.delete('dir')
                      return next
                    },
                    { replace: true },
                  )
                }
              >
                Back to queue order
              </button>
            </>
          ) : null}
        </p>
        {selectedVisible.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Bulk actions">
            <span className="text-fg">{selectedVisible.length} selected</span>
            <Button size="sm" onClick={() => void bulkMove('shortlisted')}>
              Shortlist
            </Button>
            <Button size="sm" onClick={() => void bulkMove('archived')}>
              Skip
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setSelected(new Set())}>
              Clear
            </Button>
          </div>
        ) : null}
      </div>

      {!jobs.data ? (
        <JobsSkeleton />
      ) : rows.length === 0 ? (
        <EmptyState
          title="No jobs yet"
          description="Add a posting by hand, or run the scanner to pull new ones from the boards on your watchlist."
          action={
            <Button variant="primary" onClick={() => setAdding(true)}>
              <PlusIcon />
              Add job
            </Button>
          }
        />
      ) : visible.length === 0 ? (
        <EmptyState
          title="No jobs match these filters"
          description="Loosen a filter, or clear them all to see the active queue."
          action={<Button onClick={() => setParams(new URLSearchParams(), { replace: true })}>Clear filters</Button>}
        />
      ) : (
        <Card className="overflow-x-auto">
          <table className="w-full border-collapse text-left text-sm">
            <caption className="sr-only">Jobs, sorted by {SORT_TEXT[sortKey]}</caption>
            <thead className="border-b border-line text-xs text-fg-muted">
              <tr>
                <th scope="col" className="w-10 py-2 pr-1 pl-4">
                  <input
                    type="checkbox"
                    aria-label="Select all shown jobs"
                    checked={selectedVisible.length > 0 && selectedVisible.length === visibleIds.length}
                    ref={(node) => {
                      if (node) node.indeterminate = selectedVisible.length > 0 && selectedVisible.length < visibleIds.length
                    }}
                    onChange={(event) => setSelected(event.target.checked ? new Set(visibleIds) : new Set())}
                  />
                </th>
                <SortHeader label="Score" sort={ariaSort('score')} onClick={() => toggleSort('score')} className="w-16 text-right" />
                <SortHeader label="Job" sort={ariaSort('company')} onClick={() => toggleSort('company')} />
                <th scope="col" className="hidden px-3 py-2 font-medium md:table-cell">
                  Status
                </th>
                <SortHeader label="Tier" sort={ariaSort('tier')} onClick={() => toggleSort('tier')} className="hidden md:table-cell" />
                <SortHeader
                  label="Posted"
                  sort={ariaSort('posted')}
                  onClick={() => toggleSort('posted')}
                  className="hidden md:table-cell"
                />
                <th scope="col" className="hidden px-3 py-2 font-medium md:table-cell">
                  Source
                </th>
                <th scope="col" className="hidden py-2 pr-4 pl-3 font-medium md:table-cell">
                  Workplace
                </th>
              </tr>
            </thead>
            <tbody onKeyDown={moveRowFocus} className="divide-y divide-line">
              {visible.map(({ job, score, application }) => {
                const isSelected = selected.has(job.id)
                return (
                  <tr key={job.id} className={cx('align-top', isSelected ? 'bg-accent-soft' : 'hover:bg-surface-2/60')}>
                    <td className="py-3 pr-1 pl-4">
                      <input
                        type="checkbox"
                        aria-label={`Select ${job.company}, ${job.title}`}
                        checked={isSelected}
                        onChange={(event) =>
                          setSelected((current) => {
                            const next = new Set(current)
                            if (event.target.checked) next.add(job.id)
                            else next.delete(job.id)
                            return next
                          })
                        }
                      />
                    </td>
                    <td className="px-3 py-3 text-right">
                      <ScoreMark score={score} />
                    </td>
                    <td className="min-w-48 px-3 py-3">
                      <Link
                        to={`/jobs/${job.id}`}
                        data-row-link
                        className="font-medium break-words text-fg underline-offset-2 hover:underline"
                      >
                        {job.title}
                      </Link>
                      <p className="text-[0.8125rem] break-words text-fg-muted">{job.company}</p>
                      <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-fg-muted md:hidden">
                        <QueueStatusBadge status={job.status} />
                        {application ? <AppStatusBadge status={application.status} /> : null}
                        <span>{score ? tierLabel(score.tier) : 'Unscored'}</span>
                        <span>{formatAge(job.postedAt, now)}</span>
                        <span>{WORKPLACE_LABEL[job.workplace]}</span>
                        <span>{sourceLabel(job.source)}</span>
                      </p>
                    </td>
                    <td className="hidden px-3 py-3 md:table-cell">
                      <div className="flex flex-wrap gap-1">
                        <QueueStatusBadge status={job.status} />
                        {application ? <AppStatusBadge status={application.status} /> : null}
                      </div>
                    </td>
                    <td className="hidden px-3 py-3 whitespace-nowrap text-fg-muted md:table-cell">
                      {score ? tierLabel(score.tier) : 'Unscored'}
                    </td>
                    <td className="hidden px-3 py-3 font-mono whitespace-nowrap text-fg-muted tabular-nums md:table-cell">
                      {formatAgeShort(job.postedAt, now)}
                    </td>
                    <td className="hidden px-3 py-3 whitespace-nowrap text-fg-muted md:table-cell">{sourceLabel(job.source)}</td>
                    <td className="hidden py-3 pr-4 pl-3 whitespace-nowrap text-fg-muted md:table-cell">
                      {WORKPLACE_LABEL[job.workplace]}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </Card>
      )}
    </>
  )
}

function FilterSelect({
  label,
  value,
  onChange,
  children,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  children: ReactNode
}) {
  return (
    <Select
      aria-label={label}
      value={value}
      onChange={(event) => onChange(event.target.value)}
      className="w-auto max-w-full flex-[0_1_auto]"
    >
      {children}
    </Select>
  )
}

function SortHeader({
  label,
  sort,
  onClick,
  className,
}: {
  label: string
  sort: 'ascending' | 'descending' | 'none'
  onClick: () => void
  className?: string
}) {
  return (
    <th scope="col" aria-sort={sort} className={cx('px-3 py-2 font-medium', className)}>
      <button
        type="button"
        onClick={onClick}
        className={cx('inline-flex items-center gap-1 rounded-sm hover:text-fg', sort !== 'none' && 'text-fg')}
      >
        {label}
        <SortIcon direction={sort} className="size-3.5" />
      </button>
    </th>
  )
}

function JobsSkeleton() {
  return (
    <div aria-busy="true" className="rounded-lg border border-line bg-surface">
      <span className="sr-only">Loading jobs</span>
      {Array.from({ length: 6 }, (_, index) => (
        <div key={index} className="flex items-center gap-4 border-b border-line px-4 py-3.5 last:border-b-0">
          <Skeleton className="size-4" />
          <Skeleton className="h-4 w-8" />
          <div className="min-w-0 flex-1 space-y-1.5">
            <Skeleton className="h-4 w-2/5" />
            <Skeleton className="h-3 w-1/4" />
          </div>
          <Skeleton className="hidden h-5 w-20 md:block" />
        </div>
      ))}
    </div>
  )
}
