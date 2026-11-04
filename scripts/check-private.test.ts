import { execFileSync, spawnSync } from 'node:child_process'
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, expect, it } from 'vitest'

const here = fileURLToPath(new URL('.', import.meta.url))
const SCRIPT = path.join(here, 'check-private.mjs')
const HOOK = path.join(here, '..', '.githooks', 'pre-commit')

// Assembled at runtime, so this public file does not itself contain a phone number or a real-looking email.
const PHONE = ['416', '867', '5309'].join('-')
const EMAIL = ['quentin.f', 'mailbox.org'].join('@')
const DENYLISTED = 'Quentin Fairweather'
const DEMOGRAPHIC_KEY = ['gen', 'der'].join('')

const cleanups: string[] = []
afterEach(() => {
  for (const dir of cleanups.splice(0)) rmSync(dir, { recursive: true, force: true })
})

function tempDir(prefix: string) {
  const dir = mkdtempSync(path.join(tmpdir(), prefix))
  cleanups.push(dir)
  return dir
}

/** A fresh git repo plus a data folder outside it, with a denylist. */
function setup(denylist: string[] | null = ['# Comments and blank lines are skipped', '#', DENYLISTED, '(905) 555 0142', 'Q7X']) {
  const root = tempDir('shortlist-guard-repo-')
  const dataDir = tempDir('shortlist-guard-data-')
  execFileSync('git', ['init', '-q'], { cwd: root })
  if (denylist) writeFileSync(path.join(dataDir, 'denylist.txt'), `${denylist.join('\n')}\n\n`)
  const git = (...args: string[]) => execFileSync('git', args, { cwd: root, stdio: 'pipe' })
  const write = (file: string, text: string) => {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true })
    writeFileSync(path.join(root, file), text)
  }
  const stage = (file: string, text: string) => {
    write(file, text)
    git('add', '--force', file)
  }
  const check = (...args: string[]) => {
    // Without a denylist the folder is the unconfigured default; a configured folder must have one.
    const result = spawnSync(process.execPath, [SCRIPT, ...args], {
      cwd: root,
      env: { ...process.env, COPILOT_DATA_DIR: denylist ? dataDir : '' },
      encoding: 'utf8',
    })
    return { status: result.status, output: `${result.stdout}${result.stderr}` }
  }
  return { root, dataDir, git, write, stage, check }
}

