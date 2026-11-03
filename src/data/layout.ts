/**
 * The data directory layout from the contract (src/engine/types.ts), shared by the dev
 * middleware in vite.config.ts and the local repo. Pure: no DOM, no Node APIs.
 */
import { emptyProgress } from './repo.ts'

/** Ids that become file names: a slug or a UUID, never a path. */
const FILE_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/

export type FileFormat = 'object' | 'array' | 'jsonl' | 'markdown'

const FIXED_FILES: Record<string, FileFormat> = {
  'profile.json': 'object',
  'jobs.jsonl': 'jsonl',
  'applications.jsonl': 'jsonl',
  'companies.json': 'array',
  'practice/exercises.json': 'array',
  'practice/stories.json': 'array',
  'practice/progress.json': 'object',
}

/** Folders whose files are named by id; the value is the extension of every file in it. */
export const ID_FOLDERS = { 'practice/decks': '.json', covers: '.md' } as const
export type IdFolder = keyof typeof ID_FOLDERS

/**
 * Written when a data directory is first opened, and never over an existing file. The
 * .gitignore makes the folder ignore itself, even if it is moved into another repo.
 */
export const INITIAL_FILES: Record<string, string> = {
  '.gitignore': '# Shortlist keeps private data in this folder. Never commit it.\n*\n',
  'jobs.jsonl': '',
  'applications.jsonl': '',
  'companies.json': '[]\n',
  'practice/exercises.json': '[]\n',
  'practice/stories.json': '[]\n',
  'practice/progress.json': `${JSON.stringify(emptyProgress(), null, 2)}\n`,
  'denylist.txt': '',
}

export const INITIAL_FOLDERS = ['practice', ...Object.keys(ID_FOLDERS)]

export function isFileId(id: string): boolean {
  return FILE_ID.test(id)
}

export function idFile(folder: IdFolder, id: string): string {
  if (!isFileId(id)) throw new Error(`Not a valid file id: ${JSON.stringify(id)}`)
  return `${folder}/${id}${ID_FOLDERS[folder]}`
}

/**
 * The format of a contract file the app may read and write, or null for any other path.
 * denylist.txt is deliberately absent: only the privacy guard reads it, from disk.
 */
export function dataFileFormat(path: string): FileFormat | null {
  const fixed = FIXED_FILES[path]
  if (fixed) return fixed
  const slash = path.lastIndexOf('/')
  const folder = path.slice(0, slash)
  if (!(folder in ID_FOLDERS)) return null
  const extension = ID_FOLDERS[folder as IdFolder]
  const name = path.slice(slash + 1)
  if (!name.endsWith(extension) || !isFileId(name.slice(0, -extension.length))) return null
  return extension === '.md' ? 'markdown' : 'object'
}

/** Checks that text is valid for a file before it is written, so a bad save cannot corrupt it. */
export function contentProblem(format: FileFormat, text: string): string | null {
  if (format === 'markdown') return null
  if (format === 'jsonl') return 'JSONL files change through row upserts, not whole-file writes'
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    return 'Body is not valid JSON'
  }
  const isArray = Array.isArray(value)
  if (format === 'array' && !isArray) return 'Expected a JSON array'
  if (format === 'object' && (isArray || value === null || typeof value !== 'object')) return 'Expected a JSON object'
  return null
}
