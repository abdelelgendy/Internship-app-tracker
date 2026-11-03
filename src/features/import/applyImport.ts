/**
 * Writes an import plan into the data folder through the local data API (src/data/localApi.ts),
 * so each file is saved atomically and in turn with any other save. Local mode only: the Repo
 * interface has no way to save decks, exercises, stories or the watchlist.
 */
import type { ImportPlan } from '../../../scripts/lib/jobhunter-map.ts'
import { idFile } from '../../data/layout.ts'
import { errorFrom, LOCAL_API_BASE, LOCAL_API_HEADER } from '../../data/localApi.ts'

export interface ApplyChoices {
  /** Write the imported profile. Off by default when it would replace an existing one. */
  profile: boolean
}

export interface ApplyOptions {
  baseUrl?: string
  fetch?: typeof fetch
}

const json = (value: unknown) => `${JSON.stringify(value, null, 2)}\n`

/** One line per file written, such as "7 jobs". */
export async function applyImportPlan(plan: ImportPlan, choices: ApplyChoices, { baseUrl = LOCAL_API_BASE, fetch: send = fetch }: ApplyOptions = {}): Promise<string[]> {
  const written: string[] = []
  const call = async (step: string, method: 'PUT' | 'POST', route: string, body: string) => {
    const response = await send(`${baseUrl}/${route.split('/').map(encodeURIComponent).join('/')}`, {
      method,
      body,
      headers: { [LOCAL_API_HEADER]: '1', 'content-type': method === 'POST' ? 'application/json' : 'text/plain' },
    })
    if (!response.ok) {
      const error = await errorFrom(response)
      throw new Error(`Saving ${step} failed: ${error.message} Apply again to finish; anything already saved is skipped.`)
    }
    written.push(step)
  }
  const plural = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`

  if (plan.companies.added > 0) {
    await call(plural(plan.companies.added, 'watchlist company', 'watchlist companies'), 'PUT', 'files/companies.json', json(plan.companies.merged))
  }
  for (const { action, deck } of plan.decks) {
    if (action !== 'same') await call(`the ${deck.title} deck`, 'PUT', `files/${idFile('practice/decks', deck.id)}`, json(deck))
  }
  if (plan.exercises.added + plan.exercises.updated > 0) {
    await call(plural(plan.exercises.added + plan.exercises.updated, 'exercise'), 'PUT', 'files/practice/exercises.json', json(plan.exercises.merged))
  }
  if (plan.stories.added + plan.stories.updated > 0) {
    await call(plural(plan.stories.added + plan.stories.updated, 'story', 'stories'), 'PUT', 'files/practice/stories.json', json(plan.stories.merged))
  }
  // Jobs before applications, so an application never points at a job that is not saved yet.
  if (plan.jobs.add.length > 0) await call(plural(plan.jobs.add.length, 'job'), 'POST', 'rows/jobs.jsonl', JSON.stringify(plan.jobs.add))
  if (plan.applications.add.length > 0) {
    await call(plural(plan.applications.add.length, 'application'), 'POST', 'rows/applications.jsonl', JSON.stringify(plan.applications.add))
  }
  if (choices.profile && plan.profile && plan.profile.action !== 'same') await call('the profile', 'PUT', 'files/profile.json', json(plan.profile.profile))
  return written
}
