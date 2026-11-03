import type { Application, Job, Profile } from './types.ts'

/**
 * Test fixtures for the engine: Sam Rivera, a FICTIONAL new grad, with fictional employers,
 * schools and projects. Imported only by *.test.ts files. Never put real personal data here.
 */

export const TZ = 'America/Toronto'

export function samProfile(): Profile {
  return {
    name: 'Sam Rivera',
    preferredName: 'Sam',
    email: 'sam.rivera@example.com',
    links: { github: 'https://github.com/example-sam' },
    location: { city: 'Hamilton', region: 'Ontario', country: 'Canada', openTo: ['remote', 'hybrid', 'onsite'], relocateTo: ['Ottawa'] },
    authorization: { canada: 'citizen', usRequiresSponsorship: null },
    education: [{ school: 'Harbourview University', degree: 'BSc', field: 'Computer Science', end: '2026-06', status: 'completed' }],
    experience: [
      {
        org: 'Pinecrest Studio',
        title: 'Web Developer Intern',
        start: '2025-05',
        end: '2025-08',
        bullets: ['Built 4 accessible landing pages in React for local clients.'],
        verified: true,
      },
    ],
    projects: [
      { slug: 'trailmix', name: 'Trailmix', oneLiner: 'A hiking trip planner for a university club.', bullets: ['Plans routes across 3 parks.'], stack: ['React', 'TypeScript', 'Supabase'] },
      { slug: 'quizbox', name: 'Quizbox', oneLiner: 'A flashcard app.', bullets: [], stack: ['Python', 'Flask', 'SQLite'] },
    ],
    skills: [
      { name: 'React', level: 'strong' },
      { name: 'JavaScript', level: 'strong' },
      { name: 'Git and GitHub (branches, pull requests)', level: 'strong' },
      { name: 'TypeScript', level: 'working' },
      { name: 'Node.js', level: 'working' },
      { name: 'PostgreSQL and SQL', level: 'working' },
      { name: 'Python', level: 'working' },
      { name: 'Supabase (Postgres, Auth)', level: 'working' },
      { name: 'Tailwind CSS', level: 'working' },
      { name: 'Manual QA and real-device testing', level: 'working' },
      { name: 'Docker', level: 'familiar' },
      { name: 'AWS', level: 'familiar' },
    ],
    targeting: {
      titles: ['Junior Software Developer', 'Software Developer', 'Frontend Developer', 'Full Stack Developer', 'Software Engineer, New Grad'],
      avoidTitles: ['Senior', 'Sr.', 'Staff', 'Lead', 'Principal', 'Manager', 'Engineer II', 'Intern', 'Co-op'],
      locations: ['Remote', 'Remote, Canada', 'Hamilton', 'Toronto', 'Burlington'],
      maxYears: 2,
      dealbreakers: ['5+ years', '7+ years', 'PhD required', 'must be currently enrolled'],
      preferredKeywords: ['React', 'TypeScript', 'new grad', 'junior', 'entry level'],
      industriesPrefer: ['SaaS', 'EdTech'],
      industriesAvoid: ['Gambling'],
    },
    answers: [
      { id: 'work-auth-canada', question: 'Are you legally authorized to work in Canada?', patterns: ['authorized to work in canada', 'eligible to work in canada'], answer: 'Yes' },
      { id: 'work-auth-us', question: 'Are you authorized to work in the United States?', patterns: ['authorized to work in the united states', 'authorized to work in the us'], answer: 'No' },
      { id: 'sponsorship-us', question: 'Will you require sponsorship to work in the US?', patterns: ['sponsorship to work in the us', 'h-1b'], answer: '', needsHuman: true, note: 'Depends on whether the role is remote from Canada.' },
      { id: 'sponsorship', question: 'Will you require visa sponsorship?', patterns: ['require sponsorship', 'visa sponsorship'], answer: 'No' },
      { id: 'salary', question: 'What are your salary expectations?', patterns: ['salary expectation', 'desired salary'], answer: '', needsHuman: true },
      { id: 'start-date', question: 'What is your earliest start date?', patterns: ['earliest start date', 'when can you start'], answer: 'Two weeks after an offer', needsHuman: true },
      { id: 'years-react', question: 'Years of experience with React', patterns: ['experience with react', 'years of react'], answer: '1' },
      { id: 'years-python', question: 'Years of experience with Python', patterns: ['experience with python', 'years of python'], answer: '1', needsHuman: true },
      { id: 'years-professional', question: 'Years of professional experience', patterns: ['years of professional experience', 'years of work experience'], answer: 'Less than 1 year', needsHuman: true },
      { id: 'years-other', question: 'Years of experience with another technology', patterns: ['how many years', 'years of experience with'], answer: '', needsHuman: true },
      { id: 'git', question: 'Do you have experience with Git?', patterns: ['version control'], answer: 'Yes' },
      { id: 'linkedin', question: 'LinkedIn profile', patterns: ['linkedin', 'linkedin profile'], answer: 'https://www.linkedin.com/in/example-sam' },
      { id: 'portfolio', question: 'Portfolio URL', patterns: ['portfolio', 'personal website'], answer: '' },
      { id: 'previously-applied', question: 'Have you previously applied here?', patterns: ['previously applied'], answer: '', needsHuman: true },
    ],
    coverLetter: { signature: 'Sam', maxWords: 150, voiceNotes: [], bannedPhrases: ['passionate', 'rockstar', '\u2014', ';'] },
    facts: [
      { label: 'Degree', value: 'BSc in Computer Science, Harbourview University, 2026', source: 'transcript' },
      { label: 'Trailmix users', value: 'Used by 40 people in a hiking club', source: 'app analytics' },
    ],
  }
}

export function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    id: 'job-1',
    source: 'manual',
    company: 'Northwind Apps',
    title: 'Junior Software Developer',
    location: 'Toronto, ON',
    workplace: 'onsite',
    url: 'https://jobs.example.com/northwind/123',
    postedAt: '2026-11-03T12:00:00.000Z',
    postedAtSource: 'api',
    discoveredAt: '2026-11-03T13:00:00.000Z',
    jdText: '',
    status: 'queued',
    ...overrides,
  }
}

export function makeApplication(overrides: Partial<Application> = {}): Application {
  return {
    id: 'app-1',
    jobId: 'job-1',
    company: 'Northwind Apps',
    title: 'Junior Software Developer',
    url: 'https://jobs.example.com/northwind/123',
    status: 'applied',
    history: [{ status: 'applied', at: '2026-11-02T14:00:00.000Z', by: 'me' }],
    appliedAt: '2026-11-02T14:00:00.000Z',
    channel: 'company_site',
    ...overrides,
  }
}
