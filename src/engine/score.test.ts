import { describe, expect, it } from 'vitest'
import { makeJob, samProfile } from './fixtures.ts'
import { factsFor, RUBRIC_VERSION, scoreJob } from './score.ts'
import type { Job, Profile, ScoreResult } from './types.ts'

const NOW = '2026-11-03T15:00:00.000Z'
const FRESH = '2026-11-03T12:00:00.000Z'

const sum = (result: ScoreResult) => result.parts.reduce((total, part) => total + part.points, 0)
const pointsFor = (result: ScoreResult, key: string) => result.parts.find((part) => part.key === key)?.points
const score = (job: Partial<Job>, profile: Profile = samProfile()) => scoreJob(makeJob({ postedAt: FRESH, ...job }), profile, NOW)

const IDEAL: Partial<Job> = {
  title: 'Junior Software Developer',
  location: 'Toronto, ON',
  workplace: 'onsite',
  industry: 'SaaS',
  companySize: 50,
  jdText: 'Junior role. 0-2 years of experience with React, TypeScript, JavaScript, Node.js, PostgreSQL, Tailwind and Git.',
}

describe('the total', () => {
  const cases: Partial<Job>[] = [
    IDEAL,
    { title: 'Software Developer', jdText: '' },
    { title: 'Backend Developer', location: 'Calgary, AB', jdText: 'Kotlin and Java. 2-4 years of experience.' },
    { title: 'Frontend Developer', jdText: '3-5 years of experience with React.' },
    { title: 'Senior Software Engineer', jdText: '7+ years of experience.' },
    { title: 'Developer', workplace: 'remote', location: 'Remote - US', jdText: 'Python.' },
  ]

  it.each(cases)('equals the sum of the parts and stays within 0-100: %j', (job) => {
    const result = score(job)
    expect(result.total).toBe(sum(result))
    expect(result.total).toBeGreaterThanOrEqual(0)
    expect(result.total).toBeLessThanOrEqual(100)
    expect(result.rubricVersion).toBe(RUBRIC_VERSION)
    for (const part of result.parts) expect(part.reason.length).toBeGreaterThan(0)
  })

  it('caps a perfect match at 100 with a visible adjustment', () => {
    const result = score(IDEAL)
    expect(result.parts.map((part) => [part.key, part.points])).toEqual([
      ['title', 20],
      ['skills', 30],
      ['experience', 15],
      ['levelBonus', 10],
      ['experiencePenalty', 0],
      ['location', 10],
      ['tech', 15],
      ['other', 10],
      ['cap', -10],
    ])
    expect(result.total).toBe(100)
    expect(result.tier).toBe(1)
    expect(result.gate.verdict).toBe('apply')
  })
})

describe('title match', () => {
  it.each([
    ['Junior Software Developer', 20],
    ['junior software developer', 20],
    ['Software Developer, Platform', 15],
    ['Frontend Developer (Remote)', 20],
    ['Junior Frontend Developer', 15],
    ['Backend Developer', 10],
    ['Platform Engineer', 10],
    ['Developer', 5],
  ])('%s -> %s', (title, points) => {
    expect(pointsFor(score({ title, jdText: '' }), 'title')).toBe(points)
  })

  it('disqualifies a title that is not a software role', () => {
    const result = score({ title: 'Marketing Coordinator', jdText: '' })
    expect(result.disqualifiers).toContain('Not a software role.')
    expect(pointsFor(result, 'title')).toBe(0)
  })
})

describe('skill overlap bands', () => {
  // Sam knows React, TypeScript, Node.js and PostgreSQL well; Kotlin, Java, Scala, Elixir and PHP not at all.
  it.each([
    ['React, TypeScript, Node.js, PostgreSQL, Python', 30],
    ['React, TypeScript, Node.js, PostgreSQL, Kotlin', 30],
    ['React, TypeScript, Node.js, Kotlin', 22],
    ['React, TypeScript, Node.js, Kotlin, Java', 22],
    ['React, TypeScript, Kotlin, Java', 15],
    ['React, TypeScript, Kotlin, Java, Scala', 15],
    ['React, Kotlin, Java, Scala, Elixir', 8],
    ['React, Kotlin, Java, Scala, Elixir, PHP', 3],
    ['Kotlin, Java, Scala', 3],
    ['', 3],
  ])('%s -> %s', (skills, points) => {
    expect(pointsFor(score({ title: 'Software Developer', jdText: skills }), 'skills')).toBe(points)
  })

  it('does not count nice-to-have skills against you', () => {
    const result = score({ title: 'Software Developer', jdText: 'React, TypeScript, Node.js and PostgreSQL. Kotlin and Java are a plus.' })
    expect(pointsFor(result, 'skills')).toBe(30)
  })

  it('counts familiar skills as missing', () => {
    const result = score({ title: 'Software Developer', jdText: 'Docker and AWS.' })
    expect(pointsFor(result, 'skills')).toBe(3)
    expect(result.parts.find((part) => part.key === 'skills')?.reason).toMatch(/Not strong yet: Docker, AWS/)
  })
})