describe('check-private', () => {
  it('passes a commit with nothing private in it', () => {
    const repo = setup()
    repo.stage('src/app.ts', 'export const greeting = "Hello from Sam Rivera, sam.rivera@example.com"\n')
    expect(repo.check()).toEqual({ status: 0, output: '' })
  })

  it('rejects a staged file that contains a denylisted string, without printing it', () => {
    const repo = setup()
    repo.stage('notes/cover.md', `Thanks,\nquentin fairweather\n`)
    const result = repo.check()
    expect(result.status).toBe(1)
    expect(result.output).toContain('notes/cover.md:2  denylisted string')
    expect(result.output).not.toMatch(/fairweather/i)
  })

  it('matches a phone number from the denylist in any format, even a fictional one', () => {
    const repo = setup()
    repo.stage('a.txt', 'call 905.555.0142 or +19055550142\n')
    const result = repo.check()
    expect(result.status).toBe(1)
    expect(result.output.match(/denylisted string/g)).toHaveLength(2)
  })

  it('skips comment lines and matches short entries only as whole words', () => {
    const repo = setup()
    repo.stage('colors.css', '--bg: #f4f4f0; /* skipped comment lines must not match "#" */\nQ7Xa is not a match\n')
    expect(repo.check().status).toBe(0)
    repo.stage('address.txt', 'Postal code q7x 1a1\n')
    expect(repo.check().output).toContain('address.txt:1  denylisted string')
  })

  it('checks the staged copy, not the working tree', () => {
    const repo = setup()
    repo.stage('a.md', 'clean\n')
    repo.write('a.md', `${DENYLISTED}\n`)
    expect(repo.check().status).toBe(0)

    repo.stage('b.md', `${DENYLISTED}\n`)
    repo.write('b.md', 'fixed but not staged\n')
    expect(repo.check().status).toBe(1)
  })

  it('catches phone numbers, real email addresses and demographic answers without a denylist', () => {
    const repo = setup(null)
    repo.stage('profile.json', `{\n  "phone": "${PHONE}",\n  "email": "${EMAIL}",\n  "${DEMOGRAPHIC_KEY}": "prefer to say"\n}\n`)
    repo.stage('answers.yaml', `${DEMOGRAPHIC_KEY}: some answer\n`)
    const result = repo.check()
    expect(result.status).toBe(1)
    expect(result.output).toContain('no denylist at')
    expect(result.output).toContain('profile.json:2  phone number')
    expect(result.output).toContain('profile.json:3  email address outside example.com')
    expect(result.output).toContain('profile.json:4  demographic answer')
    expect(result.output).toContain('answers.yaml:1  demographic answer')
    expect(result.output).not.toContain(PHONE)
    expect(result.output).not.toContain(EMAIL)
  })

  it('leaves code, reserved domains, fictional numbers and file names alone', () => {
    const repo = setup(null)
    repo.stage(
      'src/ok.ts',
      [
        "const remote = 'git@github.com:owner/repo.git'",
        "const icon = 'logo@2x.png'",
        "const contact = 'hello@team.example.com'",
        "const fake = '(905) 555-0123'",
        "const day = '2026-11-03T17:00:00Z'",
        "const version = 'react@19.2.0'",
        "const field = { gender: string }",
        "const patterns = ['gender identity', 'ethnicity']",
        `const sample = '${PHONE}' // privacy-check: allow`,
      ].join('\n'),
    )
    repo.stage('package-lock.json', `{ "note": "${PHONE}" }\n`)
    expect(repo.check()).toEqual({ status: 0, output: expect.stringContaining('only the generic checks ran') })
  })

  it('rejects files from the data folder and .env files even when forced into the index', () => {
    const repo = setup()
    repo.stage('.private/profile.json', '{}\n')
    repo.stage('.env.local', 'KEY=1\n')
    repo.stage('.env.example', 'KEY=\n')
    const result = spawnSync(process.execPath, [SCRIPT], { cwd: repo.root, env: { ...process.env, COPILOT_DATA_DIR: '' }, encoding: 'utf8' })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('.private/profile.json  file is inside the private data folder')
    expect(result.stderr).toContain('.env.local  environment file')
    expect(result.stderr).not.toContain('.env.example')
  })

  it('reads COPILOT_DATA_DIR from .env.local like the dev server does', () => {
    const repo = setup()
    writeFileSync(path.join(repo.root, '.env.local'), `COPILOT_DATA_DIR="${repo.dataDir}"\n`)
    repo.stage('a.txt', `${DENYLISTED}\n`)
    const result = spawnSync(process.execPath, [SCRIPT], { cwd: repo.root, env: { ...process.env, COPILOT_DATA_DIR: '' }, encoding: 'utf8' })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('denylisted string')
  })

  it.each([
    ['.env.local', (dir: string) => `COPILOT_DATA_DIR=${dir} # my real data\n`],
    ['.env.local', (dir: string) => `export COPILOT_DATA_DIR='${dir}'\n`],
    ['.env.local', (dir: string) => `COPILOT_DATA_DIR="${dir}" # quoted, then a comment\n`],
    ['.env.development', (dir: string) => `COPILOT_DATA_DIR=${dir}\n`],
    ['.env.development.local', (dir: string) => `COPILOT_DATA_DIR=${dir}\n`],
  ])('reads COPILOT_DATA_DIR from %s the way Vite does: %#', (file, line) => {
    const repo = setup()
    writeFileSync(path.join(repo.root, file), line(repo.dataDir))
    repo.stage('a.txt', `${DENYLISTED}\n`)
    const result = spawnSync(process.execPath, [SCRIPT], { cwd: repo.root, env: { ...process.env, COPILOT_DATA_DIR: '' }, encoding: 'utf8' })
    expect(result.status).toBe(1)
    expect(result.stderr).toContain('denylisted string')
  })

  it('refuses to run when COPILOT_DATA_DIR points to a folder with no denylist', () => {
    const repo = setup()
    repo.stage('a.txt', 'nothing private\n')
    const result = spawnSync(process.execPath, [SCRIPT], { cwd: repo.root, env: { ...process.env, COPILOT_DATA_DIR: path.join(repo.dataDir, 'typo') }, encoding: 'utf8' })
    expect(result.status).toBe(2)
    expect(result.stderr).toContain('has no denylist.txt')
  })

  it('reports a file in the data folder whose name starts with two dots', () => {
    const repo = setup(null)
    repo.stage('.private/..backup.json', '{}\n')
    expect(repo.check()).toMatchObject({ status: 1, output: expect.stringContaining('.private/..backup.json  file is inside the private data folder') })
  })

  it('checks every tracked file with --all', () => {
    const repo = setup()
    repo.stage('old.md', `${DENYLISTED}\n`)
    repo.git('-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-q', '-m', 'old', '--no-verify')
    expect(repo.check().status).toBe(0)
    expect(repo.check('--all').status).toBe(1)
  })

  it('runs as the pre-commit hook and blocks the commit', () => {
    const repo = setup()
    mkdirSync(path.join(repo.root, 'scripts'))
    mkdirSync(path.join(repo.root, '.githooks'))
    copyFileSync(SCRIPT, path.join(repo.root, 'scripts', 'check-private.mjs'))
    copyFileSync(HOOK, path.join(repo.root, '.githooks', 'pre-commit'))
    chmodSync(path.join(repo.root, '.githooks', 'pre-commit'), 0o755)
    repo.git('config', 'core.hooksPath', '.githooks')
    const commit = () =>
      spawnSync('git', ['-c', 'user.name=Test', '-c', 'user.email=test@example.com', 'commit', '-q', '-m', 'test'], {
        cwd: repo.root,
        env: { ...process.env, COPILOT_DATA_DIR: repo.dataDir },
        encoding: 'utf8',
      })

    repo.git('add', 'scripts', '.githooks')
    repo.stage('resume.md', `Phone: ${PHONE}\n`)
    const blocked = commit()
    expect(blocked.status).not.toBe(0)
    expect(blocked.stderr).toContain('resume.md:1  phone number')

    repo.stage('resume.md', 'Phone: on request\n')
    expect(commit().status).toBe(0)
  })
})
