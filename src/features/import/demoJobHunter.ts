/**
 * A fictional job-hunter folder for Sam Rivera, the demo persona, from before Sam graduated.
 * It has the quirks of the real old tool: LLM-written scores, a search page saved as the link
 * for two postings, a tailoring log mixed into the application log, "submitted" instead of
 * "applied", a repeated posting, an unknown status and a broken line. The public demo previews
 * it, and the importer's tests use it. Everything here is invented.
 */
import type { JobHunterSource } from '../../jobhunter/map.ts'

const SEARCH_PAGE = 'https://www.linkedin.example.com/jobs/search?keywords=junior%20developer&location=Hamilton'

const queue = [
  {
    id: 'jh-q-0001',
    discovered_at: '2026-04-20T06:00:00Z',
    source: 'company_watchlist',
    title: 'Junior Frontend Engineer',
    company: 'Quillstack',
    location: 'Remote, Canada',
    url: 'https://jobs.lever.co/quillstack-sample/4917c8ed-36ec-450e-a90e-b5ed03c9963f?lever-source=watchlist',
    description_snippet: 'React and TypeScript, 0-2 years of experience.',
    score: 78,
    score_breakdown: { title_match: 20, skill_overlap: 30, experience_fit: 25, location_match: 10, tech_alignment: 9, bonus: 8 },
    status: 'queued',
    applied: false,
    response: null,
    notes: 'Tier 1. Strong match.',
  },
  {
    id: 'jh-q-0002',
    discovered_at: '2026-04-21T06:00:00Z',
    source: 'linkedin',
    title: 'Junior Software Developer',
    company: 'Tidewater Robotics',
    location: 'Hamilton, ON, Canada (Hybrid)',
    url: SEARCH_PAGE,
    description_snippet: '1-2 years of professional experience with JavaScript.',
    score: 95,
    score_breakdown: { title_match: 20, skill_overlap: 30, experience_fit: 25, location_match: 8, tech_alignment: 9, bonus: 8 },
    status: 'tailored',
    applied: false,
    response: null,
    notes: 'Tier 1. Posted today. PRIORITY APPLY.',
    tailored_at: '2026-04-21T10:50:00Z',
    cover_letter: 'output/covers/Tidewater_Robotics_2026-04-21.txt',
  },
  {
    id: 'jh-q-0003',
    discovered_at: '2026-04-21T06:00:00Z',
    source: 'linkedin',
    title: 'Software Developer, New Grad',
    company: 'Ferngully Foods',
    location: 'Burlington, ON, Canada',
    url: SEARCH_PAGE,
    description_snippet: 'New grads welcome.',
    score: 88,
    score_breakdown: { title_match: 20, skill_overlap: 22, experience_fit: 25, location_match: 10, tech_alignment: 6, bonus: 5 },
    status: 'queued',
    applied: false,
    response: null,
    notes: 'Tier 1.',
  },
  {
    id: 'jh-q-0004',
    discovered_at: '2026-04-22T19:46:46.023Z',
    source: 'watchlist_api',
    ats: 'lever',
    title: 'Frontend Developer',
    company: 'Bluejay Transit',
    location: 'Toronto, ON',
    url: 'https://jobs.lever.co/bluejay-sample/5c1d2e3f-0000-4000-8000-000000000004',
    posted_at: '2026-04-02T14:05:39-04:00',
    description_snippet: '',
    score: 49,
    score_breakdown: { title_match: 15, skill_overlap: 15, experience_fit: 2, location_match: 10, tech_alignment: 5, bonus: 2 },
    status: 'skipped_age',
    applied: false,
    response: null,
    notes: 'Too old (20 days).',
  },
  {
    id: 'jh-q-0005',
    discovered_at: '2026-04-23T06:00:00Z',
    source: 'linkedin',
    title: 'Frontend Developer',
    company: 'Bluejay Transit',
    location: 'Toronto, ON',
    url: 'https://jobs.lever.co/bluejay-sample/5c1d2e3f-0000-4000-8000-000000000004?utm_source=linkedin',
    description_snippet: '',
    score: 60,
    score_breakdown: {},
    status: 'queued',
    applied: false,
    response: null,
    notes: '',
  },
  {
    id: 'jh-q-0006',
    discovered_at: '2026-04-24T06:00:00Z',
    source: 'indeed',
    title: 'Web Developer',
    company: 'Northbeam Studio',
    location: 'Oakville, ON',
    url: 'https://ca.indeed.example.com/viewjob?jk=sample0006',
    description_snippet: '',
    score: 70,
    score_breakdown: {},
    status: 'priority_apply',
    applied: false,
    response: null,
    notes: '',
  },
]

