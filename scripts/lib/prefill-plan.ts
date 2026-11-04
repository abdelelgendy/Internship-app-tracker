/**
 * What the form assistant may fill, decided without a browser so every rule has a plain test.
 *
 * It fills a field only when it is sure: your name, email and links from the profile, and any
 * question the engine's answerFor() answers. A select or radio is chosen only when the answer
 * is exactly one of its options. Everything else is left for you with the reason: files,
 * passwords, checkboxes (consent and terms look like this), self-identification, phone,
 * searchable dropdowns, and every question the engine is not sure about.
 */
import { randomUUID } from 'node:crypto'
import { answerFor, type AnswerContext } from '../../src/engine/answers.ts'
import { urlKey } from '../../src/engine/dedup.ts'
import type { Application, Job, Profile } from '../../src/engine/types.ts'
import { channelFor, newApplication, openApplicationFor } from '../../src/features/apply/applyModel.ts'
import { atsFromUrl, companyFromUrl } from '../../src/features/jobs/jobView.ts'
import { allowedUrl, hostMatches, POSTING_DOMAINS, type BoardAts } from './boards.ts'
import { DEMOGRAPHIC } from '../../src/jobhunter/profile-yaml.ts'

// ---------- Which pages ----------

const FORM_DOMAINS: readonly string[] = Object.values(POSTING_DOMAINS).flat()
const NEVER = ['linkedin.com', 'lnkd.in']

/** The application form URL, or a plain reason it is refused. Only Greenhouse, Lever and Ashby, over https. */
export function checkFormUrl(text: string): { url: URL; ats: BoardAts } | { error: string } {
  let parsed: URL
  try {
    parsed = new URL(text.trim())
  } catch {
    return { error: `"${text}" is not a web address. Paste the application page's full URL.` }
  }
  if (NEVER.some((domain) => hostMatches(parsed.hostname, domain))) {
    return { error: 'Shortlist never automates LinkedIn, including Easy Apply. Apply there yourself.' }
  }
  const url = allowedUrl(parsed.href, FORM_DOMAINS)
  if (!url) {
    return { error: `${parsed.hostname || text} is not a Greenhouse, Lever or Ashby application page over https, so the assistant won't open it.` }
  }
  const ats = (Object.keys(POSTING_DOMAINS) as BoardAts[]).find((key) => POSTING_DOMAINS[key].some((domain) => hostMatches(url.hostname, domain)))!
  return { url, ats }
}

/** True for a page the assistant may fill: the same hosts as checkFormUrl. Used again after redirects and for frames. */
export function isFormHost(href: string): boolean {
  return allowedUrl(href, FORM_DOMAINS) !== null
}

// ---------- Fields ----------

export type FieldKind =
  | 'text' | 'email' | 'url' | 'tel' | 'number' | 'textarea' | 'select' | 'radio' | 'checkbox' | 'file' | 'password' | 'combobox' | 'other'

/** One form field as the page reports it. A radio group is one field with its options. */
export interface FormField {
  /** The data-shortlist-field value that finds the element again. */
  key: string
  kind: FieldKind
  /** A radio group whose inputs the page hides behind custom styling. */
  hidden?: boolean
  label: string
  name: string
  autocomplete: string
  required: boolean
  /** The current value: typed text, or the chosen option's label. */
  value: string
  options: { label: string; value: string }[]
}

export type FieldDecision =
  | { key: string; label: string; action: 'fill'; value: string; optionIndex?: number; source: 'profile' | 'answer'; answerId?: string; reason: string }
  | { key: string; label: string; action: 'keep'; reason: string }
  | { key: string; label: string; action: 'leave'; reason: string }

const normal = (text: string) =>
  text
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[.!?:]+$/, '')
    .replace(/\s+/g, ' ')
    .trim()

/** The option whose label or value is exactly the answer, ignoring case and spacing. */
export function matchOption(options: FormField['options'], answer: string): number | null {
  const wanted = normal(answer)
  if (!wanted) return null
  const index = options.findIndex((option) => normal(option.label) === wanted || (option.value !== '' && normal(option.value) === wanted))
  return index === -1 ? null : index
}

type Identity = { value: string | undefined; what: string }

