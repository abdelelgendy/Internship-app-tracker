/**
 * The data folder for Node scripts: where it is, what is in it, and safe writes. The same rules
 * as the dev server's local data API (vite.config.ts): the folder must not be one git would
 * commit, writes go to a temporary file and are renamed over the target so a reader never sees
 * half a file, and JSONL saves replace rows by id while keeping every line they can't read.
 */
import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir, open, readdir, readFile, rename, rm, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { readJsonl, upsertJsonl, type JsonlIssue } from '../../src/data/jsonl.ts'
import { idFile, INITIAL_FILES, INITIAL_FOLDERS, isFileId } from '../../src/data/layout.ts'
import { emptyProgress } from '../../src/data/repo.ts'
import type { Application, Company, Exercise, Job, PracticeDeck, PracticeProgress, Profile, StarStory } from '../../src/engine/types.ts'

const run = promisify(execFile)

export const REPO_ROOT = fileURLToPath(new URL('../..', import.meta.url))
export const DEFAULT_DATA_FOLDER = '.private'

/** The value of KEY=value in a .env file, without quotes. Comments and other keys are ignored. */
export function envFileValue(text: string, key: string): string | undefined {
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/)
    if (!match || match[1] !== key) continue
    const value = match[2]
    const quoted = value.match(/^(['"])(.*)\1$/)
    return quoted ? quoted[2] : value.replace(/\s+#.*$/, '')
  }
  return undefined
}

/**
 * Where the data lives, in the order the dev server uses: a --data flag (relative to the current
 * folder), then COPILOT_DATA_DIR from the shell, .env.local or .env (relative to the repo), then
 * <repo>/.private.
 */
export async function resolveDataDir(flag: string | undefined, env: NodeJS.ProcessEnv = process.env, repoRoot = REPO_ROOT): Promise<string> {
  if (flag) return path.resolve(flag)
  if (env.COPILOT_DATA_DIR) return path.resolve(repoRoot, env.COPILOT_DATA_DIR)
  for (const name of ['.env.local', '.env']) {
    const text = await readFile(path.join(repoRoot, name), 'utf8').catch(() => null)
    const value = text === null ? undefined : envFileValue(text, 'COPILOT_DATA_DIR')
    if (value) return path.resolve(repoRoot, value)
  }
  return path.resolve(repoRoot, DEFAULT_DATA_FOLDER)
}

/**
 * True when a path inside the repo is tracked or not ignored, so git would commit what is written
 * there. A folder is checked with a trailing slash, since ".private/" in .gitignore only matches
 * folders and the folder may not exist yet.
 */
export async function gitWouldCommit(target: string, repoRoot = REPO_ROOT, kind: 'folder' | 'file' = 'folder'): Promise<boolean> {
  const relative = path.relative(repoRoot, target)
  if (relative.startsWith('..') || path.isAbsolute(relative)) return false
  if (relative === '') return true
  try {
    const { stdout } = await run('git', ['ls-files', '--', relative], { cwd: repoRoot })
    if (stdout.trim() !== '') return true
    await run('git', ['check-ignore', '-q', '--', `${relative.split(path.sep).join('/')}${kind === 'folder' ? '/' : ''}`], { cwd: repoRoot })
    return false
  } catch (error) {
    // check-ignore exits 1 for "not ignored"; anything else (no git, not a repo) means nothing to commit to.
    return (error as { code?: unknown }).code === 1
  }
}

/** Refuses a folder git would commit, then creates the contract's layout without touching existing files. */
export async function prepareDataDir(dir: string, repoRoot = REPO_ROOT): Promise<string[]> {
  if (await gitWouldCommit(dir, repoRoot)) {
    throw new Error(`The data folder ${dir} would be committed by git. Add it to .gitignore or set COPILOT_DATA_DIR to a folder outside the repo.`)
  }
  const created: string[] = []
  await mkdir(dir, { recursive: true, mode: 0o700 })
  for (const folder of INITIAL_FOLDERS) {
    if (await mkdir(path.join(dir, folder), { recursive: true, mode: 0o700 })) created.push(`${folder}/`)
  }
  for (const [file, text] of Object.entries(INITIAL_FILES)) {
    try {
      await writeFile(path.join(dir, file), text, { flag: 'wx', mode: 0o600 })
      created.push(file)
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
    }
  }
  return created
}

/** Writes beside the target and renames over it. */
export async function writeAtomic(file: string, text: string): Promise<void> {
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 })
  const temp = `${file}.${process.pid}.${randomUUID()}.tmp`
  try {
    const handle = await open(temp, 'w', 0o600)
    try {
      await handle.writeFile(text, 'utf8')
      await handle.sync()
    } finally {
      await handle.close()
    }
    await rename(temp, file)
  } catch (error) {
    await rm(temp, { force: true })
    throw error
  }
}