const applications = [
  {
    id: 'tailor-log-0002',
    tailored_at: '2026-04-21T10:50:00Z',
    company: 'Tidewater Robotics',
    title: 'Junior Software Developer',
    source: 'linkedin',
    score: 95,
    tailor_strategy: 'full_ai',
    resume_pdf: 'output/resumes/Sam_Rivera_Resume_Tidewater.pdf',
  },
  {
    applied_at: '2026-04-22T20:37:17Z',
    company: 'Tidewater Robotics',
    title: 'Junior Software Developer',
    source: 'linkedin_easy_apply',
    url: 'https://www.linkedin.example.com/jobs/view/sample-4401',
    score: 95,
    tier: 1,
    resume: 'output/resumes/Sam_Rivera_Resume.pdf',
    status: 'submitted',
    notes: 'Easy Apply. Years: React=1.',
  },
  {
    applied_at: '2026-04-23T15:02:00Z',
    company: 'Ferngully Foods',
    title: 'Software Developer, New Grad',
    source: 'linkedin_easy_apply',
    url: 'https://www.linkedin.example.com/jobs/view/sample-4402',
    score: 88,
    tier: 1,
    resume: 'output/resumes/Sam_Rivera_Resume.pdf',
    status: 'submitted',
    notes: '',
  },
  {
    applied_at: '2026-04-24T13:15:00Z',
    company: 'Pinecrest Analytics',
    title: 'Associate Software Engineer',
    source: 'direct_career_page',
    url: 'https://boards.greenhouse.io/pinecrest-sample/jobs/4012018',
    score: 66,
    tier: 2,
    resume: 'output/resumes/Sam_Rivera_Resume.pdf',
    status: 'submitted',
    notes: 'Applied on the company site.',
  },
  {
    applied_at: '2026-04-25T16:40:00Z',
    company: 'Harbourlight Health',
    title: 'Junior Developer',
    source: 'indeed',
    url: 'https://ca.indeed.example.com/viewjob?jk=sample0010',
    score: 72,
    tier: 2,
    resume: 'output/resumes/Sam_Rivera_Resume.pdf',
    status: 'submitted',
    notes: '',
  },
  {
    applied_at: '2026-05-02T12:00:00Z',
    company: 'Harbourlight Health',
    title: 'Junior Developer',
    source: 'indeed',
    url: 'https://ca.indeed.example.com/viewjob?jk=sample0010',
    score: 72,
    tier: 2,
    resume: 'output/resumes/Sam_Rivera_Resume.pdf',
    status: 'submitted',
    notes: 'Applied again after the posting was refreshed.',
  },
  { company: 'Northbeam Studio', title: 'Web Developer', status: 'maybe_later', source: 'indeed' },
]

const deck = {
  id: 'sam-old-notes',
  title: 'Notes from the old tool',
  description: 'Two questions Sam wrote while using job-hunter. One card is missing its kind, so the import leaves it out.',
  cards: [
    {
      id: 'sam-old-why-local',
      kind: 'design',
      prompt: 'Why keep job-search data on your own computer?',
      answer: 'Applications hold personal details. Keeping them in a local folder means **nothing is uploaded**, and the public demo only ever sees fictional data.',
      keyPoints: ['Personal details stay local', 'The demo uses fictional data'],
      difficulty: 1,
      tags: ['privacy'],
    },
    {
      id: 'sam-old-broken',
      prompt: 'A card without a kind',
      answer: 'Left out by the import.',
      keyPoints: [],
      difficulty: 1,
      tags: [],
    },
  ],
}

const exercises = [
  {
    id: 'sam-old-exercise-csv',
    title: 'Export applications as CSV',
    goal: 'Escaping values and writing files without a library.',
    spec: 'Write `toCsv(rows)` that quotes any value with a comma, a quote or a newline.',
    acceptance: ['Commas are quoted', 'Quotes are doubled', 'Newlines stay inside the cell'],
    timeboxMinutes: 30,
  },
]

const stories = [
  {
    id: 'sam-old-story-deadline',
    title: 'Shipping the club app before the term ended',
    situation: 'The book club needed the swap app before exams.',
    task: 'Finish the trade flow in two weeks.',
    action: 'Cut the chat feature and kept the trade flow small.',
    result: 'The club used it for the rest of the term.',
    source: 'Capstone report (fictional)',
    skills: ['Scoping'],
    questions: ['Tell me about a deadline you met.'],
  },
]

const companies = [
  { name: 'Quillstack', ats: 'lever', slug: 'quillstack-sample', verified: true },
  { name: 'Bluejay Transit', ats: 'lever', slug: 'bluejay-sample', verified: false, notes: 'Slug from a search result; not probed yet.' },
]

const jsonl = (rows: readonly object[]) => rows.map((row) => JSON.stringify(row)).join('\n')

export const DEMO_JOBHUNTER_SOURCE: JobHunterSource = {
  queue: { path: 'data/job_queue.jsonl', text: `${jsonl(queue)}\n{"id": "jh-q-0007", "company": \n` },
  applications: { path: 'data/applications.jsonl', text: `${jsonl(applications)}\n` },
  jobs: [],
  companies: { path: 'copilot-data/companies.json', text: JSON.stringify(companies) },
  decks: [{ path: 'copilot-data/practice/decks/sam-old-notes.json', text: JSON.stringify(deck) }],
  exercises: [{ path: 'copilot-data/practice/exercises.json', text: JSON.stringify(exercises) }],
  stories: [{ path: 'copilot-data/practice/stories.json', text: JSON.stringify(stories) }],
}

/** The folder name the demo pretends to read. */
export const DEMO_FOLDER = '../job-hunter (demo)'
