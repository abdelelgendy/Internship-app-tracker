/**
 * Scans the watchlist's public job boards (Greenhouse, Ashby, Lever) and saves new postings,
 * scored, to jobs.jsonl. It only reads public board APIs; it never logs in or applies.
 */
import path from 'node:path'
import type { Job } from '../src/engine/types.ts'
import { parseFlags, plural, runMain, UsageError } from './lib/cli.ts'
import { loadData, prepareDataDir, resolveDataDir, saveRows } from './lib/data-dir.ts'
import { httpFetcher, pickCompanies, savedResponses, scanBoards, type CompanyScan } from './lib/scan.ts'

const USAGE = `Usage: npm run scan -- [--company <name>]... [--dry-run] [--responses <folder>] [--data <folder>]

  --company <name>     scan only this watchlist company (repeat for more)
  --dry-run            print what would be saved and write nothing
  --responses <folder> read saved API responses (<ats>-<slug>.json) instead of the network
  --concurrency <n>    boards fetched at once (default 6)
  --timeout <seconds>  give up on a board after this long (default 10)`

function why(job: Job): string {
  if (job.status === 'skipped_duplicate') return job.notes?.match(/Same company and title as a posting [^.]*\./)?.[0] ?? 'A duplicate.'
  if (!job.score) return job.status === 'skipped_ghost' ? 'Reads like an evergreen posting.' : 'Not scored: add a profile, then run npm run score.'
  if (job.score.disqualifiers.length > 0) return job.score.disqualifiers.join(' ')
  if (job.status === 'skipped_ghost') return `Reads like an evergreen posting. ${job.score.gate.reason}`
  return job.score.gate.reason
}

function companyLine(scan: CompanyScan): string[] {
  const name = `${scan.company} (${scan.ats})`
  if (scan.outcome === 'manual') return [`${name}: ${scan.message}`]
  if (scan.outcome === 'no_board') return [`${name}: skipped. ${scan.message}.`]
  if (scan.outcome === 'failed') return [`${name}: failed. ${scan.message}`]
  const lines = [
    `${name}: ${plural(scan.fetched, 'posting')}${scan.malformed ? ` (and ${scan.malformed} unreadable)` : ''}. ${scan.added.length} new, ${scan.known} already saved, ${scan.filtered.length} left out.`,
  ]
  for (const { title, reason } of scan.filtered) lines.push(`    left out: ${title}. ${reason}.`)
  return lines
}

runMain(USAGE, async () => {
  const { values } = parseFlags(process.argv.slice(2), {
    company: { type: 'string', multiple: true },
    'dry-run': { type: 'boolean' },
    responses: { type: 'string' },
    concurrency: { type: 'string' },
    timeout: { type: 'string' },
  })
  if (values.help) {
    console.log(USAGE)
    return 0
  }
  const number = (flag: unknown, fallback: number, max: number) => {
    if (typeof flag !== 'string') return fallback
    const value = Number(flag)
    if (!Number.isInteger(value) || value < 1 || value > max) throw new UsageError(`Expected a whole number from 1 to ${max}, got "${flag}".`)
    return value
  }
  const concurrency = number(values.concurrency, 6, 20)
  const timeoutMs = number(values.timeout, 10, 120) * 1000
  const dir = await resolveDataDir(typeof values.data === 'string' ? values.data : undefined)
  const dryRun = values['dry-run'] === true
  if (!dryRun) await prepareDataDir(dir)
  const data = await loadData(dir)
  if (data.companies.length === 0) throw new UsageError(`The watchlist (${path.join(dir, 'companies.json')}) is empty. Add companies on the Settings page or with npm run import:jobhunter.`)

  let companies
  try {
    companies = pickCompanies(data.companies, Array.isArray(values.company) ? values.company.filter((name): name is string => typeof name === 'string') : [])
  } catch (error) {
    throw new UsageError((error as Error).message)
  }
  const fetchBoard = typeof values.responses === 'string' ? savedResponses(path.resolve(values.responses)) : httpFetcher({ timeoutMs })
  const now = new Date()
  const result = await scanBoards({ companies, jobs: data.jobs, applications: data.applications, profile: data.profile, now, fetchBoard, concurrency })
  if (!dryRun) await saveRows(dir, 'jobs.jsonl', result.added)

  const boards = result.companies.filter((scan) => scan.outcome !== 'manual').length
  const manual = result.companies.length - boards
  console.log(`Scanned ${plural(boards, 'board')}${manual ? ` (${manual} more to check by hand)` : ''}.${data.profile ? '' : ' No profile yet, so new jobs are saved unscored.'}\n`)
  for (const scan of result.companies) console.log(companyLine(scan).join('\n'))

  console.log(`\n${dryRun ? 'Would save' : 'Saved'} ${plural(result.added.length, 'new job')}${dryRun ? '' : ` to ${path.join(dir, 'jobs.jsonl')}`}.`)
  for (const job of [...result.added].sort((a, b) => (b.score?.total ?? -1) - (a.score?.total ?? -1))) {
    const score = job.score ? String(job.score.total).padStart(3) : '  -'
    console.log(`  ${job.status.padEnd(19)} ${score}  ${job.title} at ${job.company}. ${why(job)}`)
  }
  const failed = result.companies.filter((scan) => scan.outcome === 'failed').length
  if (failed > 0) console.log(`\n${plural(failed, 'board')} could not be read; the rest were saved. Run again later for those.`)
  return 0
})
