/**
 * Writes an import plan into the data folder through the local data API (src/data/localApi.ts),
 * so each file is saved atomically and in turn with any other save. Local mode only: the Repo
 * interface has no way to save decks, exercises, stories or the watchlist.
 */
import { errorFrom, LOCAL_API_BASE, LOCAL_API_HEADER } from '../../data/localApi.ts'
import type { ImportPlan } from '../../jobhunter/map.ts'
import { importWrites } from '../../jobhunter/writes.ts'

export interface ApplyChoices {
  /** Write the imported profile. Off by default when it would replace an existing one. */
  profile: boolean
}

export interface ApplyOptions {
  baseUrl?: string
  fetch?: typeof fetch
}

/** One line per file written, such as "7 jobs". */
export async function applyImportPlan(plan: ImportPlan, choices: ApplyChoices, { baseUrl = LOCAL_API_BASE, fetch: send = fetch }: ApplyOptions = {}): Promise<string[]> {
  const written: string[] = []
  for (const write of importWrites(plan, { writeProfile: choices.profile })) {
    const [method, route, body] =
      write.kind === 'rows' ? (['POST', `rows/${write.file}`, JSON.stringify(write.rows)] as const) : (['PUT', `files/${write.file}`, `${JSON.stringify(write.value, null, 2)}\n`] as const)
    const response = await send(`${baseUrl}/${route.split('/').map(encodeURIComponent).join('/')}`, {
      method,
      body,
      headers: { [LOCAL_API_HEADER]: '1', 'content-type': method === 'POST' ? 'application/json' : 'text/plain' },
    })
    if (!response.ok) {
      const error = await errorFrom(response)
      throw new Error(`Saving ${write.label} failed: ${error.message} Apply again to finish; anything already saved is skipped.`)
    }
    written.push(write.label)
  }
  return written
}
