/** Scores every job in the data folder again with the current rubric, and optionally resets rule-made statuses. */
import { plural, parseFlags, runMain, UsageError } from './lib/cli.ts'
import type { Job } from '../src/engine/types.ts'
import { loadData, prepareDataDir, resolveDataDir, updateRows } from './lib/data-dir.ts'
import { rescoreJobs } from './lib/rescore.ts'

const USAGE = `Usage: npm run score -- [--set-status] [--dry-run] [--data <folder>]

  --set-status   also move queued and rule-skipped jobs to the status the rules give now.
                 Leave it off if you moved a skipped job back by hand: it would be skipped again.
  --dry-run      print what would change and write nothing`

runMain(USAGE, async () => {
  const { values } = parseFlags(process.argv.slice(2), { 'set-status': { type: 'boolean' }, 'dry-run': { type: 'boolean' } })
  if (values.help) {
    console.log(USAGE)
    return 0
  }
  const dir = await resolveDataDir(typeof values.data === 'string' ? values.data : undefined)
  const dryRun = values['dry-run'] === true
  if (!dryRun) await prepareDataDir(dir)
  const data = await loadData(dir)
  if (!data.profile) throw new UsageError(`No profile.json in ${dir}. Scores compare each job with your profile, so add one first (npm run import:jobhunter, or the Profile page).`)
  if (data.jobs.length === 0) {
    console.log(`No jobs in ${dir}.`)
    return 0
  }

  const setStatus = values['set-status'] === true
  const profile = data.profile
  const rescore = (jobs: readonly Job[]) => rescoreJobs(jobs, data.applications, profile, new Date(), { setStatus })
  let result = rescore(data.jobs)
  // Scored again from the rows as they are at write time, so an edit made in the app meanwhile
  // is kept: only the score and, with --set-status, the status change.
  if (!dryRun) {
    await updateRows<Job>(dir, 'jobs.jsonl', (current) => {
      result = rescore(current)
      return result.jobs
    })
  }

  const { apply, hold, skip } = result.verdicts
  console.log(`${dryRun ? 'Would score' : 'Scored'} ${plural(result.jobs.length, 'job')}: ${apply} to apply to now, ${hold} on hold, ${skip} skipped.`)
  for (const { job, before, after } of result.moved.slice(0, 10)) {
    console.log(`  ${before === null ? 'new' : String(before).padStart(3)} -> ${String(after).padStart(3)}  ${job.title} at ${job.company}`)
  }
  if (result.moved.length > 10) console.log(`  and ${result.moved.length - 10} more`)
  if (result.statusChanges.length > 0) {
    const applied = setStatus && !dryRun
    console.log(`\n${applied ? 'Moved' : 'The rules would move'} ${plural(result.statusChanges.length, 'job')}:`)
    for (const { job, from, to } of result.statusChanges) console.log(`  ${from} -> ${to}  ${job.title} at ${job.company}`)
    if (!setStatus) console.log('Run with --set-status to move them.')
  }
  if (data.issues.length > 0) console.log(`\n${plural(data.issues.length, 'line')} in the data files could not be read and were left as they are.`)
  return 0
})
