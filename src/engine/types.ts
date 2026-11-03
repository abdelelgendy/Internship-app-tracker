/**
 * Shared data contract for "Shortlist", Abdel's local-first job-search copilot
 * (built in the public repo abdelelgendy/Internship-app-tracker).
 *
 * Every file in the copilot's data directory follows these types. Two independent
 * builds depend on this contract:
 *   1. the copilot app (engine, UI, Node scripts), which reads and writes the files;
 *   2. the private career work in abdelelgendy/job-hunter, which produces Abdel's real
 *      data in job-hunter/copilot-data/ (profile, practice decks, job leads) for the
 *      copilot to import.
 * Change a type only in a backwards-compatible way (add optional fields).
 *
 * DATA DIRECTORY (env COPILOT_DATA_DIR, default "<repo>/.private", always gitignored):
 *   profile.json                 Profile
 *   jobs.jsonl                   one Job per line
 *   applications.jsonl           one Application per line
 *   companies.json               Company[] (scanner watchlist)
 *   practice/decks/*.json        one PracticeDeck per file
 *   practice/exercises.json      Exercise[]
 *   practice/stories.json        StarStory[]
 *   practice/progress.json       PracticeProgress
 *   covers/<applicationId>.md    cover letter drafts
 *   denylist.txt                 strings that must never be committed (pre-commit guard)
 * The public repo ships the same layout under sample-data/ with a FICTIONAL persona.
 *
 * Dates are ISO 8601 strings in UTC. Ids are stable slugs or UUIDs.
 */

// ---------- Jobs and applications ----------

export type QueueStatus =
  | 'queued' | 'shortlisted' | 'skipped_age' | 'skipped_dealbreaker'
  | 'skipped_duplicate' | 'skipped_ghost' | 'expired' | 'archived'

export type AppStatus =
  | 'draft' | 'prepared' | 'applied' | 'confirmed' | 'reviewing'
  | 'assessment_pending' | 'interview_scheduled' | 'offer'
  | 'rejected' | 'ghosted' | 'withdrawn'

export type Workplace = 'remote' | 'hybrid' | 'onsite' | 'unknown'

export interface JobFacts {
  level?: 'intern' | 'new_grad' | 'junior' | 'mid' | 'senior' | 'unknown'
  yearsMin?: number | null
  yearsMax?: number | null
  skills?: string[]            // normalized skill names found in the description
  usOnly?: boolean             // explicitly requires US work authorization or residence
  requiresEnrollment?: boolean // co-op or internship that requires being a current student
  ghostPhrases?: string[]
  salaryText?: string | null
  advancedDegreeRequired?: boolean // a master's or PhD is required, with no bachelor's or equivalent route
}

export interface ScoreResult {
  total: number                // 0-100, always equal to the sum of the parts, clamped
  parts: { key: string; label: string; points: number; max: number; reason: string }[]
  tier: 1 | 2 | 3 | null       // null when disqualified
  disqualifiers: string[]
  gate: { verdict: 'apply' | 'hold' | 'skip'; reason: string }
  rubricVersion: string
}

export interface Job {
  id: string
  source: string               // 'greenhouse' | 'ashby' | 'lever' | 'web-search' | 'manual' | 'job-hunter-import' | ...
  ats?: 'greenhouse' | 'ashby' | 'lever' | 'workday' | 'other'
  company: string
  title: string
  location: string
  workplace: Workplace
  url: string
  postedAt: string | null
  postedAtSource: 'api' | 'manual' | 'search-snippet' | 'unknown'
  discoveredAt: string
  verified?: boolean           // false for leads from web search that a human has not opened yet
  jdText?: string
  facts?: JobFacts
  score?: ScoreResult
  status: QueueStatus
  notes?: string
  industry?: string            // e.g. 'SaaS'; matched against the profile's industriesPrefer/Avoid
  companySize?: number         // employees; 10-500 earns the company-size bonus
}

