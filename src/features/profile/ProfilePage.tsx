import { useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { useData, useRepo, useRepoData } from '@/data/data-context.ts'
import type { Profile } from '@/engine/types.ts'
import { maxPostingAgeDays } from '@/engine/gates.ts'
import { Button } from '@/ui/Button.tsx'
import { Card } from '@/ui/Card.tsx'
import { EmptyState } from '@/ui/EmptyState.tsx'
import { PageHeader } from '@/ui/PageHeader.tsx'
import { Skeleton, SkeletonText } from '@/ui/Skeleton.tsx'
import { buttonClass } from '@/ui/styles.ts'
import { Tabs } from '@/ui/Tabs.tsx'
import { useToast } from '@/ui/toast-context.ts'
import { LoadError } from '../practice/LoadError.tsx'
import { cleanProfile, isDemographicAnswer, sameProfile, validateProfile, type ProfileIssue, type SectionId } from './profileForm.ts'
import { AnswersSection, CoverLetterSection, FactsSection, LinksSection, SkillsSection, type SectionProps } from './ProfileSections.tsx'

export function ProfilePage() {
  const { mode } = useData()
  const { data, error, loading, reload } = useRepoData('profile', (repo) => repo.getProfile())

  if (data === undefined) return error ? <LoadError title="Profile" error={error} onRetry={reload} /> : <ProfileSkeleton />
  if (data === null) {
    return (
      <>
        <PageHeader title="Profile" description="Your details, skills, saved answers and cover letter rules." />
        <EmptyState
          title="No profile yet"
          description="Your data folder has no profile.json. Import the one from your job-hunter folder to get started."
          action={
            <Link to="/import" className={buttonClass({ variant: 'primary' })}>
              Go to Import
            </Link>
          }
        />
      </>
    )
  }
  return <ProfileEditor saved={data} readOnly={mode.kind !== 'local'} refreshing={loading} />
}

const SECTIONS: readonly { id: SectionId; label: string }[] = [
  { id: 'links', label: 'Links' },
  { id: 'skills', label: 'Skills' },
  { id: 'answers', label: 'Answers' },
  { id: 'cover', label: 'Cover letter' },
  { id: 'facts', label: 'Facts' },
]

function errorsByField(issues: readonly ProfileIssue[]): Record<string, string> {
  const errors: Record<string, string> = {}
  for (const issue of issues) errors[issue.field] ??= issue.message
  return errors
}

function ProfileEditor({ saved, readOnly, refreshing }: { saved: Profile; readOnly: boolean; refreshing: boolean }) {
  const repo = useRepo()
  const toast = useToast()
  const [base, setBase] = useState(saved)
  const [draft, setDraft] = useState(saved)
  const [section, setSection] = useState<SectionId>('links')
  const [showIssues, setShowIssues] = useState(false)
  const [saving, setSaving] = useState(false)

  const dirty = !sameProfile(draft, base)
  // A newer profile arrived (a save, or an import in another tab). Take it unless there are unsaved edits.
  if (saved !== base) {
    setBase(saved)
    if (!dirty) setDraft(saved)
  }

  const issues = showIssues ? validateProfile(cleanProfile(draft)) : []
  const errors = errorsByField(issues)
  const sectionsWithIssues = new Set(issues.map((issue) => issue.section))

  async function save() {
    const cleaned = cleanProfile(draft)
    const problems = validateProfile(cleaned)
    if (problems.length > 0) {
      setShowIssues(true)
      setSection(problems[0].section)
      toast.show({
        title: `Fix ${problems.length === 1 ? 'one problem' : `${problems.length} problems`} before saving`,
        description: problems[0].message,
        tone: 'danger',
      })
      // After the tab switch renders, put the cursor in the first field to fix.
      requestAnimationFrame(() => document.querySelector<HTMLElement>(`[data-field="${problems[0].field}"]`)?.focus())
      return
    }
    setSaving(true)
    try {
      await repo.saveProfile(cleaned)
      setBase(cleaned)
      setDraft(cleaned)
      setShowIssues(false)
      toast.show({ title: 'Profile saved', tone: 'success' })
    } catch (error) {
      toast.show({ title: "Couldn't save the profile", description: error instanceof Error ? error.message : String(error), tone: 'danger' })
    } finally {
      setSaving(false)
    }
  }

  const sectionProps: SectionProps = { profile: draft, update: (change) => setDraft((current) => change(current)), errors, readOnly }
  const content: Record<SectionId, ReactNode> = {
    links: <LinksSection {...sectionProps} />,
    skills: <SkillsSection {...sectionProps} />,
    answers: <AnswersSection {...sectionProps} hideDemographics={readOnly} />,
    cover: <CoverLetterSection {...sectionProps} />,
    facts: <FactsSection {...sectionProps} />,
  }
  const shownAnswers = readOnly ? draft.answers.filter((answer) => !isDemographicAnswer(answer)).length : draft.answers.length
  const counts: Partial<Record<SectionId, number>> = { skills: draft.skills.length, answers: shownAnswers, facts: draft.facts.length }

  return (
    <>
      <PageHeader
        title="Profile"
        description={`Your details, skills, saved answers and cover letter rules. ${readOnly ? 'The demo profile stays in this browser.' : 'They stay in your data folder.'}`}
      />
      {readOnly ? (
        <p className="mb-4 rounded-md border border-line bg-surface-2 px-3 py-2.5 text-[0.8125rem] text-fg-muted">
          This is the demo profile, so it is read-only. Run Shortlist with <code className="font-mono text-fg">npm run dev</code> to edit your own.
        </p>
      ) : null}
      <Basics profile={draft} />

      <Tabs
        className="mt-6"
        label="Profile sections"
        value={section}
        onChange={(id) => setSection(id as SectionId)}
        items={SECTIONS.map(({ id, label }) => ({
          id,
          count: counts[id],
          label: sectionsWithIssues.has(id) ? (
            <>
              {label}
              <span aria-hidden="true" className="size-1.5 rounded-full bg-danger" />
              <span className="sr-only">(needs a fix)</span>
            </>
          ) : (
            label
          ),
          content: content[id],
        }))}
      />

      {readOnly ? null : (
        <div className="sticky bottom-0 z-10 -mx-4 mt-8 border-t border-line bg-bg/95 px-4 py-3 backdrop-blur md:-mx-8 md:px-8">
          <div className="flex flex-wrap items-center justify-end gap-x-3 gap-y-2">
            <p className="mr-auto text-[0.8125rem] text-fg-muted" aria-live="polite">
              {saving ? 'Saving…' : dirty ? 'You have unsaved changes.' : refreshing ? 'Checking for changes…' : 'All changes saved.'}
            </p>
            <Button
              variant="ghost"
              disabled={!dirty || saving}
              onClick={() => {
                setDraft(base)
                setShowIssues(false)
              }}
            >
              Discard changes
            </Button>
            <Button variant="primary" disabled={!dirty || saving} onClick={save}>
              Save profile
            </Button>
          </div>
        </div>
      )}
    </>
  )
}

const CANADA_STATUS: Record<Profile['authorization']['canada'], string> = {
  citizen: 'Canadian citizen',
  pr: 'Permanent resident',
  permit: 'Work permit',
  none: 'Not authorized in Canada',
}

/** The fixed parts of the profile, shown for reference. They are edited in profile.json itself. */
function Basics({ profile }: { profile: Profile }) {
  const { city, region, country, openTo } = profile.location
  const rows: [string, string][] = [
    ['Name', profile.preferredName && profile.preferredName !== profile.name ? `${profile.name} (${profile.preferredName})` : profile.name],
    ['Email', profile.email],
    ['Location', [city, region, country].filter(Boolean).join(', ')],
    ['Open to', openTo.join(', ') || 'Not set'],
    ['Work authorization', CANADA_STATUS[profile.authorization.canada]],
    ['Targets', `${profile.targeting.titles.length} titles, up to ${profile.targeting.maxYears} years of experience`],
    // targeting.maxPostingAgeDays in profile.json; the gate falls back to 30 days.
    ['Posting age limit', `Skip unchecked postings older than ${maxPostingAgeDays(profile.targeting.maxPostingAgeDays)} days`],
  ]
  return (
    <Card className="px-4 py-3">
      <dl className="grid gap-x-6 gap-y-2 text-[0.8125rem] sm:grid-cols-2 xl:grid-cols-3">
        {rows.map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt className="text-xs text-fg-muted">{label}</dt>
            <dd className="break-words text-fg">{value}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 text-xs text-fg-subtle">These come from profile.json and are edited there.</p>
    </Card>
  )
}

function ProfileSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading profile">
      <div className="mb-6 space-y-2">
        <Skeleton className="h-7 w-28" />
        <Skeleton className="h-4 w-full max-w-prose" />
      </div>
      <div className="rounded-lg border border-line bg-surface px-4 py-3">
        <SkeletonText lines={3} />
      </div>
      <Skeleton className="mt-6 h-9 w-80 max-w-full" />
      <div className="mt-4 max-w-xl space-y-4">
        {[0, 1, 2].map((index) => (
          <Skeleton key={index} className="h-14 w-full" />
        ))}
      </div>
    </div>
  )
}
