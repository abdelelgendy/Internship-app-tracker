import { screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it } from 'vitest'
import { DAY_MS } from '@/engine/dates.ts'
import { renderApp } from '@/test/renderApp.tsx'
import { sampleSource } from '@/test/sampleSource.ts'

const FIRST_PROMPT = 'Tell me about yourself.'
const SECOND_PROMPT = 'Tell me about a time you disagreed with a teammate.'

async function startDeckReview(scope: 'all' | 'due' = 'all') {
  const source = sampleSource()
  const user = userEvent.setup()
  const view = renderApp(`/practice/behavioral-basics?review=${scope}`, undefined, source)
  await screen.findByRole('heading', { level: 1, name: 'Behavioral basics' })
  return { source, user, view }
}

describe('review session', () => {
  it('explains it back, compares, and schedules the card when graded', { timeout: 15_000 }, async () => {
    const { source, user } = await startDeckReview()
    const before = (await source.repo.getProgress()).cards['behavioral-tell-me-about-yourself']
    expect(before.box).toBe(2)

    expect(screen.getByRole('heading', { level: 2, name: FIRST_PROMPT })).toBeInTheDocument()
    expect(screen.getByText('Card 1 of 6')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Explain it back' }))
    await user.click(screen.getByLabelText('Explain it in your own words'))
    await user.paste('Now a new grad, before a co-op, next a junior role.')
    await user.click(screen.getByRole('button', { name: 'Compare with the model answer' }))

    expect(screen.getByText('Now a new grad, before a co-op, next a junior role.')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Model answer' })).toBeInTheDocument()
    const keyPoints = screen.getByRole('group', { name: /Key points/ })
    const boxes = within(keyPoints).getAllByRole('checkbox')
    expect(boxes).toHaveLength(4)
    for (const box of boxes) await user.click(box)
    expect(screen.getByText(/From your key points: Good/)).toBeInTheDocument()

    // Box 2 graded good moves to box 3, which comes back in 3 days.
    expect(screen.getByRole('button', { name: 'Good, back in 3 days' })).toBeInTheDocument()
    const gradedAt = Date.now()
    await user.keyboard('3')

    expect(await screen.findByRole('heading', { level: 2, name: SECOND_PROMPT })).toBeInTheDocument()
    await waitFor(async () => {
      const after = (await source.repo.getProgress()).cards['behavioral-tell-me-about-yourself']
      expect(after).toMatchObject({ box: 3, lastGrade: 'good', reviews: before.reviews + 1 })
      expect(Math.abs(Date.parse(after.dueAt) - (gradedAt + 3 * DAY_MS))).toBeLessThan(5_000)
    })
  })

  it('starts unseen cards in box 1 and brings an "again" card back at the end', async () => {
    const { source, user } = await startDeckReview()
    // First card: grade from the flipped answer.
    await user.click(screen.getByRole('button', { name: 'Show answer' }))
    await user.click(screen.getByRole('button', { name: /^Good/ }))

    // Second card was never seen: "again" keeps it in box 1, due today, and queues it once more.
    expect(await screen.findByRole('heading', { level: 2, name: SECOND_PROMPT })).toBeInTheDocument()
    expect(screen.getByText('New')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Show answer' }))
    await user.click(screen.getByRole('button', { name: /^Again/ }))
    expect(await screen.findByText('Card 3 of 7')).toBeInTheDocument()

    await waitFor(async () => {
      const entry = (await source.repo.getProgress()).cards['behavioral-disagreement']
      expect(entry).toMatchObject({ box: 1, lastGrade: 'again', reviews: 1 })
    })
  })

  it('ignores the grade keys while you type, and before the answer is shown', async () => {
    const { source, user } = await startDeckReview()
    await user.keyboard('3')
    expect(screen.getByRole('heading', { level: 2, name: FIRST_PROMPT })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Explain it back' }))
    await user.type(screen.getByLabelText('Explain it in your own words'), '1234')
    expect(screen.getByLabelText('Explain it in your own words')).toHaveValue('1234')
    expect(screen.getByRole('heading', { level: 2, name: FIRST_PROMPT })).toBeInTheDocument()
    expect((await source.repo.getProgress()).cards['behavioral-tell-me-about-yourself'].reviews).toBe(2)
  })

  it('shows the source and a summary when the session ends', { timeout: 15_000 }, async () => {
    const source = sampleSource()
    const user = userEvent.setup()
    renderApp('/practice/shortlist-engine?review=all', undefined, source)
    await screen.findByRole('heading', { level: 1, name: 'How Shortlist works' })
    for (let card = 0; card < 8; card += 1) {
      await user.click(await screen.findByRole('button', { name: 'Show answer' }))
      if (card === 0) expect(screen.getByText(/^Source:/)).toBeInTheDocument()
      await user.keyboard('4')
    }
    expect(await screen.findByRole('heading', { name: 'Session done' })).toBeInTheDocument()
    expect(screen.getByText(/You reviewed 8 cards/)).toBeInTheDocument()
  })
})
