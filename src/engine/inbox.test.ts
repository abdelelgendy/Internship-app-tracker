import { describe, expect, it } from 'vitest'
import { makeApplication } from './fixtures.ts'
import { classifyEmail, matchApplication } from './inbox.ts'

describe('classifyEmail', () => {
  it.each([
    ['Your offer from Northwind Apps', 'We are pleased to offer you the position of Junior Developer.', 'offer', 'offer', 'urgent'],
    ['Next steps', 'Congratulations! Attached is your formal offer and offer letter.', 'offer', 'offer', 'urgent'],
    ['Welcome!', 'Welcome to the team. Your start date is December 1.', 'offer', 'offer', 'urgent'],
    ['Interview availability', 'Could you share your availability for an interview next week?', 'interview', 'interview_scheduled', 'urgent'],
    ['Quick chat', 'We would like to set up a phone screen with you.', 'interview', 'interview_scheduled', 'urgent'],
    ['Your application', 'As a next step, please complete this HackerRank challenge within 5 days.', 'assessment', 'assessment_pending', 'urgent'],
    ['Take-home project', 'Here is the take-home exercise.', 'assessment', 'assessment_pending', 'urgent'],
    ['Update on your application', 'Unfortunately, we will not be moving forward with your application.', 'rejection', 'rejected', 'none'],
    ['Update', 'The position has been filled.', 'rejection', 'rejected', 'none'],
    ['Status', 'Your application is currently under review.', 'reviewing', 'reviewing', 'none'],
    ['Thank you for applying', 'We received your application for Junior Developer.', 'received', 'confirmed', 'none'],
    ['Opportunity', 'Hi, I am a recruiter and came across your profile.', 'recruiter', null, 'info'],
    ['Weekly digest', 'Ten tips for your next project. Unsubscribe here.', 'other', null, 'none'],
  ] as const)('%s / %s -> %s', (subject, body, kind, status, alert) => {
    const result = classifyEmail(subject, body)
    expect(result.kind).toBe(kind)
    expect(result.suggestedStatus).toBe(status)
    expect(result.alert).toBe(alert)
    if (kind !== 'other') expect(result.evidence.length).toBeGreaterThan(0)
  })

  it('ranks an interview above a receipt in the same email', () => {
    expect(classifyEmail('Thanks for applying', 'Thank you for applying. We would like to schedule an interview.').kind).toBe('interview')
  })

  it('ranks a rejection above "thank you for applying"', () => {
    expect(classifyEmail('Your application', 'Thank you for applying. We regret to inform you that we chose other candidates.').kind).toBe('rejection')
  })

  it.each([
    'Hi Sam, thank you for completing the coding challenge. Unfortunately, we will not be moving forward with your application.',
    'Hi Sam, thank you for your interview call with our team last week. We regret to inform you that we have decided not to proceed.',
    'Hi Sam, thanks for taking the HackerRank assessment. After careful review we have decided to move forward with other candidates.',
  ])('reads a rejection after an interview or assessment as a rejection: %s', (body) => {
    const result = classifyEmail('Your application', body)
    expect(result.kind).toBe('rejection')
    expect(result.suggestedStatus).toBe('rejected')
    expect(result.alert).toBe('none')
  })

  it('does not read "unfortunately" alone as a rejection', () => {
    expect(classifyEmail('Scheduling', 'Unfortunately I have to move our call. Are you available for an interview Friday?').kind).toBe('interview')
    expect(classifyEmail('Note', 'Unfortunately the office is closed Monday.').kind).toBe('other')
  })

  it('does not read "unable to offer you the position" as an offer', () => {
    expect(classifyEmail('Update', 'We are unable to offer you the position at this time.').kind).toBe('rejection')
  })

  it('ignores marketing offers and sign-up welcomes', () => {
    expect(classifyEmail('Offer ends tonight', 'We are excited to offer 20% off all plans.').kind).toBe('other')
    expect(classifyEmail('Welcome aboard', 'Welcome aboard! Verify your email to finish creating your account.').kind).toBe('other')
  })
})

describe('matchApplication', () => {
  const apps = [
    makeApplication({ id: 'old', company: 'Northwind Apps', title: 'Frontend Developer', appliedAt: '2026-09-01T12:00:00Z' }),
    makeApplication({ id: 'new', company: 'Northwind Apps', title: 'Junior Software Developer', appliedAt: '2026-10-20T12:00:00Z' }),
    makeApplication({ id: 'globex', company: 'Globex', title: 'Junior Developer', appliedAt: '2026-10-25T12:00:00Z' }),
  ]

  it('matches the job title in the subject first', () => {
    expect(matchApplication({ subject: 'Your Frontend Developer application', body: 'From the Northwind Apps team.' }, apps)?.id).toBe('old')
  })

  it('falls back to the most recent application at the company', () => {
    expect(matchApplication({ subject: 'Update', body: 'Thanks from everyone at Northwind Apps.' }, apps)?.id).toBe('new')
  })

  it('matches on the sender domain', () => {
    expect(matchApplication({ subject: 'Update', body: 'Thanks for applying.', from: 'jobs@globex.example' }, apps)?.id).toBe('globex')
  })

  it('returns null when no company matches', () => {
    expect(matchApplication({ subject: 'Hello', body: 'A message from Initech.' }, apps)).toBeNull()
  })
})
