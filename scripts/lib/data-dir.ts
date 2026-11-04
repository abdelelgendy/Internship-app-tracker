/**
 * The data folder on disk: where it is, what is in it, and safe writes. The Node scripts and the
 * dev server's local data API (vite.config.ts) both use these, so the rules are the same: the
 * folder must not be one git would commit, writes go to a temporary file and are renamed over
 * the target so a reader never sees half a file, and JSONL saves replace rows by id while
 * keeping every line they can't read.
 */
import { execFile } from 'node:child_process'
import { randomUUID } from 'node:crypto'
import { mkdir, open, readdir, readFile, rename, rm, stat, writeFile } from 'node:fs/promises'
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

/**
 * The value of KEY=value in a .env file, read the way Vite's dotenv does: an optional "export ",
 * quotes removed, and an inline " # comment" dropped from an unquoted value. The last line wins.
 */
export function envFileValue(text: string, key: string): string | undefined {
  let found: string | undefined
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(/^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/)
    if (!match || match[1] !== key) continue
    const quoted = match[2].match(/^(['"`])(.*?)\1(?:\s+#.*)?$/)
    found = quoted ? quoted[2] : match[2].replace(/\s+#.*$/, '')
  }
  return found
}

/** The files `npm run dev` reads COPILOT_DATA_DIR from, highest priority first (Vite's order for development). */
export const ENV_FILES = ['.env.development.local', '.env.development', '.env.local', '.env'] as const

/**
 * Where the data lives, in the order the dev server uses: a --data flag (relative to the current
 * folder), then COPILOT_DATA_DIR from the shell or the env files Vite reads (relative to the
 * repo), then <repo>/.private.
 */
export async function resolveDataDir(flag: string | undefined, env: NodeJS.ProcessEnv = process.env, repoRoot = REPO_ROOT): Promise<string> {
  if (flag) return path.resolve(flag)
  if (env.COPILOT_DATA_DIR) return path.resolve(repoRoot, env.COPILOT_DATA_DIR)
  for (const name of ENV_FILES) {
    const text = await readFile(path.join(repoRoot, name), 'utf8').catch(() => null)
    const value = text === null ? undefined : envFileValue(text, 'COPILOT_DATA_DIR')
    if (value) return path.resolve(repoRoot, value)
  }
  return path.resolve(repoRoot, DEFAULT_DATA_FOLDER)
}

/**
 * True when `child` is `parent` or inside it. A relative path that merely starts with two dots
 * ("..private") is still inside; only ".." itself or "../..." leaves the folder.
 */
export function isInside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child)
  return relative !== '..' && !relative.startsWith(`..${path.sep}`) && !path.isAbsolute(relative)
}

/**
 * True when a path inside the repo is tracked or not ignored, so git would commit what is written
 * there. A folder is checked with a trailing slash, since ".private/" in .gitignore only matches
 * folders and the folder may not exist yet.
 */
export async function gitWouldCommit(target: string, repoRoot = REPO_ROOT, kind: 'folder' | 'file' = 'folder'): Promise<boolean> {
  if (!isInside(repoRoot, target)) return false
  const relative = path.relative(repoRoot, target)
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

/** Creates the contract's folders and empty files without touching anything that exists. Returns what it created. */
export async function createLayout(dir: string): Promise<string[]> {
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

/** Refuses a folder git would commit, then creates the contract's layout. */
export async function prepareDataDir(dir: string, repoRoot = REPO_ROOT): Promise<string[]> {
  if (await gitWouldCommit(dir, repoRoot)) {
    throw new Error(`The data folder ${dir} would be committed by git. Add it to .gitignore or set COPILOT_DATA_DIR to a folder outside the repo.`)
  }
  return createLayout(dir)
}

const LOCK_STALE_MS = 15_000
const LOCK_GIVE_UP_MS = 20_000

/**
 * Runs a read-modify-write on one data file while holding `<file>.lock`, which the scripts and
 * the dev server both take, so two processes never interleave their writes to the same file.
 * A lock older than 15 seconds is left from a crash (a write takes milliseconds) and is removed.
 */
export async function withFileLock<T>(file: string, task: () => Promise<T>): Promise<T> {
  const lock = `${file}.lock`
  await mkdir(path.dirname(file), { recursive: true, mode: 0o700 })
  const started = Date.now()
  for (;;) {
    try {
      await (await open(lock, 'wx', 0o600)).close()
      break
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error
      const age = await stat(lock).then((info) => Date.now() - info.mtimeMs, () => 0)
      if (age > LOCK_STALE_MS) await rm(lock, { force: true })
      else if (Date.now() - started > LOCK_GIVE_UP_MS) throw new Error(`${path.basename(file)} is locked by another Shortlist process. Try again, or delete ${lock} if nothing is running.`)
      else await new Promise((resolve) => setTimeout(resolve, 20 + Math.random() * 30))
    }
  }
  try {
    return await task()
  } finally {
    await rm(lock, { force: true })
  }
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

type RowFile = 'jobs.jsonl' | 'applications.jsonl'

/** Replaces rows by id, or appends them, in jobs.jsonl or applications.jsonl. Use for new rows; changes go through updateRows. */
export async function saveRows<T extends { id: string }>(dir: string, file: RowFile, rows: readonly T[]): Promise<void> {
  if (rows.length === 0) return
  await updateRows<T>(dir, file, () => rows)
}

/**
 * Reads the rows as they are now, under the file lock, and writes back what `change` returns.
 * A script that works for a while must build its changes from these rows, never from what it
 * loaded at the start: an edit made in the app meanwhile would otherwise be reverted.
 */
export async function updateRows<T extends { id: string }>(
  dir: string,
  file: RowFile,
  change: (current: T[]) => readonly T[] | Promise<readonly T[]>,
): Promise<void> {
  const target = path.join(dir, file)
  await withFileLock(target, async () => {
    const text = (await readText(target)) ?? ''
    const rows = await change(readJsonl<T>(text).rows)
    if (rows.length > 0) await writeAtomic(target, upsertJsonl(text, rows))
  })
}

export async function saveJson(dir: string, file: string, value: unknown): Promise<void> {
  await writeAtomic(path.join(dir, file), `${JSON.stringify(value, null, 2)}\n`)
}

export async function saveText(dir: string, file: string, text: string): Promise<void> {
  await writeAtomic(path.join(dir, file), text)
}
