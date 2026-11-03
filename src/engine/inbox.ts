import { normalizeCompany, normalizeText, normalizeTitle, sentences, textMatcher } from './normalize.ts'
import type { AppStatus, Application } from './types.ts'

/**
 * Classifies a pasted email into a suggested status change. Keyword rules only, no AI, and only
 * a suggestion: you confirm before anything changes. When several classes match, precedence
 * decides: offer, interview, assessment, rejection, reviewing, received, then recruiter outreach.
 */

export type EmailKind = 'offer' | 'interview' | 'assessment' | 'rejection' | 'reviewing' | 'received' | 'recruiter' | 'other'

export interface EmailClassification {
  kind: EmailKind
  suggestedStatus: AppStatus | null
  /** urgent: act today; info: worth a look; none: just record it. */
  alert: 'urgent' | 'info' | 'none'
  /** The phrases that decided it, so you can check the call. */
  evidence: string[]
}

const NEGATED_OFFER = /\b(?:unable to|not able to|cannot|can't|won't be able to|not in a position to|decided not to|will not)\s+(?:extend|offer|move)/iu

const RULES: readonly { kind: Exclude<EmailKind, 'other'>; test: (subject: string, sentence: string) => string | null }[] = [
  {
    kind: 'offer',
    test: (subject, sentence) => {
      const strong = sentence.match(
        /\b(?:offer letter|offer of employment|employment offer|job offer|formal offer|compensation package|extend (?:you )?an offer|extending (?:you )?an offer|(?:pleased|excited|happy|delighted|thrilled) to (?:extend|offer) (?:you )?(?:an? |the )?(?:offer|position|role|job)|offer you (?:the|a|this) (?:position|role|job))\b/iu,
      )
      if (strong && !NEGATED_OFFER.test(sentence)) return strong[0]
      if (/\bcongratulations\b/iu.test(sentence) && /\boffer\b/iu.test(sentence) && !NEGATED_OFFER.test(sentence)) return 'congratulations ... offer'
      // "Welcome aboard" also opens ATS sign-up emails, so it needs a second offer signal.
      const welcome = sentence.match(/\b(?:welcome to the team|welcome aboard)\b/iu)
      if (welcome && /\b(?:offer|start date|first day)\b/iu.test(`${subject} ${sentence}`)) return welcome[0]
      // A bare "Offer ends tonight" is marketing; the subject needs to read like an employment offer.
      return sentence === subject && /^(?:re:\s*)?(?:your (?:job )?offer|job offer|offer letter|offer of employment|offer\s*[-:|])/iu.test(subject)
        ? 'subject: offer'
        : null
    },
  },
  {
    kind: 'interview',
    test: (_, sentence) => {
      const screen = sentence.match(/\b(?:phone screen|initial screen|screening call|recruiter screen|recruiter call)\b/iu)
      if (screen) return screen[0]
      if (/\binterviews?\b/iu.test(sentence) && /\b(?:schedule|scheduling|available|availability|chat|call|time slot|invite|invitation|book)\b/iu.test(sentence)) {
        return 'interview + scheduling'
      }
      if (/\bnext steps?\b/iu.test(sentence) && /\b(?:schedule|availability|available|call|chat|book a time)\b/iu.test(sentence)) {
        return 'next steps + scheduling'
      }
      return null
    },
  },
  {
    kind: 'assessment',
    test: (_, sentence) =>
      sentence.match(/\b(?:technical assessment|technical screen|coding challenge|coding exercise|coding assessment|online assessment|take-home|take home|project assignment|hackerrank|coderpad|codesignal|codility|hackerearth)\b/iu)?.[0] ?? null,
  },
  {
    kind: 'rejection',
    test: (_, sentence) =>
      sentence.match(
        /\b(?:not (?:be )?moving forward|decided not to (?:move|proceed)|move forward with other candidates|pursue other candidates|other candidates whose|position has been filled|role has been filled|not been selected|were not selected|will not be proceeding|regret to inform|unable to offer you|decided to go in a different direction)\b/iu,
      )?.[0] ?? null,
  },
  {
    kind: 'reviewing',
    test: (_, sentence) => sentence.match(/\b(?:under review|currently reviewing|reviewing your application|being reviewed)\b/iu)?.[0] ?? null,
  },
  {
    kind: 'received',
    test: (_, sentence) =>
      sentence.match(/\b(?:application (?:has been )?received|received your application|thank you for applying|thanks for applying|application has been submitted|application was submitted)\b/iu)?.[0] ?? null,
  },
  {
    kind: 'recruiter',
    test: (_, sentence) => {
      if (/\b(?:came across your profile|saw your profile|your background caught|impressive background)\b/iu.test(sentence)) return 'profile outreach'
      return /\brecruiter\b/iu.test(sentence) && /\b(?:reached out|reaching out|your profile|your background)\b/iu.test(sentence) ? 'recruiter outreach' : null
    },
  },
]

const STATUS: Record<EmailKind, AppStatus | null> = {
  offer: 'offer', interview: 'interview_scheduled', assessment: 'assessment_pending', rejection: 'rejected',
  reviewing: 'reviewing', received: 'confirmed', recruiter: null, other: null,
}
const ALERT: Record<EmailKind, EmailClassification['alert']> = {
  offer: 'urgent', interview: 'urgent', assessment: 'urgent', recruiter: 'info',
  rejection: 'none', reviewing: 'none', received: 'none', other: 'none',
}

export function classifyEmail(subject: string, body: string): EmailClassification {
  const cleanSubject = normalizeText(subject)
  const parts = [cleanSubject, ...sentences(normalizeText(body))]
  for (const rule of RULES) {
    const evidence = parts.map((sentence) => rule.test(cleanSubject, sentence)).filter((hit): hit is string => hit !== null)
    if (evidence.length > 0) {
      return { kind: rule.kind, suggestedStatus: STATUS[rule.kind], alert: ALERT[rule.kind], evidence: [...new Set(evidence)] }
    }
  }
  return { kind: 'other', suggestedStatus: null, alert: 'none', evidence: [] }
}

/**
 * The application an email is most likely about: the company must appear in the sender or the
 * text; a matching job title breaks ties, then the most recent application. Null when no company matches.
 */
export function matchApplication(
  email: { subject: string; body: string; from?: string },
  applications: readonly Application[],
): Application | null {
  const text = textMatcher(`${email.from ?? ''}\n${email.subject}\n${email.body}`)
  const domain = (email.from ?? '').toLowerCase().match(/@([a-z0-9.-]+)/)?.[1] ?? ''
  const candidates = applications.filter((app) => {
    const company = normalizeCompany(app.company)
    if (company === '') return false
    return text.has(company) || domain.split('.').includes(company.replace(/\s+/g, ''))
  })
  if (candidates.length === 0) return null
  const subject = textMatcher(normalizeTitle(email.subject))
  const appliedAt = (app: Application) => Date.parse(app.appliedAt ?? '') || 0
  return [...candidates].sort((a, b) => {
    const titleA = subject.has(normalizeTitle(a.title)) ? 1 : 0
    const titleB = subject.has(normalizeTitle(b.title)) ? 1 : 0
    return titleB - titleA || appliedAt(b) - appliedAt(a)
  })[0]
}