// A field about another person (a referrer, a reference, an emergency contact) is never yours to fill from the profile.
const SOMEONE_ELSE = /\b(?:referr\w*|referee|references?|emergency|contact|manager|recruiter|employer|supervisor|their|friend)\b/i
const SOMEONE_ELSE_HINT = /(?:^|[^a-z])(?:referr|referee|reference|emergency|contact|manager|recruiter|employer|supervisor|friend)/i
// A link is filled only where the form asks for one, never into "How did you hear about us? (e.g. LinkedIn)".
const ASKS_FOR_LINK = /\b(?:url|link|profile|website|site|page)\b/

/** The label names the site ("LinkedIn"), asks for a link to it, or the field takes a URL. */
function asksForLink(field: FormField, label: string, hint: string, site: string): boolean {
  const named = new RegExp(`\\b${site}\\b`)
  if (!named.test(label) && !named.test(hint)) return false
  return field.kind === 'url' || label === site || ASKS_FOR_LINK.test(label)
}

/**
 * Name, email and links from the profile, matched on the whole label so "Referrer's email"
 * and "Emergency contact last name" are left alone. Phone is never filled: you type it.
 */
function identityFor(field: FormField, profile: Profile): Identity | null {
  const label = normal(field.label)
  const hint = `${field.name} ${field.autocomplete}`.toLowerCase()
  const autocomplete = field.autocomplete.toLowerCase()
  if (SOMEONE_ELSE.test(label) || SOMEONE_ELSE_HINT.test(field.name)) return null
  const [first, ...rest] = profile.name.trim().split(/\s+/)
  if (/\b(?:confirm|repeat|re-?enter)\b/.test(label) && field.kind !== 'email') return null
  if (/^(?:your )?preferred (?:first )?name$/.test(label)) return { value: profile.preferredName, what: 'your preferred name' }
  if (/^(?:your |legal )?(?:first|given) name$/.test(label) || autocomplete === 'given-name') return { value: first, what: 'your first name' }
  if (/^(?:your |legal )?(?:(?:last|family) name|surname)$/.test(label) || autocomplete === 'family-name') return { value: rest.join(' '), what: 'your last name' }
  if (/^(?:your )?(?:full |legal )?name$/.test(label) || autocomplete === 'name') return { value: profile.name, what: 'your name' }
  if (/^(?:(?:confirm|re-?enter|repeat) )?(?:your )?e-?mail(?: address)?$/.test(label) || autocomplete === 'email') return { value: profile.email, what: 'your email' }
  if (asksForLink(field, label, hint, 'linkedin')) return { value: profile.links.linkedin, what: 'your LinkedIn link' }
  if (asksForLink(field, label, hint, 'github')) return { value: profile.links.github, what: 'your GitHub link' }
  if (/^(?:your )?(?:portfolio|personal (?:website|site)|website)(?: url| link)?$/.test(label)) return { value: profile.links.portfolio, what: 'your portfolio link' }
  return null
}

const TEXT_KINDS: readonly FieldKind[] = ['text', 'email', 'url', 'number', 'textarea']

const LEAVE_REASON: Partial<Record<FieldKind, string>> = {
  file: 'Attach files yourself.',
  password: 'Passwords are never filled or stored.',
  checkbox: 'Checkboxes are yours to tick: consent and terms often look like this.',
  tel: 'Your phone number is yours to type.',
  combobox: 'A searchable dropdown. Pick the option yourself.',
  other: 'A field type the assistant does not fill, such as a date.',
}

function leave(field: FormField, reason: string): FieldDecision {
  return { key: field.key, label: field.label || field.name || 'Unlabelled field', action: 'leave', reason }
}

/** Applies a sure value to the field: typed, or chosen when it is exactly one of the options. */
function fillWith(field: FormField, value: string, source: 'profile' | 'answer', reason: string, answerId?: string): FieldDecision {
  if (field.kind === 'select' || field.kind === 'radio') {
    const index = matchOption(field.options, value)
    if (index === null) return leave(field, `Your answer "${value}" is not one of the options, so pick the closest one yourself.`)
    if (normal(field.value) === normal(field.options[index].label)) return { key: field.key, label: field.label, action: 'keep', reason: 'Already chosen.' }
    return { key: field.key, label: field.label, action: 'fill', value: field.options[index].label, optionIndex: index, source, reason, ...(answerId ? { answerId } : {}) }
  }
  if (!TEXT_KINDS.includes(field.kind)) return leave(field, LEAVE_REASON[field.kind] ?? 'Not a field the assistant fills.')
  if (field.value.trim() !== '') {
    return normal(field.value) === normal(value)
      ? { key: field.key, label: field.label, action: 'keep', reason: 'Already filled with the same value.' }
      : { key: field.key, label: field.label, action: 'keep', reason: 'Already has a different value, left as it is.' }
  }
  return { key: field.key, label: field.label, action: 'fill', value, source, reason, ...(answerId ? { answerId } : {}) }
}

