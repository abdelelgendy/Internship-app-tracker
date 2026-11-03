import type { DataMode } from '@/data/mode.ts'
import type { Repo } from '@/data/repo.ts'
import type { Application, Company, Exercise, Job, PracticeDeck, PracticeProgress, Profile, StarStory } from '@/engine/types.ts'
import { isDemographicAnswer } from '../profile/profileForm.ts'

/** Everything in one file, in the contract's shapes, so it can be read back or kept as a backup. */
export interface ExportBundle {
  app: 'Shortlist'
  exportedAt: string
  dataMode: DataMode['kind']
  profile: Profile | null
  jobs: Job[]
  applications: Application[]
  companies: Company[]
  practice: { decks: PracticeDeck[]; exercises: Exercise[]; stories: StarStory[]; progress: PracticeProgress }
  /** Cover letter drafts by application id. */
  covers: Record<string, string>
}

/** The demo never shows or exports self-identification answers, even fictional ones. */
export function withoutDemographics(profile: Profile): Profile {
  return { ...profile, answers: profile.answers.filter((answer) => !isDemographicAnswer(answer)) }
}

export async function collectExport(repo: Repo, mode: DataMode, now: Date): Promise<ExportBundle> {
  const [profile, jobs, applications, companies, decks, exercises, stories, progress] = await Promise.all([
    repo.getProfile(),
    repo.listJobs(),
    repo.listApplications(),
    repo.listCompanies(),
    repo.listDecks(),
    repo.listExercises(),
    repo.listStories(),
    repo.getProgress(),
  ])
  const covers: Record<string, string> = {}
  const drafts = await Promise.all(applications.map(async (app) => [app.id, await repo.getCoverLetter(app.id)] as const))
  for (const [id, markdown] of drafts) if (markdown !== null) covers[id] = markdown
  return {
    app: 'Shortlist',
    exportedAt: now.toISOString(),
    dataMode: mode.kind,
    profile: profile && mode.kind === 'sample' ? withoutDemographics(profile) : profile,
    jobs,
    applications,
    companies,
    practice: { decks, exercises, stories, progress },
    covers,
  }
}

/** shortlist-export-2026-11-03.json, dated by the local calendar day. */
export function exportFileName(now: Date): string {
  const pad = (value: number) => String(value).padStart(2, '0')
  return `shortlist-export-${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}.json`
}
