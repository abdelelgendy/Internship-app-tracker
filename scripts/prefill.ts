/**
 * The optional form assistant. Opens one Greenhouse, Lever or Ashby application form in a
 * visible browser, fills only what it is sure of, marks every other field, records what it
 * filled on the draft application, and then waits. You check the form and submit it yourself;
 * the assistant never submits, never logs in and never runs on LinkedIn.
 */
import { mkdir } from 'node:fs/promises'
import path from 'node:path'
import { chromium } from 'playwright'
import { parseFlags, plural, runMain, UsageError } from './lib/cli.ts'
import { loadData, prepareDataDir, resolveDataDir, saveRows, updateRows } from './lib/data-dir.ts'
import { prefillPage } from './lib/prefill-page.ts'
import type { Application } from '../src/engine/types.ts'
import { checkFormUrl, postingKey, recordFilled, type Recorded } from './lib/prefill-plan.ts'

const USAGE = `Usage: npm run prefill -- <application URL> [--inspect] [--data <folder>]

  <application URL>  one Greenhouse, Lever or Ashby application page (https only, never LinkedIn)
  --inspect          mark what it would fill without typing anything

The browser keeps its own profile in <data folder>/browser-profile, so a login you do there by
hand is remembered. The assistant never types a password and never submits.`

runMain(USAGE, async () => {
  const { values, positionals } = parseFlags(process.argv.slice(2), { inspect: { type: 'boolean' } }, true)
  if (values.help) {
    console.log(USAGE)
    return 0
  }
  if (positionals.length !== 1) throw new UsageError('Give exactly one application URL.')
  const checked = checkFormUrl(positionals[0])
  if ('error' in checked) throw new Error(checked.error)

  const dir = await resolveDataDir(typeof values.data === 'string' ? values.data : undefined)
  await prepareDataDir(dir)
  const data = await loadData(dir)
  if (!data.profile) throw new UsageError(`No profile.json in ${dir}. The assistant fills from your profile, so add one first.`)
  const fill = values.inspect !== true
  const key = postingKey(checked.url.href)
  const job = data.jobs.find((candidate) => candidate.url && postingKey(candidate.url) === key)

  const profileDir = path.join(dir, 'browser-profile')
  await mkdir(profileDir, { recursive: true, mode: 0o700 })
  const context = await chromium.launchPersistentContext(profileDir, { headless: false, viewport: null })
  const closed = new Promise<void>((resolve) => context.on('close', () => resolve()))
  process.once('SIGINT', () => void context.close())
  const page = context.pages()[0] ?? (await context.newPage())
  await page.goto(checked.url.href, { waitUntil: 'domcontentloaded' })
  await page.waitForSelector('input, textarea, select', { timeout: 20_000 }).catch(() => undefined)
  await page.waitForLoadState('networkidle', { timeout: 5_000 }).catch(() => undefined)

  const result = await prefillPage(page, data.profile, { company: job?.company, applications: data.applications }, { fill })
  const filled = result.decisions.filter((decision) => decision.action === 'fill')
  const kept = result.decisions.filter((decision) => decision.action === 'keep')
  const left = result.decisions.filter((decision) => decision.action === 'leave')

  console.log(`${result.pageTitle || result.url}\n`)
  console.log(`${fill ? 'Filled' : 'Would fill'} ${plural(filled.length, 'field')}:`)
  for (const decision of filled) console.log(`  ${decision.label}: ${decision.value}  (${decision.reason})`)
  if (kept.length > 0) {
    console.log(`\nAlready filled (${kept.length}):`)
    for (const decision of kept) console.log(`  ${decision.label}: ${decision.reason}`)
  }
  console.log(`\nLeft for you (${left.length}), outlined in amber on the page:`)
  for (const decision of left) console.log(`  ${decision.label}: ${decision.reason}`)

  if (fill) {
    // Recorded against the rows as they are now: the person may have changed this application
    // in the app while the page loaded, and those changes must survive.
    let recorded = null as Recorded | null
    await updateRows<Application>(dir, 'applications.jsonl', async (applications) => {
      const { jobs } = await loadData(dir)
      recorded = recordFilled(filled, { url: result.url, pageTitle: result.pageTitle, jobs, applications, now: new Date() })
      if (recorded?.newJob) await saveRows(dir, 'jobs.jsonl', [recorded.newJob])
      return recorded ? [recorded.app] : []
    })
    if (recorded) {
      console.log(
        `\nRecorded the filled answers on ${recorded.newApp ? 'a new draft application' : 'the application'} for ${recorded.app.title} at ${recorded.app.company}.${recorded.newJob ? ' The posting was not in your jobs, so it was added; check its title and date.' : ''} If you change an answer before submitting, update it in Shortlist.`,
      )
    }
  }
  console.log('\nThe browser stays open. Check every field, attach your files, and submit the form yourself. Close the browser window when you are done.')
  await closed
  return 0
})