export function planField(field: FormField, profile: Profile, context: AnswerContext): FieldDecision {
  const fixed = LEAVE_REASON[field.kind]
  if (fixed) return leave(field, fixed)
  if (field.kind === 'radio' && field.hidden) return leave(field, 'The choices are styled buttons the assistant does not click. Pick one yourself.')
  if (!field.label) return leave(field, "No label, so the assistant can't tell what it asks.")
  if (DEMOGRAPHIC.test(field.label)) return leave(field, 'Self-identification: yours to answer or to decline.')
  if (/\b(?:phone|mobile)\b/i.test(field.label)) return leave(field, LEAVE_REASON.tel!)

  const identity = identityFor(field, profile)
  if (identity) {
    return identity.value
      ? fillWith(field, identity.value, 'profile', `From your profile: ${identity.what}.`)
      : leave(field, `Your profile has no ${identity.what.replace(/^your /, '')}.`)
  }
  const answer = answerFor(field.label, profile, context)
  if (!answer) return leave(field, 'No sure answer saved. Answer it yourself.')
  return fillWith(field, answer.answer, 'answer', `Your saved answer (${answer.answerId}).`, answer.answerId)
}

/** One decision per field, in page order. */
export function planFields(fields: readonly FormField[], profile: Profile, context: AnswerContext): FieldDecision[] {
  return fields.map((field) => planField(field, profile, context))
}

// ---------- Recording what was filled ----------

/** The posting a form belongs to: Lever adds /apply and Ashby /application to the posting's link. */
export function postingKey(url: string): string {
  return urlKey(url.replace(/\/(?:apply|application)\/?(?=$|[?#])/, ''))
}

export interface Recorded {
  app: Application
  /** A job created because no saved job had this link. */
  newJob: Job | null
  newApp: boolean
}

/**
 * Adds the answers the assistant filled to the application's answersUsed draft, creating a
 * draft application (and the job, if no saved job has this link) when there is none. The
 * status is left alone: you mark it applied after you submit.
 */
export function recordFilled(
  decisions: readonly FieldDecision[],
  { url, pageTitle, jobs, applications, now }: { url: string; pageTitle: string; jobs: readonly Job[]; applications: readonly Application[]; now: Date },
): Recorded | null {
  const answers = Object.fromEntries(
    decisions.flatMap((decision) => (decision.action === 'fill' && decision.source === 'answer' ? [[decision.label, decision.value] as const] : [])),
  )
  if (Object.keys(answers).length === 0) return null
  const key = postingKey(url)
  const at = now.toISOString()
  let job = jobs.find((candidate) => candidate.url && postingKey(candidate.url) === key) ?? null
  let newJob: Job | null = null
  if (!job) {
    const parsed = new URL(url)
    newJob = {
      id: `manual-${randomUUID()}`,
      source: 'manual',
      ats: atsFromUrl(parsed),
      company: companyFromUrl(parsed) ?? parsed.hostname,
      title: pageTitle.trim() || 'Untitled posting',
      location: '',
      workplace: 'unknown',
      url,
      postedAt: null,
      postedAtSource: 'unknown',
      discoveredAt: at,
      status: 'shortlisted',
      notes: 'Added by npm run prefill. Check the title, company and posting date.',
    }
    job = newJob
  }
  const existing =
    openApplicationFor(job.id, applications) ?? applications.find((app) => app.url && postingKey(app.url) === key && app.status !== 'withdrawn' && app.status !== 'rejected')
  const app = existing ?? { ...newApplication(job, randomUUID(), at), channel: channelFor(job) }
  return { app: { ...app, answersUsed: { ...(app.answersUsed ?? {}), ...answers } }, newJob, newApp: !existing }
}