async function readText(file: string): Promise<string | null> {
  try {
    return await readFile(file, 'utf8')
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

async function readJson<T>(dir: string, file: string, fallback: T): Promise<T> {
  const text = await readText(path.join(dir, file))
  if (text === null || text.trim() === '') return fallback
  try {
    return JSON.parse(text) as T
  } catch {
    throw new Error(`${file} in ${dir} is not valid JSON. Fix or remove it, then run again.`)
  }
}

export interface DataIssue extends JsonlIssue {
  file: string
}

export interface LoadedData {
  profile: Profile | null
  jobs: Job[]
  applications: Application[]
  companies: Company[]
  decks: PracticeDeck[]
  exercises: Exercise[]
  stories: StarStory[]
  progress: PracticeProgress
  /** Lines in the JSONL files that could not be read. Saves keep them as they are. */
  issues: DataIssue[]
}

/** Everything in the data folder, in the contract's shapes. Missing files read as empty. */
export async function loadData(dir: string): Promise<LoadedData> {
  const issues: DataIssue[] = []
  const rows = async <T extends { id: string }>(file: string) => {
    const result = readJsonl<T>((await readText(path.join(dir, file))) ?? '')
    issues.push(...result.issues.map((issue) => ({ ...issue, file })))
    return result.rows
  }
  const deckIds = ((await readdir(path.join(dir, 'practice/decks')).catch(() => [])) as string[])
    .filter((name) => name.endsWith('.json') && isFileId(name.slice(0, -5)))
    .map((name) => name.slice(0, -5))
    .sort()
  const [profile, jobs, applications, companies, exercises, stories, progress, decks] = await Promise.all([
    readJson<Profile | null>(dir, 'profile.json', null),
    rows<Job>('jobs.jsonl'),
    rows<Application>('applications.jsonl'),
    readJson<Company[]>(dir, 'companies.json', []),
    readJson<Exercise[]>(dir, 'practice/exercises.json', []),
    readJson<StarStory[]>(dir, 'practice/stories.json', []),
    readJson<PracticeProgress>(dir, 'practice/progress.json', emptyProgress()),
    Promise.all(deckIds.map((id) => readJson<PracticeDeck | null>(dir, idFile('practice/decks', id), null))),
  ])
  return {
    profile,
    jobs,
    applications,
    companies,
    decks: decks.filter((deck): deck is PracticeDeck => deck !== null),
    exercises,
    stories,
    progress,
    issues,
  }
}

/** Replaces rows by id, or appends them, in jobs.jsonl or applications.jsonl. */
export async function saveRows<T extends { id: string }>(dir: string, file: 'jobs.jsonl' | 'applications.jsonl', rows: readonly T[]): Promise<void> {
  if (rows.length === 0) return
  const target = path.join(dir, file)
  await writeAtomic(target, upsertJsonl((await readText(target)) ?? '', rows))
}

export async function saveJson(dir: string, file: string, value: unknown): Promise<void> {
  await writeAtomic(path.join(dir, file), `${JSON.stringify(value, null, 2)}\n`)
}

export async function saveText(dir: string, file: string, text: string): Promise<void> {
  await writeAtomic(path.join(dir, file), text)
}
