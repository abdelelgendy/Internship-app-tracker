/** Writes applications to <data folder>/applications.csv for a spreadsheet, or prints them with --stdout. */
import path from 'node:path'
import { outcomeSummary } from '../src/engine/stats.ts'
import { parseFlags, plural, runMain, timeZoneFrom, UsageError } from './lib/cli.ts'
import { applicationsCsv } from './lib/csv.ts'
import { gitWouldCommit, loadData, prepareDataDir, REPO_ROOT, resolveDataDir, writeAtomic } from './lib/data-dir.ts'

const USAGE = `Usage: npm run export:csv -- [--out <file>] [--stdout] [--tz <zone>] [--data <folder>]

  --out <file>  where to write (default: applications.csv in the data folder).
                A file git would commit is refused: the CSV holds your application history.
  --stdout      print the CSV instead of writing a file`

runMain(USAGE, async () => {
  const { values } = parseFlags(process.argv.slice(2), { out: { type: 'string' }, stdout: { type: 'boolean' } })
  if (values.help) {
    console.log(USAGE)
    return 0
  }
  const timeZone = timeZoneFrom(typeof values.tz === 'string' ? values.tz : undefined)
  const dir = await resolveDataDir(typeof values.data === 'string' ? values.data : undefined)
  const data = await loadData(dir)
  const csv = applicationsCsv(data.applications, data.jobs, data.profile, { now: new Date(), timeZone })
  if (values.stdout === true) {
    process.stdout.write(csv)
    return 0
  }

  const out = typeof values.out === 'string' ? path.resolve(values.out) : path.join(dir, 'applications.csv')
  if (typeof values.out !== 'string') await prepareDataDir(dir)
  else if (await gitWouldCommit(out, REPO_ROOT, 'file')) {
    throw new UsageError(`${out} is a file git would commit. Write the CSV outside the repo or into the data folder.`)
  }
  await writeAtomic(out, csv)

  const summary = outcomeSummary(data.applications)
  console.log(`Wrote ${plural(data.applications.length, 'application')} to ${out}`)
  console.log(`Submitted: ${summary.submitted}. Waiting on a reply: ${summary.awaitingReply}. Replies: ${summary.response.note}`)
  return 0
})
