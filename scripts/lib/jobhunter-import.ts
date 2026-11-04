/**
 * The import-jobhunter command without its flags: plan the import with the shared planner
 * (src/jobhunter/plan.ts, the same one the Import page previews with), describe the plan, and
 * write it. Reads the job-hunter folder only; never writes to it.
 */
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import type { ExistingData, Finding, ImportPlan, SourceReader } from '../../src/jobhunter/map.ts'
import { folderReader as readerFor, type ImportResult } from '../../src/jobhunter/plan.ts'
import { importWrites, writesProfile } from '../../src/jobhunter/writes.ts'
import type { Profile } from '../../src/engine/types.ts'
import { plural } from './cli.ts'
import { isInside, saveJson, saveRows, type LoadedData } from './data-dir.ts'

export { buildImport } from '../../src/jobhunter/plan.ts'

/** Read-only access to one folder on disk. */
export function folderReader(root: string): SourceReader {
  return readerFor(root, { readFile, readdir, join: path.join })
}

/** Refuses a data folder inside the source or the source inside the data folder, so nothing is written to job-hunter. */
export function overlapProblem(source: string, dataDir: string): string | null {
  if (isInside(source, dataDir)) return `The data folder ${dataDir} is inside ${source}. The import never writes to job-hunter, so pick a data folder outside it.`
  if (isInside(dataDir, source)) return `${source} is inside the data folder ${dataDir}. Point the import at the job-hunter folder itself.`
  return null
}

export function existingFrom(data: LoadedData): ExistingData {
  const { jobs, applications, profile, decks, exercises, stories, companies } = data
  return { jobs, applications, profile, decks, exercises, stories, companies }
}

function place(finding: Finding): string {
  if (!finding.file) return ''
  return finding.line ? `${finding.file}:${finding.line}  ` : `${finding.file}  `
}

function section(title: string, findings: readonly Finding[], out: string[]) {
  if (findings.length === 0) return
  out.push('', `${title} (${findings.length})`)
  for (const finding of findings) out.push(`  ${place(finding)}${finding.message}`)
}

function unverifiedInProfile(profile: Profile): string[] {
  return profile.experience.filter((job) => !job.verified).map((job) => `${job.title} at ${job.org}`)
}

/** The plain-text report printed after a dry run or an import. */
export function describeImport(
  result: ImportResult,
  options: { source: string; dataDir: string; replaceProfile: boolean; /** What was written, or null for a dry run. */ written: string[] | null },
): string {
  const { plan, yaml, profileFile } = result
  const dryRun = options.written === null
  const out: string[] = [`Import from ${options.source}`, `Data folder: ${options.dataDir}`]
  if (options.written === null) out.push('Dry run: nothing was written.')
  else out.push(options.written.length > 0 ? `Wrote ${options.written.join(', ')}.` : 'Nothing new to import.')

  out.push('', 'Found')
  const width = Math.max(0, ...plan.found.map((entry) => entry.file.length))
  for (const entry of plan.found) out.push(`  ${entry.file.padEnd(width)}  ${plural(entry.items, 'item')}`)
  if (plan.found.length === 0) out.push('  Nothing the importer reads.')

  const verb = dryRun ? 'to add' : 'added'
  out.push('')
  out.push(
    `Jobs: ${plan.jobs.add.length} ${verb}${plan.jobs.fromApplications ? ` (${plan.jobs.fromApplications} created for applications whose posting was not in the queue)` : ''}, ${plan.jobs.already} already in Shortlist.`,
  )
  if (plan.jobs.scoresDropped > 0) {
    out.push(`  ${plural(plan.jobs.scoresDropped, 'old score')} not carried over. Run npm run score to score them with the current rubric.`)
  }
  out.push(`Applications: ${plan.applications.add.length} ${verb}, ${plan.applications.already} already in Shortlist.`)
  if (plan.statusMapping.length > 0) {
    out.push('', 'Statuses')
    for (const entry of plan.statusMapping) out.push(`  ${entry.domain === 'queue' ? 'job' : 'application'}  ${entry.from} -> ${entry.to}  (${entry.count})`)
  }
  section('Set aside', plan.setAside, out)
  section('Mismatches', plan.mismatches, out)
  section('Duplicates', plan.duplicates, out)
  section('Needs a look', plan.problems, out)

  out.push('')
  if (!plan.profile) out.push('Profile: none found.')
  else if (plan.profile.action === 'same') out.push(`Profile: ${profileFile} matches the one in Shortlist.`)
  else if (writesProfile(plan, options.replaceProfile)) out.push(`Profile: ${dryRun ? 'would be written' : 'written'} from ${profileFile}.`)
  else out.push(`Profile: ${profileFile} differs from the one in Shortlist, which is kept. Run again with --replace-profile to replace it.`)
  for (const { action, deck } of plan.decks) if (action !== 'same') out.push(`Deck: ${deck.title} (${action === 'add' ? 'new' : 'newer copy'}, ${plural(deck.cards.length, 'card')})`)
  const counts = (label: string, entry: { added: number; updated?: number }) => {
    if (entry.added + (entry.updated ?? 0) > 0) out.push(`${label}: ${entry.added} new${entry.updated !== undefined ? `, ${entry.updated} updated` : ''}`)
  }
  counts('Exercises', plan.exercises)
  counts('Stories', plan.stories)
  counts('Watchlist companies', plan.companies)

  if (yaml) {
    out.push('', 'WARNING: the profile came from config/profile.yaml, not the corrected copilot-data/profile.json.')
    out.push('Old copies of that file held claims that were not true. Nothing below is trusted yet:')
    out.push('jobs are marked unverified, every saved answer is marked "answer it yourself", and')
    out.push('project bullets were left out. Check each item, then fix it on the Profile page.')
    for (const kind of ['experience', 'bullet', 'answer'] as const) {
      const items = yaml.unverified.filter((item) => item.kind === kind)
      if (items.length === 0) continue
      const heading = { experience: 'Jobs, imported as unverified', bullet: 'Resume bullets (job bullets imported as unverified; project bullets left out)', answer: 'Saved answers, imported as "answer it yourself"' }[kind]
      out.push('', `${heading} (${items.length})`)
      for (const item of items) out.push(`  - ${item.text}`)
    }
    if (yaml.gaps.length > 0) out.push('', `Could not read: ${yaml.gaps.join('; ')}.`)
  } else if (plan.profile && plan.profile.action !== 'same') {
    const unverified = unverifiedInProfile(plan.profile.profile)
    if (unverified.length > 0) out.push(`  Still marked unverified in ${profileFile}: ${unverified.join('; ')}.`)
  }
  return `${out.join('\n')}\n`
}

/** Writes the plan to disk: the same files, in the same order, as the Import page. */
export async function writeImport(dir: string, plan: ImportPlan, options: { replaceProfile: boolean }): Promise<string[]> {
  const written: string[] = []
  for (const write of importWrites(plan, { writeProfile: writesProfile(plan, options.replaceProfile) })) {
    if (write.kind === 'rows') await saveRows(dir, write.file, write.rows)
    else await saveJson(dir, write.file, write.value)
    written.push(write.label)
  }
  return written
}
