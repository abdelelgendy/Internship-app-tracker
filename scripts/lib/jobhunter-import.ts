/**
 * The import-jobhunter command without its flags: read a job-hunter folder (never writing to
 * it), plan the import with jobhunter-map.ts, fill in the profile from config/profile.yaml when
 * the corrected copilot-data/profile.json is missing, describe the plan, and write it.
 */
import { readdir, readFile } from 'node:fs/promises'
import path from 'node:path'
import { parse } from 'yaml'
import { idFile } from '../../src/data/layout.ts'
import type { Profile } from '../../src/engine/types.ts'
import { plural } from './cli.ts'
import { saveJson, saveRows, type LoadedData } from './data-dir.ts'
import { planImport, readJobHunterSource, type ExistingData, type Finding, type ImportPlan, type SourceReader } from './jobhunter-map.ts'
import { profileFromYaml, type ProfileFromYaml } from './profile-yaml.ts'

export const PROFILE_YAML = 'config/profile.yaml'
const MAX_FILE_BYTES = 10 * 1024 * 1024

function code(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException).code
}

/** Read-only access to one folder. Missing paths read as null; huge files are refused. */
export function folderReader(root: string): SourceReader & { root: string } {
  return {
    root,
    async list(folder) {
      try {
        return await readdir(path.join(root, folder))
      } catch (error) {
        if (['ENOENT', 'ENOTDIR'].includes(code(error) ?? '')) return null
        throw error
      }
    },
    async read(file) {
      let text: string
      try {
        text = await readFile(path.join(root, file), 'utf8')
      } catch (error) {
        if (['ENOENT', 'EISDIR', 'ENOTDIR'].includes(code(error) ?? '')) return null
        throw error
      }
      if (text.length > MAX_FILE_BYTES) throw new Error(`${file} is larger than 10 MB, so it was not read.`)
      return text
    },
  }
}

/** Refuses a data folder inside the source or the source inside the data folder, so nothing is written to job-hunter. */
export function overlapProblem(source: string, dataDir: string): string | null {
  const inside = (parent: string, child: string) => {
    const relative = path.relative(parent, child)
    return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))
  }
  if (inside(source, dataDir)) return `The data folder ${dataDir} is inside ${source}. The import never writes to job-hunter, so pick a data folder outside it.`
  if (inside(dataDir, source)) return `${source} is inside the data folder ${dataDir}. Point the import at the job-hunter folder itself.`
  return null
}

export interface ImportResult {
  plan: ImportPlan
  /** Set when the profile came from profile.yaml. */
  yaml: ProfileFromYaml | null
  profileFile: string | null
}

export function existingFrom(data: LoadedData): ExistingData {
  const { jobs, applications, profile, decks, exercises, stories, companies } = data
  return { jobs, applications, profile, decks, exercises, stories, companies }
}

/**
 * The plan for one import. Returns null when the folder holds nothing the importer reads.
 * The YAML profile is only a fallback: copilot-data/profile.json is the corrected one.
 */
export async function buildImport(reader: SourceReader, existing: ExistingData, now: Date): Promise<ImportResult | null> {
  const source = await readJobHunterSource(reader)
  const yamlText = await reader.read(PROFILE_YAML)
  if (source === null && yamlText === null) return null
  const plan = planImport(source ?? { jobs: [], decks: [], exercises: [], stories: [] }, existing, { now })
  if (source?.profile || yamlText === null) {
    return { plan, yaml: null, profileFile: source?.profile?.path ?? null }
  }
  let doc: unknown
  try {
    doc = parse(yamlText)
  } catch (error) {
    plan.problems.push({ file: PROFILE_YAML, message: `Not valid YAML (${error instanceof Error ? error.message.split('\n')[0] : 'parse error'}), so the profile was skipped.` })
    return { plan, yaml: null, profileFile: null }
  }
  const yaml = profileFromYaml(doc)
  const same = existing.profile !== null && JSON.stringify(existing.profile) === JSON.stringify(yaml.profile)
  plan.profile = { action: existing.profile === null ? 'add' : same ? 'same' : 'update', profile: yaml.profile }
  plan.found.push({ file: PROFILE_YAML, items: 1 })
  return { plan, yaml, profileFile: PROFILE_YAML }
}

/** Whether the profile gets written: always when Shortlist has none, otherwise only when asked. */
export function writesProfile(plan: ImportPlan, replaceProfile: boolean): boolean {
  if (!plan.profile || plan.profile.action === 'same') return false
  return plan.profile.action === 'add' || replaceProfile
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

/** Writes the plan in the same order as the Import page: jobs before the applications that point at them. */
export async function writeImport(dir: string, plan: ImportPlan, options: { replaceProfile: boolean }): Promise<string[]> {
  const written: string[] = []
  if (plan.companies.added > 0) {
    await saveJson(dir, 'companies.json', plan.companies.merged)
    written.push(plural(plan.companies.added, 'watchlist company', 'watchlist companies'))
  }
  for (const { action, deck } of plan.decks) {
    if (action === 'same') continue
    await saveJson(dir, idFile('practice/decks', deck.id), deck)
    written.push(`the ${deck.title} deck`)
  }
  if (plan.exercises.added + plan.exercises.updated > 0) {
    await saveJson(dir, 'practice/exercises.json', plan.exercises.merged)
    written.push(plural(plan.exercises.added + plan.exercises.updated, 'exercise'))
  }
  if (plan.stories.added + plan.stories.updated > 0) {
    await saveJson(dir, 'practice/stories.json', plan.stories.merged)
    written.push(plural(plan.stories.added + plan.stories.updated, 'story', 'stories'))
  }
  if (plan.jobs.add.length > 0) {
    await saveRows(dir, 'jobs.jsonl', plan.jobs.add)
    written.push(plural(plan.jobs.add.length, 'job'))
  }
  if (plan.applications.add.length > 0) {
    await saveRows(dir, 'applications.jsonl', plan.applications.add)
    written.push(plural(plan.applications.add.length, 'application'))
  }
  if (plan.profile && writesProfile(plan, options.replaceProfile)) {
    await saveJson(dir, 'profile.json', plan.profile.profile)
    written.push('the profile')
  }
  return written
}
