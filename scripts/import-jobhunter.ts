/**
 * Imports Abdel's older job-hunter data into the data folder. Reads only; never writes to the
 * job-hunter folder. Running it again adds nothing new.
 */
import path from 'node:path'
import { parseFlags, runMain, UsageError } from './lib/cli.ts'
import { loadData, prepareDataDir, REPO_ROOT, resolveDataDir } from './lib/data-dir.ts'
import { buildImport, describeImport, existingFrom, folderReader, overlapProblem, writeImport } from './lib/jobhunter-import.ts'

const USAGE = `Usage: npm run import:jobhunter -- [--from <folder>] [--dry-run] [--replace-profile] [--data <folder>]

  --from <folder>      the job-hunter folder, or its copilot-data folder (default: ../job-hunter)
  --dry-run            print what would change and write nothing
  --replace-profile    replace a profile Shortlist already has (it is kept otherwise)
  --data <folder>      the data folder (default: COPILOT_DATA_DIR, else .private)`

runMain(USAGE, async () => {
  const { values } = parseFlags(process.argv.slice(2), {
    from: { type: 'string' },
    'dry-run': { type: 'boolean' },
    'replace-profile': { type: 'boolean' },
  })
  if (values.help) {
    console.log(USAGE)
    return 0
  }
  const source = path.resolve(typeof values.from === 'string' ? values.from : path.join(REPO_ROOT, '..', 'job-hunter'))
  const dataDir = await resolveDataDir(typeof values.data === 'string' ? values.data : undefined)
  const overlap = overlapProblem(source, dataDir)
  if (overlap) throw new UsageError(overlap)
  const dryRun = values['dry-run'] === true
  const replaceProfile = values['replace-profile'] === true

  // A dry run reads the data folder if it is there but creates nothing.
  if (!dryRun) await prepareDataDir(dataDir)
  const existing = existingFrom(await loadData(dataDir))
  const result = await buildImport(folderReader(source), existing, new Date())
  if (result === null) {
    throw new UsageError(`No job-hunter data in ${source}. Point --from at the job-hunter folder (it has data/ and copilot-data/) or at copilot-data itself.`)
  }
  const written = dryRun ? null : await writeImport(dataDir, result.plan, { replaceProfile })
  process.stdout.write(describeImport(result, { source, dataDir, replaceProfile, written }))
  return 0
})
