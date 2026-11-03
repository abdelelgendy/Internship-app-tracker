#!/usr/bin/env node
/**
 * Blocks a commit that would publish personal data. .githooks/pre-commit runs it on the staged
 * files; `node scripts/check-private.mjs --all` checks every tracked file instead.
 *
 * It reads the staged copy of each file (what the commit will contain, not the working tree)
 * and reports:
 *   - any entry in <data dir>/denylist.txt, ignoring case (phone-like entries in any format);
 *   - phone numbers, email addresses outside the reserved example domains, and demographic
 *     answers (a key such as gender or ethnicity with a value);
 *   - files inside the data folder and .env files.
 * Matches are masked in the output so the check itself never prints the private value.
 * A line containing "privacy-check: allow" is exempt from the generic patterns, never from the denylist.
 *
 * Plain JavaScript on purpose: the hook must run with nothing but Node and git.
 * Exit codes: 0 clean, 1 findings, 2 the check could not run.
 */
import { execFileSync } from 'node:child_process'
import { existsSync, readFileSync } from 'node:fs'
import path from 'node:path'

const ALLOW_MARKER = 'privacy-check: allow'
const SHORT_ENTRY = 4
const LOCKFILES = new Set(['package-lock.json', 'npm-shrinkwrap.json', 'yarn.lock', 'pnpm-lock.yaml', 'bun.lock'])

/** Reserved for documentation (RFC 2606 and 6761) or no-reply services, so never a real inbox. */
const SAFE_EMAIL_DOMAIN = /(^|\.)(example\.(com|net|org)|[a-z0-9-]+\.(example|test|invalid|localhost)|users\.noreply\.github\.com)$/i
const SAFE_EMAIL = new Set(['git@github.com', 'git@gitlab.com', 'git@bitbucket.org'])
/** "icon@2x.png" looks like an email address but is a file name. */
const FILE_EXTENSION_TLD = /\.(png|jpe?g|gif|svg|webp|avif|ico|css|js|mjs|ts|tsx|json|md)$/i

const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)*\.[A-Za-z]{2,}/g
const PHONES = [
  // North American numbers with separators: 905-555-0123, (905) 555 0123, 905.555.0123
  /(?<![\d-])\(?[2-9]\d{2}\)?[\s.-]{1,2}[2-9]\d{2}[\s.-]\d{4}(?![\d-])/g,
  // With a +1 country code, separators optional
  /\+1[\s.-]?\(?[2-9]\d{2}\)?[\s.-]?[2-9]\d{2}[\s.-]?\d{4}(?!\d)/g,
  // Any other E.164 number
  /\+(?!1)\d{10,14}(?!\d)/g,
]
/** 555-0100 to 555-0199 are reserved for fiction in North America. */
const FICTIONAL_PHONE = /555[\s.-]?01\d\d$/

const DEMOGRAPHIC_KEYS =
  'gender|gender[_-]?identity|sex|ethnicity|race|race[_-]?ethnicity|veteran|veteran[_-]?status|protected[_-]?veteran|disability|disability[_-]?status|sexual[_-]?orientation|pronouns|hispanic[_-]?(?:or[_-]?)?latino|indigenous|visible[_-]?minority|date[_-]?of[_-]?birth|dob|birth[_-]?date'
// In code and JSON a key followed by a quoted value; in YAML any value.
const DEMOGRAPHIC_QUOTED = new RegExp(`(?:^|[\\s{,(])["']?(?:${DEMOGRAPHIC_KEYS})["']?\\s*[:=]\\s*(["'\`])(?!\\1)`, 'i')
const DEMOGRAPHIC_YAML = new RegExp(`^\\s*-?\\s*["']?(?:${DEMOGRAPHIC_KEYS})["']?\\s*:\\s*\\S`, 'i')

function run(args, options = {}) {
  return execFileSync('git', args, { maxBuffer: 256 * 1024 * 1024, ...options })
}

