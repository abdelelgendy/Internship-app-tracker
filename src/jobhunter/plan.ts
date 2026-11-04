/**
 * Plans one import from a job-hunter folder: reads it through a SourceReader, maps it with
 * map.ts, and falls back to config/profile.yaml when the corrected copilot-data/profile.json is
 * missing. Used by the dev server's import preview and the import-jobhunter script, so both see
 * the same plan. File access is passed in because code under src/ has no Node types; this file
 * pulls in the YAML parser, so the browser bundle should import map.ts and writes.ts instead.
 */
import { parse } from 'yaml'
import { planImport, readJobHunterSource, type ExistingData, type ImportPlan, type SourceReader } from './map.ts'
import { profileFromYaml, type UnverifiedItem } from './profile-yaml.ts'

export const PROFILE_YAML = 'config/profile.yaml'
const MAX_FILE_BYTES = 10 * 1024 * 1024

/** What a profile read from profile.yaml carries besides the profile itself. */
export interface YamlProfileNotes {
  /** Everything imported as unverified. */
  unverified: UnverifiedItem[]
  /** Fields that could not be read and were left empty. */
  gaps: string[]
}

export interface ImportResult {
  plan: ImportPlan
  /** Set when the profile came from profile.yaml, whose old copies held claims that were not true. */
  yaml: YamlProfileNotes | null
  /** The file the profile came from, relative to the folder, or null when there is none. */
  profileFile: string | null
}

/** The file access folderReader needs: node:fs/promises and node:path fit it. */
export interface FolderFs {
  readFile(file: string, encoding: 'utf8'): Promise<string>
  readdir(folder: string): Promise<string[]>
  join(...parts: string[]): string
}

function errorCode(error: unknown): string | undefined {
  const code = typeof error === 'object' && error !== null ? (error as { code?: unknown }).code : undefined
  return typeof code === 'string' ? code : undefined
}

/** Read-only access to one folder. Missing paths read as null; files over 10 MB are refused. */
export function folderReader(root: string, fs: FolderFs): SourceReader {
  return {
    async list(folder) {
      try {
        return await fs.readdir(fs.join(root, folder))
      } catch (error) {
        if (['ENOENT', 'ENOTDIR'].includes(errorCode(error) ?? '')) return null
        throw error
      }
    },
    async read(file) {
      let text: string
      try {
        text = await fs.readFile(fs.join(root, file), 'utf8')
      } catch (error) {
        if (['ENOENT', 'EISDIR', 'ENOTDIR'].includes(errorCode(error) ?? '')) return null
        throw error
      }
      if (text.length > MAX_FILE_BYTES) throw new Error(`${file} is larger than 10 MB, so it was not read.`)
      return text
    },
  }
}

/**
 * The plan for one import, or null when the folder holds nothing the importer reads.
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
  const { profile, unverified, gaps } = profileFromYaml(doc)
  const same = existing.profile !== null && JSON.stringify(existing.profile) === JSON.stringify(profile)
  plan.profile = { action: existing.profile === null ? 'add' : same ? 'same' : 'update', profile }
  plan.found.push({ file: PROFILE_YAML, items: 1 })
  return { plan, yaml: { unverified, gaps }, profileFile: PROFILE_YAML }
}
