/**
 * JSONL rules shared by every reader and writer of jobs.jsonl and applications.jsonl.
 *
 * A script may append a newer copy of a row instead of rewriting the file, so readers treat
 * the LAST line for an id as current. Writers replace an id's lines in place and keep every
 * line they cannot parse, so a save never destroys data it does not understand.
 */

export interface JsonlIssue {
  line: number
  message: string
}

export interface JsonlRows<T> {
  rows: T[]
  issues: JsonlIssue[]
}

function rowId(value: unknown): string | null {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return null
  const id = (value as { id?: unknown }).id
  return typeof id === 'string' && id !== '' ? id : null
}

function lines(text: string): string[] {
  return text.split('\n').map((line) => line.replace(/\r$/, ''))
}

/** Parses rows that have a string id. Each id appears once, at its first position, with its last value. */
export function readJsonl<T extends { id: string }>(text: string): JsonlRows<T> {
  const byId = new Map<string, T>()
  const issues: JsonlIssue[] = []
  lines(text).forEach((line, index) => {
    if (!line.trim()) return
    let value: unknown
    try {
      value = JSON.parse(line)
    } catch {
      issues.push({ line: index + 1, message: 'Not valid JSON' })
      return
    }
    const id = rowId(value)
    if (id === null) {
      issues.push({ line: index + 1, message: 'Not an object with a string "id"' })
      return
    }
    byId.set(id, value as T)
  })
  return { rows: [...byId.values()], issues }
}

/** Returns the file with each row replaced where its id first appears, or appended when new. */
export function upsertJsonl(text: string, updates: readonly { id: string }[]): string {
  const pending = new Map(updates.map((row) => [row.id, row]))
  const written = new Set<string>()
  const out: string[] = []
  for (const line of lines(text)) {
    if (!line.trim()) continue
    let id: string | null = null
    try {
      id = rowId(JSON.parse(line))
    } catch {
      // Kept verbatim below.
    }
    if (id === null || !pending.has(id)) {
      out.push(line)
      continue
    }
    // Later copies of an updated id are older than the update, so they are dropped.
    if (!written.has(id)) out.push(JSON.stringify(pending.get(id)))
    written.add(id)
  }
  for (const [id, row] of pending) if (!written.has(id)) out.push(JSON.stringify(row))
  return out.length ? `${out.join('\n')}\n` : ''
}

/** Non-empty string ids, or a message saying which row is missing one. */
export function rowsProblem(rows: unknown): string | null {
  if (!Array.isArray(rows)) return 'Expected a JSON array of rows'
  const bad = rows.findIndex((row) => rowId(row) === null)
  return bad === -1 ? null : `Row ${bad} is not an object with a string "id"`
}
