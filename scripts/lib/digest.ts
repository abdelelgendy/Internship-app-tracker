/**
 * The Today page as Markdown, from the same plan the page uses (src/features/today/todayModel.ts),
 * so the file and the page never disagree. Pure: the caller loads the data and writes the file.
 */
import { localDaysBetween, type Instant } from '../../src/engine/dates.ts'
import type { Profile } from '../../src/engine/types.ts'
import { formatDay, formatDayTime, relativeDay } from '../../src/features/jobs/format.ts'
import { tierLabel } from '../../src/features/jobs/jobView.ts'
import { followUpNote, summaryLine, type PracticeSummary, type TodayPlan } from '../../src/features/today/todayModel.ts'

/** Escapes text from postings so a title like "C++ *and* [Go]" stays plain text. */
export function md(text: string): string {
  return text.replace(/([\\`*_[\]<>#|])/g, '\\$1').replace(/\s+/g, ' ').trim()
}

/** A link only for an http(s) address; anything else is shown as escaped text. */
function link(label: string, url: string): string {
  try {
    const parsed = new URL(url)
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') return `[${md(label)}](<${parsed.href.replace(/[<>]/g, encodeURIComponent)}>)`
  } catch {
    // Not a URL.
  }
  return md(label)
}

const s = (count: number, one: string, many = `${one}s`) => `${count} ${count === 1 ? one : many}`

export function renderDigest(
  plan: TodayPlan,
  practice: PracticeSummary | null,
  profile: Profile | null,
  { now, timeZone }: { now: Instant; timeZone: string },
): string {
  const out: string[] = [`# Today, ${formatDay(now, timeZone)}`, '', summaryLine(plan), '']
  out.push(
    plan.dailyTarget > 0
      ? `Applications today: ${plan.submittedToday} of ${plan.dailyTarget}. You submit each one yourself.`
      : `No target today. Applications today: ${plan.submittedToday}.`,
  )

  if (plan.interviews.length > 0) {
    out.push('', '## Interviews in the next two weeks', '')
    for (const { app, interview } of plan.interviews) {
      const detail = [interview.kind, interview.with ? `with ${interview.with}` : ''].filter(Boolean).join(', ')
      out.push(`- ${formatDayTime(interview.at, timeZone)} (${relativeDay(interview.at, now, timeZone)}): ${md(app.title)} at ${md(app.company)}${detail ? `. ${md(detail)}` : ''}`)
    }
  }

  if (plan.followUps.length > 0) {
    out.push('', '## Follow-ups due', '')
    for (const { app, daysLate } of plan.followUps) {
      const when = daysLate === 0 ? 'due today' : `${s(daysLate, 'day')} late`
      const applied = app.appliedAt ? `Applied ${formatDay(app.appliedAt, timeZone)}, ` : ''
      out.push(`- ${link(`${app.title} at ${app.company}`, app.url)}. ${applied}${when}.`, '')
      const note = followUpNote(app, timeZone, profile?.coverLetter.signature ?? '')
      out.push(...note.split('\n').map((line) => (line ? `  > ${md(line)}` : '  >')), '')
    }
    out.pop()
  }

  if (plan.quiet.length > 0) {
    out.push('', '## No reply in 30 days or more', '')
    for (const { app, action } of plan.quiet) out.push(`- ${md(app.title)} at ${md(app.company)}: ${md(action.label)}`)
  }

  if (plan.waiting.length > 0) {
    out.push('', '## Waiting on you', '')
    for (const { app, action } of plan.waiting) out.push(`- ${link(`${app.title} at ${app.company}`, app.url)}: ${md(action.label)}`)
  }

  out.push('', '## Worth applying to', '')
  if (plan.matches.length === 0) {
    out.push(profile ? 'No job passes the score and freshness check right now.' : 'Add a profile to score jobs.')
  } else {
    if (plan.matchCount > plan.matches.length) out.push(`The top ${plan.matches.length} of ${plan.matchCount}, by tier, then the newest posting.`, '')
    for (const { job, score } of plan.matches) {
      out.push(`- ${link(`${job.title} at ${job.company}`, job.url)}. Score ${score.total}, ${tierLabel(score.tier)}. ${md(score.gate.reason)}`)
    }
  }

  if (plan.nextFollowUp && plan.followUps.length === 0) {
    out.push('', `Next follow-up: ${formatDay(plan.nextFollowUp, timeZone)} (in ${s(localDaysBetween(now, plan.nextFollowUp, timeZone), 'day')}).`)
  }

  if (practice) {
    out.push('', '## Practice', '')
    out.push(`${s(practice.dueReviews, 'card')} due for review, ${s(practice.unseen, 'new card')}. Streak: ${s(practice.streak, 'day')}.`)
  }

  out.push('', '---', '', `Written by npm run digest at ${formatDayTime(now, timeZone)}. Shortlist never submits anything: it prepares, and you apply.`, '')
  return out.join('\n')
}
