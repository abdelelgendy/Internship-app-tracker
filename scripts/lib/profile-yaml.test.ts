import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { parse } from 'yaml'
import { dateRange, monthOf, profileFromYaml } from './profile-yaml.ts'

const fixture = parse(readFileSync(new URL('../fixtures/jobhunter/config/profile.yaml', import.meta.url), 'utf8'))

describe('monthOf and dateRange', () => {
  it.each([
    ['Oct 2026', '2026-10'],
    ['about Sep 2024', '2024-09'],
    ['September 2022', '2022-09'],
    ['October 15, 2026', '2026-10'],
    ['2025-05', '2025-05'],
    ['2021', '2021'],
    ['soon', null],
  ])('reads %s as %s', (text, month) => {
    expect(monthOf(text)).toBe(month)
  })

  it.each([
    ['Jun 2026 to present', { start: '2026-06', end: null }],
    ['Feb 2026 to Mar 2026', { start: '2026-02', end: '2026-03' }],
    ['about Sep 2024 to Nov 2024', { start: '2024-09', end: '2024-11' }],
    ['May 2025 - Aug 2025', { start: '2025-05', end: '2025-08' }],
    ['Jan 2024', { start: '2024-01', end: null }],
    ['', null],
  ])('reads the range %s', (text, range) => {
    expect(dateRange(text)).toEqual(range)
  })
})

describe('profileFromYaml', () => {
  const { profile, unverified, heldBack, gaps } = profileFromYaml(fixture)

  it('maps identity, links, location and authorization', () => {
    expect(profile.name).toBe('Sam Rivera')
    expect(profile.preferredName).toBe('Sam')
    expect(profile.email).toBe('sam.rivera@example.com')
    expect(profile.links.github).toBe('https://github.example.com/sam-rivera-sample')
    expect(profile.location).toEqual({ city: 'Hamilton', region: 'ON', country: 'Canada', openTo: ['remote', 'hybrid'], relocateTo: ['Toronto', 'Waterloo'] })
    expect(profile.authorization.canada).toBe('citizen')
    // Not authorized for the US: whether a US role needs sponsorship is decided per job.
    expect(profile.authorization.usRequiresSponsorship).toBeNull()
  })

  it('imports every job as unverified, with its bullets, including the invented one', () => {
    expect(profile.experience).toHaveLength(2)
    expect(profile.experience.every((job) => job.verified === false)).toBe(true)
    const invented = profile.experience.find((job) => job.org === 'Orbital Widgets')
    expect(invented).toMatchObject({ start: '2024-01', end: null, bullets: ['Cut page load time by 40% for 2 million users'] })
    expect(unverified.filter((item) => item.kind === 'experience').map((item) => item.text)).toEqual([
      'Software Developer Co-op at Northwind Labs (May 2025 to Aug 2025)',
      'Lead Engineer at Orbital Widgets (Jan 2024 to present)',
    ])
  })

  it('holds project bullets back instead of putting them where the cover letter check would trust them', () => {
    expect(profile.projects).toEqual([{ slug: 'shelfmate', name: 'Shelfmate', oneLiner: '', bullets: [], stack: [] }])
    expect(heldBack).toEqual([{ project: 'Shelfmate', bullets: ['Recorded each swap in one PostgreSQL transaction'] }])
    expect(unverified.filter((item) => item.kind === 'bullet')).toHaveLength(3)
    expect(profile.facts).toEqual([])
  })

  it('marks every saved answer "answer it yourself" and never carries a demographic value', () => {
    expect(profile.answers.every((answer) => answer.needsHuman === true)).toBe(true)
    const byQuestion = Object.fromEntries(profile.answers.map((answer) => [answer.question, answer]))
    expect(byQuestion['Years of experience with React']).toMatchObject({ answer: '4', patterns: ['years of experience with react'] })
    expect(byQuestion['Gender'].answer).toBe('')
    expect(byQuestion['What are your salary expectations?'].note).toMatch(/Left empty/)
    expect(JSON.stringify(profile)).not.toContain('Prefer not to say')
    expect(unverified.filter((item) => item.kind === 'answer').map((item) => item.text)).toEqual([
      'Are you legally authorized to work in Canada? -> Yes',
      'Years of experience with React -> 4',
    ])
  })

  it('maps skill levels and targeting', () => {
    expect(profile.skills).toEqual([
      { name: 'TypeScript', level: 'strong' },
      { name: 'Python', level: 'working' },
      { name: 'SQL', level: 'working' },
      { name: 'Go', level: 'familiar' },
      { name: 'React', level: 'strong' },
      { name: 'Svelte', level: 'familiar' },
    ])
    expect(profile.targeting).toMatchObject({ titles: ['Junior Software Developer', 'New Grad Software Engineer'], maxYears: 3, industriesAvoid: ['Gambling'] })
  })

  it('reads unclear education wording as in progress and says so', () => {
    expect(profile.education[0]).toMatchObject({ school: 'Lakeshore University', start: '2022-09', end: '2026-06', status: 'in_progress' })
    expect(gaps).toContain('education.status (read as in progress; check it)')
  })

  it('survives a file with nothing it understands', () => {
    const empty = profileFromYaml('just a string')
    expect(empty.profile.experience).toEqual([])
    expect(empty.gaps).toEqual(expect.arrayContaining(['personal.first_name and last_name', 'personal.email', 'education.school']))
  })
})
