/** Writes the Today view as Markdown to <data folder>/digest.md, or prints it with --stdout. */
import path from 'node:path'
import { parseFlags, runMain, timeZoneFrom } from './lib/cli.ts'
import { loadData, prepareDataDir, resolveDataDir, saveText } from './lib/data-dir.ts'
import { renderDigest } from './lib/digest.ts'
import { planToday, practiceSummary } from '../src/features/today/todayModel.ts'

const USAGE = `Usage: npm run digest -- [--stdout] [--tz <zone>] [--data <folder>]

  --stdout     print the digest instead of writing digest.md
  --tz <zone>  the time zone for "today" (default: TZ, else this computer's)`

runMain(USAGE, async () => {
  const { values } = parseFlags(process.argv.slice(2), { stdout: { type: 'boolean' } })
  if (values.help) {
    console.log(USAGE)
    return 0
  }
  const timeZone = timeZoneFrom(typeof values.tz === 'string' ? values.tz : undefined)
  const dir = await resolveDataDir(typeof values.data === 'string' ? values.data : undefined)
  const toStdout = values.stdout === true
  if (!toStdout) await prepareDataDir(dir)
  const data = await loadData(dir)
  const now = new Date()
  const plan = planToday(data.applications, data.jobs, data.profile, now, timeZone)
  const practice = data.decks.length > 0 ? practiceSummary(data.decks, data.progress, now, timeZone) : null
  const markdown = renderDigest(plan, practice, data.profile, { now, timeZone })
  if (toStdout) {
    process.stdout.write(markdown)
    return 0
  }
  await saveText(dir, 'digest.md', markdown)
  console.log(`Wrote ${path.join(dir, 'digest.md')}`)
  return 0
})