describe('experience', () => {
  it.each([
    ['New grad role. React.', 'Software Developer', 15, 10, 0],
    ['1-3 years of experience.', 'Software Developer', 12, 5, 0],
    ['2-4 years of experience.', 'Software Developer', 8, 0, 0],
    ['', 'Software Developer', 2, 0, 0],
  ])('%s -> base %s, bonus %s, penalty %s', (jdText, title, base, bonus, penalty) => {
    const result = score({ title, jdText })
    expect([pointsFor(result, 'experience'), pointsFor(result, 'levelBonus'), pointsFor(result, 'experiencePenalty')]).toEqual([base, bonus, penalty])
  })

  it('allows a 3-5 year stretch past the limit, but only at 80 or more', () => {
    const weak = score({ title: 'Software Developer', jdText: '3-5 years of experience.' })
    expect(weak.disqualifiers).toEqual([])
    expect(weak.tier).toBe(3)
    expect(pointsFor(weak, 'experiencePenalty')).toBe(-5)
    expect(weak.gate.verdict).toBe('skip')
    expect(weak.gate.reason).toMatch(/stretch and needs 80/)

    const strong = score({ ...IDEAL, title: 'Software Developer', jdText: `${IDEAL.jdText?.replace('Junior role. 0-2', '3-5')} Junior friendly team.` })
    expect(strong.total).toBeGreaterThanOrEqual(80)
    expect(strong.gate.verdict).toBe('apply')
  })

  it.each([
    ['3+ years of experience.', 'Asks for 3+ years; your limit is 2.'],
    ['4-6 years of experience.', 'Asks for 4+ years; your limit is 2.'],
    ['4+ years as a software engineer.', 'Asks for 4+ years; your limit is 2.'],
    ['4+ years as a full-stack developer.', 'Asks for 4+ years; your limit is 2.'],
    ['Requirements\nExperience: 4+ years', 'Asks for 4+ years; your limit is 2.'],
    ['Requirements\nYears of experience: 4+', 'Asks for 4+ years; your limit is 2.'],
    ['4 years of relevant work in a SaaS company.', 'Asks for 4+ years; your limit is 2.'],
    ['You bring 4+ years shipping production web apps.', 'Asks for 4+ years; your limit is 2.'],
  ])('disqualifies "%s"', (jdText, message) => {
    const result = score({ title: 'Software Developer', jdText })
    expect(result.disqualifiers).toContain(message)
    expect(result.total).toBe(0)
    expect(result.gate.verdict).toBe('skip')
  })

  it('does not allow the stretch when the limit is far below it', () => {
    const profile = samProfile()
    profile.targeting.maxYears = 1
    expect(score({ title: 'Software Developer', jdText: '3-5 years of experience.' }, profile).disqualifiers).toContain(
      'Asks for 3+ years; your limit is 1.',
    )
  })
})

describe('location', () => {
  it.each<[Partial<Job>, number]>([
    [{ workplace: 'remote', location: 'Remote - Canada' }, 10],
    [{ workplace: 'remote', location: 'Remote - US' }, 0],
    [{ workplace: 'remote', location: 'Remote - U.S.' }, 0],
    [{ workplace: 'onsite', location: 'Toronto, ON' }, 10],
    [{ workplace: 'hybrid', location: 'Burlington, Ontario' }, 8],
    [{ workplace: 'onsite', location: 'Ottawa, ON' }, 10],
    [{ workplace: 'onsite', location: 'Calgary, AB' }, 0],
    [{ workplace: 'unknown', location: 'Hamilton (Hybrid)' }, 8],
  ])('%j -> %s', (job, points) => {
    expect(pointsFor(score({ title: 'Software Developer', jdText: '', ...job }), 'location')).toBe(points)
  })

  it('accepts US remote when the targets include it', () => {
    const profile = samProfile()
    profile.targeting.locations.push('Remote, US')
    expect(pointsFor(score({ title: 'Software Developer', workplace: 'remote', location: 'Remote - US' }, profile), 'location')).toBe(10)
  })

  it('gives nothing for a workplace the profile is not open to', () => {
    const profile = samProfile()
    profile.location.openTo = ['remote']
    const result = score({ title: 'Software Developer', workplace: 'onsite', location: 'Toronto, ON' }, profile)
    expect(pointsFor(result, 'location')).toBe(0)
    expect(result.parts.find((part) => part.key === 'location')?.reason).toBe('On-site work, which you are not open to.')
  })
})

describe('tech alignment', () => {
  it('scores 3, 2 and 1 by level and caps at 15', () => {
    expect(pointsFor(score({ title: 'Software Developer', jdText: 'React' }), 'tech')).toBe(3)
    expect(pointsFor(score({ title: 'Software Developer', jdText: 'TypeScript' }), 'tech')).toBe(2)
    expect(pointsFor(score({ title: 'Software Developer', jdText: 'Docker' }), 'tech')).toBe(1)
    expect(pointsFor(score({ title: 'Software Developer', jdText: 'Manual QA on real devices' }), 'tech')).toBe(2)
    const many = score({ title: 'Software Developer', jdText: 'React, JavaScript, Git, TypeScript, Node.js, Python, Tailwind' })
    expect(pointsFor(many, 'tech')).toBe(15)
    expect(many.parts.find((part) => part.key === 'tech')?.reason).toMatch(/capped at 15/)
  })

  it('does not count a tool named only inside another skill', () => {
    // "Supabase (Postgres, Auth)" is not mentioned by a posting that says PostgreSQL.
    expect(pointsFor(score({ title: 'Software Developer', jdText: 'PostgreSQL' }), 'tech')).toBe(2)
  })
})