export interface Application {
  id: string
  jobId: string
  company: string
  title: string
  url: string
  status: AppStatus
  history: { status: AppStatus; at: string; by: 'me' | 'inbox-rule' | 'import' }[]
  appliedAt?: string
  channel: 'company_site' | 'ats' | 'easy_apply' | 'email' | 'referral' | 'unknown'
  resumeVersion?: string
  coverLetterId?: string
  answersUsed?: Record<string, string>   // exactly what was submitted, for consistency later
  followUp?: { dueAt: string; sentAt?: string }
  contacts?: { name: string; role?: string; email?: string; linkedin?: string; notes?: string }[]
  interviews?: { at: string; kind: string; with?: string; notes?: string; outcome?: string }[]
  notes?: string
}

export interface Company {
  name: string
  ats: 'greenhouse' | 'ashby' | 'lever' | 'manual'
  slug?: string                // board token, e.g. boards-api.greenhouse.io/v1/boards/<slug>/jobs
  careersUrl?: string
  verified: boolean            // slug confirmed to return a board
  notes?: string
}

// ---------- Profile (PRIVATE: never committed to the public repo) ----------

export type SkillLevel = 'strong' | 'working' | 'familiar'

export interface Profile {
  name: string
  preferredName: string
  email: string
  phone?: string
  links: { linkedin?: string; github?: string; portfolio?: string }
  location: { city: string; region: string; country: string; openTo: Workplace[]; relocateTo: string[] }
  authorization: { canada: 'citizen' | 'pr' | 'permit' | 'none'; usRequiresSponsorship: boolean | null; notes?: string }
  education: { school: string; degree: string; field: string; start?: string; end?: string; status: 'completed' | 'in_progress'; notes?: string }[]
  experience: { org: string; title: string; start: string; end: string | null; location?: string; summary?: string; bullets: string[]; verified: boolean }[]
  projects: { slug: string; name: string; oneLiner: string; bullets: string[]; stack: string[]; url?: string }[]
  skills: { name: string; level: SkillLevel; evidence?: string }[]   // evidence: a project slug or file
  targeting: {
    titles: string[]; avoidTitles: string[]; locations: string[]; maxYears: number;
    dealbreakers: string[]; preferredKeywords: string[]; industriesPrefer?: string[]; industriesAvoid?: string[]
  }
  answers: { id: string; question: string; patterns: string[]; answer: string; needsHuman?: boolean; note?: string }[]
  coverLetter: { signature: string; maxWords: number; voiceNotes: string[]; bannedPhrases: string[] }
  facts: { label: string; value: string; source: string }[]   // approved, verifiable claims a cover letter may use
}

// ---------- Practice (PRIVATE content for Abdel; sample-data/ has a fictional deck) ----------

export type CardKind = 'concept' | 'explain' | 'design' | 'behavioral' | 'code' | 'dsa' | 'system-design' | 'ai-workflow'

export interface PracticeCard {
  id: string                   // stable, unique across all decks, e.g. 'apex-watch-credit-1'
  kind: CardKind
  prompt: string               // the interview-style question
  answer: string               // model answer in Markdown, grounded in the real code
  keyPoints: string[]          // 3-6 checkpoints the learner self-grades against
  source?: string              // file:line or doc that backs the answer (private repos are fine here)
  difficulty: 1 | 2 | 3
  tags: string[]
}

export interface PracticeDeck {
  id: string
  title: string
  project?: string             // project slug, when the deck is about one project
  description: string
  cards: PracticeCard[]
}

export interface Exercise {
  id: string
  title: string
  project?: string
  goal: string                 // the skill it rebuilds
  spec: string                 // Markdown: what to build, without AI, from scratch
  acceptance: string[]         // checks that prove it works
  timeboxMinutes: number
  hints?: string[]
}

export interface StarStory {
  id: string
  title: string
  situation: string
  task: string
  action: string
  result: string               // honest; no invented numbers
  source: string               // where the story is documented
  skills: string[]
  questions: string[]          // interview questions this story answers
}

export interface PracticeProgress {
  cards: Record<string, { box: 1 | 2 | 3 | 4 | 5; dueAt: string; lastGrade?: 'again' | 'hard' | 'good' | 'easy'; reviews: number; lastReviewedAt?: string }>
  exercises: Record<string, { status: 'todo' | 'doing' | 'done'; startedAt?: string; doneAt?: string; notes?: string }>
  streak: { current: number; best: number; lastDay?: string }
}