/** COPILOT_DATA_DIR from the environment, else from .env.local or .env (as Vite reads it), else .private. */
function dataDirFor(root) {
  let value = process.env.COPILOT_DATA_DIR
  for (const file of ['.env.local', '.env']) {
    if (value) break
    const envFile = path.join(root, file)
    if (!existsSync(envFile)) continue
    const line = readFileSync(envFile, 'utf8').split('\n').find((entry) => /^\s*COPILOT_DATA_DIR\s*=/.test(entry))
    if (line) value = line.split('=').slice(1).join('=').trim().replace(/^(["'])(.*)\1$/, '$2')
  }
  return path.resolve(root, value || '.private')
}

/** One string per line. Lines starting with # are comments, as job-hunter writes them. */
function readDenylist(dataDir) {
  const file = path.join(dataDir, 'denylist.txt')
  if (!existsSync(file)) return null
  return readFileSync(file, 'utf8')
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith('#'))
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * Phone-like entries match in any format, with or without the +1 country code. Short entries
 * (a postal prefix, initials) match only as a whole word, or they would hit random text.
 * Everything else matches anywhere, ignoring case.
 */
function denylistPattern(entry) {
  let digits = entry.replace(/\D/g, '')
  if (/^[\d\s().+-]+$/.test(entry) && digits.length >= 7) {
    if (digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1)
    return new RegExp(`(?<!\\d)(?:\\+?1[\\s().-]*)?${digits.split('').join('[\\s().-]*')}(?!\\d)`, 'g')
  }
  if (entry.length <= SHORT_ENTRY) return new RegExp(`(?<![A-Za-z0-9])${escapeRegExp(entry)}(?![A-Za-z0-9])`, 'gi')
  return new RegExp(escapeRegExp(entry), 'gi')
}

/** Enough to find the spot, never enough to read the value. */
function mask(text) {
  if (text.length <= 4) return '*'.repeat(text.length)
  return `${text.slice(0, 2)}${'*'.repeat(Math.min(text.length - 4, 12))}${text.slice(-2)}`
}

function lineOf(text, index) {
  let line = 1
  for (let i = 0; i < index; i++) if (text.charCodeAt(i) === 10) line++
  return line
}

function safeEmail(email) {
  const domain = email.slice(email.indexOf('@') + 1)
  return SAFE_EMAIL.has(email.toLowerCase()) || SAFE_EMAIL_DOMAIN.test(domain) || FILE_EXTENSION_TLD.test(domain)
}

function genericFindings(text, file) {
  const findings = []
  const yaml = /\.ya?ml$/i.test(file)
  text.split('\n').forEach((line, index) => {
    if (line.includes(ALLOW_MARKER)) return
    const at = index + 1
    for (const email of line.match(EMAIL) ?? []) {
      if (!safeEmail(email)) findings.push({ line: at, reason: 'email address outside example.com', match: email })
    }
    for (const pattern of PHONES) {
      for (const phone of line.match(pattern) ?? []) {
        if (!FICTIONAL_PHONE.test(phone)) findings.push({ line: at, reason: 'phone number', match: phone })
      }
    }
    const demographic = line.match(DEMOGRAPHIC_QUOTED) ?? (yaml ? line.match(DEMOGRAPHIC_YAML) : null)
    if (demographic) findings.push({ line: at, reason: 'demographic answer', match: demographic[0].trim() })
  })
  return findings
}

function checkFile(file, content, { root, dataDir, denylist }) {
  const findings = []
  const absolute = path.resolve(root, file)
  const relativeToData = path.relative(dataDir, absolute)
  if (!relativeToData.startsWith('..') && !path.isAbsolute(relativeToData)) {
    findings.push({ line: 0, reason: 'file is inside the private data folder', match: '' })
  }
  const name = path.basename(file)
  if (/^\.env(\..+)?$/.test(name) && name !== '.env.example') findings.push({ line: 0, reason: 'environment file', match: '' })

  const patterns = denylist.map(denylistPattern)
  for (const pattern of patterns) {
    pattern.lastIndex = 0
    if (pattern.test(file)) findings.push({ line: 0, reason: 'file name contains a denylisted string', match: '' })
  }

  // Binary files (a NUL byte early on) are not scanned: their text is usually compressed anyway.
  if (content.subarray(0, 8000).includes(0)) return findings
  const text = content.toString('utf8')
  for (const pattern of patterns) {
    pattern.lastIndex = 0
    for (const match of text.matchAll(pattern)) {
      findings.push({ line: lineOf(text, match.index), reason: 'denylisted string', match: match[0] })
    }
  }
  if (!LOCKFILES.has(name)) findings.push(...genericFindings(text, file))
  return findings
}

function main() {
  const all = process.argv.includes('--all')
  let root
  try {
    root = run(['rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim()
  } catch {
    console.error('check-private: not inside a git repository.')
    return 2
  }
  const dataDir = dataDirFor(root)
  const denylist = readDenylist(dataDir)
  if (denylist === null) {
    console.error(`check-private: no denylist at ${path.join(dataDir, 'denylist.txt')}, so only the generic checks ran. See docs/PRIVACY.md.`)
  }

  const listing = all ? run(['ls-files', '-z'], { cwd: root }) : run(['diff', '--cached', '--name-only', '-z', '--diff-filter=ACMR'], { cwd: root })
  const files = listing.toString('utf8').split('\0').filter(Boolean)
  const context = { root, dataDir, denylist: denylist ?? [] }

  const report = []
  for (const file of files) {
    const content = run(['show', `:${file}`], { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] })
    for (const finding of checkFile(file, content, context)) report.push({ file, ...finding })
  }

  if (report.length === 0) return 0
  console.error(`\ncheck-private: ${report.length} problem${report.length === 1 ? '' : 's'} in ${all ? 'tracked' : 'staged'} files. Nothing was committed.\n`)
  for (const { file, line, reason, match } of report) {
    console.error(`  ${file}${line ? `:${line}` : ''}  ${reason}${match ? `  (${mask(match)})` : ''}`)
  }
  console.error(`
Remove the data, or unstage the file with: git restore --staged <file>
Private data belongs in ${dataDir}, which git ignores.
If a generic match is a false alarm in code, add "${ALLOW_MARKER}" to that line.
`)
  return 1
}

process.exitCode = main()
