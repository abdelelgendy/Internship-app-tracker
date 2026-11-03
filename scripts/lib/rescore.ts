/**
 * Scores every job again with the current rubric and clock. Statuses change only when asked,
 * and only for jobs the rules own (queued or skipped by a rule): a job a person shortlisted,
 * archived or marked expired, and any job with an application, keeps its status.
 */
import type { Instant } from '../../src/engine/dates.ts'
import { queueStatusFor } from '../../src/engine/gates.ts'
import { scoreJob } from '../../src/engine/score.ts'
import type { Application, Job, Profile, QueueStatus, ScoreResult } from '../../src/engine/types.ts'
import { duplicateOf, ghostFor } from '../../src/features/jobs/jobView.ts'

const RULE_STATUSES: readonly QueueStatus[] = ['queued', 'skipped_age', 'skipped_dealbreaker', 'skipped_duplicate', 'skipped_ghost']

export interface StatusChange {
  job: Job
  from: QueueStatus
  to: QueueStatus
}

export interface Rescore {
  /** Every job with its new score, and its new status when statuses were set. */
  jobs: Job[]
  verdicts: Record<ScoreResult['gate']['verdict'], number>
  /** Status moves the rules suggest; applied only with setStatus. */
  statusChanges: StatusChange[]
  /** Jobs whose total moved, with the old total (null when it had none). */
  moved: { job: Job; before: number | null; after: number }[]
}

export function rescoreJobs(
  jobs: readonly Job[],
  applications: readonly Pick<Application, 'jobId'>[],
  profile: Profile,
  now: Instant,
  options: { setStatus: boolean },
): Rescore {
  const applied = new Set(applications.map((app) => app.jobId))
  const verdicts = { apply: 0, hold: 0, skip: 0 }
  const statusChanges: StatusChange[] = []
  const moved: Rescore['moved'] = []
  const scored = jobs.map((job) => {
    const score = scoreJob(job, profile, now)
    verdicts[score.gate.verdict] += 1
    const before = job.score?.total ?? null
    if (before !== score.total) moved.push({ job, before, after: score.total })
    const next: Job = { ...job, score }
    if (!RULE_STATUSES.includes(job.status) || applied.has(job.id)) return next
    const to = queueStatusFor(score, { duplicate: duplicateOf(job, jobs) !== null, ghost: ghostFor(job, jobs) })
    if (to === job.status) return next
    statusChanges.push({ job, from: job.status, to })
    return options.setStatus ? { ...next, status: to } : next
  })
  moved.sort((a, b) => Math.abs(b.after - (b.before ?? 0)) - Math.abs(a.after - (a.before ?? 0)))
  return { jobs: scored, verdicts, statusChanges, moved }
}
