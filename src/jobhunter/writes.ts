/**
 * The files an import plan writes, in order. Pure, so the Import page (through the local data
 * API) and the import-jobhunter script (straight to disk) write exactly the same things.
 */
import { idFile } from '../data/layout.ts'
import type { ImportPlan } from './map.ts'

export type ImportWrite =
  | { label: string; kind: 'json'; file: string; value: unknown }
  | { label: string; kind: 'rows'; file: 'jobs.jsonl' | 'applications.jsonl'; rows: { id: string }[] }

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`
}

/** Whether the profile gets written: always when Shortlist has none, otherwise only when asked. */
export function writesProfile(plan: ImportPlan, replaceProfile: boolean): boolean {
  if (!plan.profile || plan.profile.action === 'same') return false
  return plan.profile.action === 'add' || replaceProfile
}

/**
 * Jobs come before applications, so an application never points at a job that is not saved yet.
 * Labels read as a list: "7 jobs", "the Systems deck".
 */
export function importWrites(plan: ImportPlan, { writeProfile }: { writeProfile: boolean }): ImportWrite[] {
  const writes: ImportWrite[] = []
  if (plan.companies.added > 0) {
    writes.push({ label: plural(plan.companies.added, 'watchlist company', 'watchlist companies'), kind: 'json', file: 'companies.json', value: plan.companies.merged })
  }
  for (const { action, deck } of plan.decks) {
    if (action !== 'same') writes.push({ label: `the ${deck.title} deck`, kind: 'json', file: idFile('practice/decks', deck.id), value: deck })
  }
  const exercises = plan.exercises.added + plan.exercises.updated
  if (exercises > 0) writes.push({ label: plural(exercises, 'exercise'), kind: 'json', file: 'practice/exercises.json', value: plan.exercises.merged })
  const stories = plan.stories.added + plan.stories.updated
  if (stories > 0) writes.push({ label: plural(stories, 'story', 'stories'), kind: 'json', file: 'practice/stories.json', value: plan.stories.merged })
  if (plan.jobs.add.length > 0) writes.push({ label: plural(plan.jobs.add.length, 'job'), kind: 'rows', file: 'jobs.jsonl', rows: plan.jobs.add })
  if (plan.applications.add.length > 0) {
    writes.push({ label: plural(plan.applications.add.length, 'application'), kind: 'rows', file: 'applications.jsonl', rows: plan.applications.add })
  }
  if (writeProfile && plan.profile && plan.profile.action !== 'same') {
    writes.push({ label: 'the profile', kind: 'json', file: 'profile.json', value: plan.profile.profile })
  }
  return writes
}
