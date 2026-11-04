import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { renderApp } from '@/test/renderApp.tsx'
import { sampleSource } from '@/test/sampleSource.ts'
import { cleanProfile, isDemographicAnswer, validateProfile } from './profileForm.ts'

const LOCAL = { kind: 'local', dataDir: '/tmp/shortlist-test' } as const

describe('profile form rules', () => {
  it('flags demographic answers by id or wording', () => {
    expect(isDemographicAnswer({ id: 'eeo', question: 'Demographic questions', patterns: [] })).toBe(true)
    expect(isDemographicAnswer({ id: 'q1', question: 'What is your gender identity?', patterns: [] })).toBe(true)
    expect(isDemographicAnswer({ id: 'q2', question: 'Do you identify as a veteran?', patterns: [] })).toBe(true)
    expect(isDemographicAnswer({ id: 'q3', question: 'Will you require sponsorship?', patterns: ['sponsorship'] })).toBe(false)
    expect(isDemographicAnswer({ id: 'q4', question: 'Do you embrace tracing?', patterns: [] })).toBe(false)
  })

  it('cleans blank lines, trims text and gives new answers a unique id', async () => {
    const profile = (await sampleSource().repo.getProfile())!
    const cleaned = cleanProfile({
      ...profile,
      answers: [...profile.answers, { id: '', question: ' How did you hear about this role? ', patterns: ['', ' heard about ', ''], answer: ' A friend ' }],
      coverLetter: { ...profile.coverLetter, bannedPhrases: ['synergy', '', '  '] },
    })
    const added = cleaned.answers.at(-1)!
    expect(added).toEqual({ id: 'how-did-you-hear-about-this-role', question: 'How did you hear about this role?', patterns: ['heard about'], answer: 'A friend' })
    expect(cleaned.coverLetter.bannedPhrases).toEqual(['synergy'])
    expect(validateProfile(cleaned)).toEqual([])
  })

  it('explains each problem by field', async () => {
    const profile = (await sampleSource().repo.getProfile())!
    const issues = validateProfile(
      cleanProfile({
        ...profile,
        links: { github: 'github.com/sam' },
        skills: [...profile.skills, { name: 'react', level: 'working' }, { name: ' ', level: 'strong' }],
        answers: [{ id: 'x', question: 'Salary?', patterns: [''], answer: '' }],
        coverLetter: { ...profile.coverLetter, maxWords: 12 },
        facts: [{ label: 'Degree', value: 'BSc', source: '' }],
      }),
    )
    expect(issues.map((issue) => issue.field)).toEqual([
      'links.github',
      `skills.${profile.skills.length}.name`,
      `skills.${profile.skills.length + 1}.name`,
      'answers.0.patterns',
      'answers.0.answer',
      'coverLetter.maxWords',
      'facts.0.source',
    ])
  })
})

describe('Profile page', () => {
  it('is read-only in the demo and never shows self-identification answers', { timeout: 15_000 }, async () => {
    const user = userEvent.setup()
    renderApp('/profile')
    await screen.findByRole('heading', { level: 1, name: 'Profile' })
    expect(screen.getByText(/This is the demo profile, so it is read-only/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save profile' })).toBeNull()

    await user.click(screen.getByRole('tab', { name: /^Answers/ }))
    expect(screen.getByText('One self-identification answer is hidden in the demo.')).toBeInTheDocument()
    expect(screen.queryByText('Demographic and equal opportunity questions')).toBeNull()
    expect(screen.queryByRole('button', { name: 'Add answer' })).toBeNull()
    // Read-only values are text, not fields that look editable but ignore typing.
    expect(screen.queryAllByRole('textbox', { name: 'Question', hidden: true })).toHaveLength(0)
    await user.click(screen.getByRole('tab', { name: /^Links/ }))
    expect(screen.queryByRole('textbox', { name: 'GitHub' })).toBeNull()
    expect(screen.getByText('https://github.example.com/sam-rivera-sample')).toBeInTheDocument()
  })

  it('validates before saving, then saves to the repo', { timeout: 15_000 }, async () => {
    const user = userEvent.setup()
    const source = sampleSource()
    renderApp('/profile', LOCAL, source)
    await screen.findByRole('heading', { level: 1, name: 'Profile' })

    const github = screen.getByRole('textbox', { name: 'GitHub' })
    await user.clear(github)
    await user.paste('github.com/sam')
    expect(screen.getByText('You have unsaved changes.')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Save profile' }))
    await waitFor(() => expect(github).toHaveAccessibleDescription('GitHub needs a full web address that starts with https://.'))
    expect(github).toBeInvalid()
    expect((await source.repo.getProfile())?.links.github).toBe('https://github.example.com/sam-rivera-sample')

    await user.clear(github)
    await user.paste('https://github.example.com/sam-r')
    await user.click(screen.getByRole('tab', { name: /Skills/ }))
    const panel = screen.getByRole('tabpanel')
    await user.click(within(panel).getByRole('button', { name: 'Add skill' }))
    const names = within(panel).getAllByRole('textbox', { name: /Skill \d+ name/ })
    await user.click(names.at(-1)!)
    await user.paste('Playwright')
    await user.click(screen.getByRole('button', { name: 'Save profile' }))

    await waitFor(async () => {
      const saved = await source.repo.getProfile()
      expect(saved?.links.github).toBe('https://github.example.com/sam-r')
      expect(saved?.skills.at(-1)).toEqual({ name: 'Playwright', level: 'familiar' })
    })
    expect(await screen.findByText('All changes saved.')).toBeInTheDocument()
  })
})