describe('other signals', () => {
  it.each<[Partial<Job>, number]>([
    [{ jdText: 'React' }, 2],
    [{ jdText: 'React, TypeScript, entry level, new grad' }, 6],
    [{ jdText: '', industry: 'SaaS' }, 2],
    [{ jdText: '', industry: 'Gaming' }, 0],
    [{ jdText: '', companySize: 10 }, 2],
    [{ jdText: '', companySize: 500 }, 2],
    [{ jdText: '', companySize: 9 }, 0],
    [{ jdText: '', companySize: 501 }, 0],
    [{ jdText: 'React, TypeScript, entry level', industry: 'SaaS', companySize: 40 }, 10],
  ])('%j -> %s', (job, points) => {
    expect(pointsFor(score({ title: 'Software Developer', ...job }), 'other')).toBe(points)
  })
})

describe('disqualifiers', () => {
  it.each<[Partial<Job>, string]>([
    [{ title: 'Senior Software Developer' }, 'Title contains "Senior", on your avoid list.'],
    [{ title: 'Sr Software Developer' }, 'Title contains "Senior", on your avoid list.'],
    [{ title: 'Lead Software Developer, Staff' }, 'Title contains "Staff", "Lead", on your avoid list.'],
    [{ title: 'Software Developer Intern' }, 'Title contains "Intern", on your avoid list.'],
    [{ title: 'Software Developer', jdText: '7+ years of experience.' }, 'Mentions "7+ years", one of your dealbreakers.'],
    [{ title: 'Software Developer', jdText: 'PhD required.' }, "Requires a master's or PhD."],
    [{ title: 'Software Developer', jdText: 'Candidates must reside in the United States.' }, 'Requires US residence or work authorization.'],
    [{ title: 'Software Developer', jdText: 'You must be currently enrolled in a degree program.' }, 'Requires current enrollment as a student.'],
    [{ title: 'Software Developer', industry: 'Gambling' }, 'Gambling is an industry you avoid.'],
  ])('%j', (job, message) => {
    const result = score(job)
    expect(result.disqualifiers).toContain(message)
    expect(result.total).toBe(0)
    expect(sum(result)).toBe(0)
    expect(result.tier).toBeNull()
    expect(result.gate.verdict).toBe('skip')
    expect(result.parts.at(-1)?.key).toBe('disqualified')
  })

  it('does not treat "Internal Tools" as an internship', () => {
    expect(score({ title: 'Internal Tools Developer' }).disqualifiers).toEqual([])
  })

  it('lets a US-authorized profile through a US-only posting', () => {
    const profile = samProfile()
    profile.authorization.usRequiresSponsorship = false
    expect(score({ title: 'Software Developer', jdText: 'Must reside in the United States.' }, profile).disqualifiers).toEqual([])
  })

  it('lets a current student through an enrollment requirement', () => {
    const profile = samProfile()
    profile.education[0].status = 'in_progress'
    profile.targeting.dealbreakers = []
    expect(score({ title: 'Software Developer', jdText: 'You must be currently enrolled.' }, profile).disqualifiers).toEqual([])
  })

  it('keeps the would-be score in the explanation', () => {
    const result = score({ ...IDEAL, title: 'Senior Software Developer' })
    expect(result.parts.at(-1)?.reason).toMatch(/^Would score \d+, but: Title contains "Senior"/)
  })
})

describe('gate and facts', () => {
  it('holds a job with no posting date', () => {
    const result = scoreJob(makeJob({ ...IDEAL, postedAt: null }), samProfile(), NOW)
    expect(result.gate.verdict).toBe('hold')
    expect(result.total).toBeGreaterThan(0)
  })

  it("passes the profile's posting-age limit and the job's verified flag to the gate", () => {
    const old = new Date(Date.parse(NOW) - 10 * 86_400_000).toISOString()
    expect(scoreJob(makeJob({ ...IDEAL, postedAt: old }), samProfile(), NOW).gate.verdict).toBe('hold')
    const strict = samProfile()
    strict.targeting.maxPostingAgeDays = 7
    expect(scoreJob(makeJob({ ...IDEAL, postedAt: old }), strict, NOW).gate.verdict).toBe('skip')
    expect(scoreJob(makeJob({ ...IDEAL, postedAt: old, verified: true }), strict, NOW).gate.verdict).toBe('hold')
  })

  it('uses facts stored on the job over extracted ones', () => {
    const job = makeJob({ title: 'Software Developer', jdText: '3+ years of experience.', facts: { yearsMin: 1, yearsMax: 2 } })
    expect(factsFor(job).yearsMin).toBe(1)
    expect(scoreJob(job, samProfile(), NOW).disqualifiers).toEqual([])
  })
})
