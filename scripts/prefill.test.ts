import { readFile } from 'node:fs/promises'
import path from 'node:path'
import { chromium, type Browser, type BrowserContext, type Page } from 'playwright'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import { readJsonl } from '../src/data/jsonl.ts'
import type { Application, Job, Profile } from '../src/engine/types.ts'
import { recordSubmission } from '../src/features/apply/applyModel.ts'
import { REPO_ROOT } from './lib/data-dir.ts'
import * as pageModule from './lib/prefill-page.ts'
import { assertFillable, prefillPage, SubmitGuardError } from './lib/prefill-page.ts'
import { checkFormUrl, matchOption, planField, postingKey, recordFilled, type FormField } from './lib/prefill-plan.ts'

const FORM_URL = 'https://job-boards.greenhouse.io/mapleledger-sample/jobs/5100001'
const NOW = new Date('2026-11-03T17:00:00Z')

const read = (file: string) => readFile(path.join(REPO_ROOT, file), 'utf8')
let profile: Profile
let applications: Application[]
let jobs: Job[]

beforeAll(async () => {
  profile = JSON.parse(await read('sample-data/profile.json'))
  applications = readJsonl<Application>(await read('sample-data/applications.jsonl')).rows
  jobs = readJsonl<Job>(await read('sample-data/jobs.jsonl')).rows
})

describe('which pages the assistant opens', () => {
  it.each([
    [FORM_URL, 'greenhouse'],
    ['https://boards.greenhouse.io/embed/job_app?for=mapleledger-sample&token=5100001', 'greenhouse'],
    ['https://jobs.lever.co/quillstack-sample/4917c8ed-36ec-450e-a90e-b5ed03c9963f/apply', 'lever'],
    ['https://jobs.ashbyhq.com/harbourlight-sample/6a0e4c1e-2b7f-4a39-9d55-3f1c2b8e7a01/application', 'ashby'],
  ])('opens %s', (url, ats) => {
    expect(checkFormUrl(url)).toMatchObject({ ats })
  })

  it.each([
    ['https://www.linkedin.com/jobs/view/123', /never automates LinkedIn/],
    ['https://ca.linkedin.com/jobs/view/123', /never automates LinkedIn/],
    ['https://lnkd.in/abc', /never automates LinkedIn/],
    ['http://job-boards.greenhouse.io/x/jobs/1', /not a Greenhouse, Lever or Ashby application page over https/],
    ['https://greenhouse.io.evil.example/x', /not a Greenhouse/],
    ['https://example.myworkdayjobs.com/en-US/careers/job/1', /not a Greenhouse/],
    ['https://www.example.com/careers?redirect=jobs.lever.co', /not a Greenhouse/],
    ['not a url', /not a web address/],
  ])('refuses %s', (url, message) => {
    const result = checkFormUrl(url)
    expect('error' in result && result.error).toMatch(message)
  })
})

describe('what the assistant fills (no browser)', () => {
  const field = (overrides: Partial<FormField>): FormField => ({ key: 'k', kind: 'text', label: '', name: '', autocomplete: '', required: false, value: '', options: [], ...overrides })
  const context = () => ({ company: 'Maple Ledger', applications })

  it('fills name, email and links from the profile, but never the phone', () => {
    expect(planField(field({ label: 'First Name' }), profile, context())).toMatchObject({ action: 'fill', value: 'Sam', source: 'profile' })
    expect(planField(field({ label: 'Last name' }), profile, context())).toMatchObject({ action: 'fill', value: 'Rivera' })
    expect(planField(field({ label: 'Email address', kind: 'email' }), profile, context())).toMatchObject({ action: 'fill', value: 'sam.rivera@example.com' })
    expect(planField(field({ label: 'Phone number' }), profile, context())).toMatchObject({ action: 'leave' })
    expect(planField(field({ label: 'Mobile', kind: 'tel' }), profile, context())).toMatchObject({ action: 'leave' })
  })

  it('chooses an option only when the answer is exactly one of them', () => {
    const options = [{ label: '', value: '' }, { label: 'Yes', value: '1' }, { label: 'No', value: '0' }]
    expect(matchOption(options, 'yes')).toBe(1)
    expect(matchOption(options, 'Yes, I am')).toBeNull()
    const heard = field({ kind: 'select', label: 'How did you hear about this role?', options: [{ label: 'LinkedIn', value: 'li' }, { label: 'Company website', value: 'web' }] })
    expect(planField(heard, profile, context())).toMatchObject({ action: 'leave', reason: expect.stringContaining('not one of the options') })
  })

  it('leaves files, passwords, checkboxes, self-identification and unsure questions to you', () => {
    for (const kind of ['file', 'password', 'checkbox', 'combobox', 'other'] as const) {
      expect(planField(field({ kind, label: 'Email' }), profile, context()).action).toBe('leave')
    }
    expect(planField(field({ label: 'Gender', kind: 'select', options: [{ label: 'Man', value: 'm' }] }), profile, context()).action).toBe('leave')
    expect(planField(field({ label: 'What are your salary expectations?' }), profile, context()).action).toBe('leave')
    expect(planField(field({ label: 'Do you have experience with Python?' }), profile, context()).action).toBe('leave')
    expect(planField(field({ label: '' }), profile, context()).action).toBe('leave')
  })

  it('never overwrites something already typed', () => {
    expect(planField(field({ label: 'LinkedIn', value: 'https://other.example.com' }), profile, context())).toMatchObject({ action: 'keep' })
  })

  it.each<Partial<FormField>>([
    { label: "Referrer's email", kind: 'email' },
    { label: 'Who referred you? Their email address', kind: 'email' },
    { label: 'Reference 1 - first name' },
    { label: 'Emergency contact last name' },
    { label: 'Hiring manager name (if known)', name: 'referrer_first_name' },
    { label: 'Recruiter email', kind: 'email' },
    { label: "Friend's LinkedIn profile", kind: 'url' },
    { label: 'Tell us about a project on your GitHub', kind: 'textarea' },
    { label: 'Name of your current employer' },
    { label: 'Anything else?', kind: 'email' },
  ])('leaves a field that is not about you, or not a plain identity field: %j', (overrides) => {
    expect(planField(field(overrides), profile, context()).action).toBe('leave')
  })

  it.each(['How did you hear about us? (e.g. LinkedIn, a friend)', 'How did you hear about us? (e.g. LinkedIn)'])(
    'never puts a profile link into a free-text question: %s',
    (label) => {
      const decision = planField(field({ label }), profile, context())
      expect(decision).not.toMatchObject({ source: 'profile' })
      expect(decision).not.toMatchObject({ value: profile.links.linkedin })
    },
  )

  it.each<[Partial<FormField>, string]>([
    [{ label: 'Email', kind: 'email' }, 'sam.rivera@example.com'],
    [{ label: 'Your email', kind: 'text', autocomplete: 'email' }, 'sam.rivera@example.com'],
    [{ label: 'Confirm email', kind: 'email' }, 'sam.rivera@example.com'],
    [{ label: 'Legal first name' }, 'Sam'],
    [{ label: 'Given name', autocomplete: 'given-name' }, 'Sam'],
    [{ label: 'LinkedIn Profile' }, 'https://linkedin.example.com/in/sam-rivera-sample'],
    [{ label: 'Profile URL', name: 'urls[LinkedIn]', kind: 'url' }, 'https://linkedin.example.com/in/sam-rivera-sample'],
    [{ label: 'GitHub', kind: 'url' }, 'https://github.example.com/sam-rivera-sample'],
  ])('still fills a plain identity field: %j', (overrides, value) => {
    expect(planField(field(overrides), profile, context())).toMatchObject({ action: 'fill', value, source: 'profile' })
  })

  it('leaves a radio group whose inputs the page hides behind custom styling', () => {
    const options = [{ label: 'Yes', value: 'yes' }, { label: 'No', value: 'no' }]
    const sponsor = field({ kind: 'radio', hidden: true, label: 'Will you require sponsorship to work in Canada?', options })
    expect(planField(sponsor, profile, context())).toMatchObject({ action: 'leave', reason: expect.stringContaining('styled buttons') })
  })
})

describe('the form assistant on a synthetic application form', () => {
  let browser: Browser
  let context: BrowserContext
  let page: Page
  let requests: { method: string; url: string }[]

  beforeAll(async () => {
    browser = await chromium.launch()
  })
  afterAll(async () => {
    await browser.close()
  })

  beforeEach(async () => {
    const html = await read('scripts/fixtures/forms/application.html')
    context = await browser.newContext()
    requests = []
    // Nothing leaves this machine: the form is served from the fixture and every other request is refused.
    await context.route('**/*', async (route) => {
      const request = route.request()
      requests.push({ method: request.method(), url: request.url() })
      if (request.method() === 'GET' && request.url() === FORM_URL) await route.fulfill({ status: 200, contentType: 'text/html', body: html })
      else await route.abort()
    })
    page = await context.newPage()
    await page.goto(FORM_URL)
  })
  afterEach(async () => {
    await context.close()
  })

  const value = (selector: string) => page.locator(selector).inputValue()
  const checked = (selector: string) => page.locator(selector).isChecked()

  it('fills only the sure fields, and the form is never submitted', async () => {
    const result = await prefillPage(page, profile, { company: 'Maple Ledger', applications }, { fill: true })

    expect(await page.evaluate(() => (window as unknown as { __submitAttempts: number }).__submitAttempts)).toBe(0)
    expect(requests).toEqual([{ method: 'GET', url: FORM_URL }])
    expect(page.url()).toBe(FORM_URL)

    expect(await value('#first_name')).toBe('Sam')
    expect(await value('#last_name')).toBe('Rivera')
    expect(await value('[name="preferred"]')).toBe('Sam')
    expect(await value('#email')).toBe('sam.rivera@example.com')
    expect(await value('#linkedin')).toBe('https://linkedin.example.com/in/sam-rivera-sample')
    expect(await value('[name="urls[GitHub]"]')).toBe('https://github.example.com/sam-rivera-sample')
    expect(await value('#website')).toBe('https://old-site.example.com')
    expect(await value('#q-auth')).toBe('1')
    expect(await checked('[name="q_sponsor"][value="no"]')).toBe(true)
    expect(await value('#q-react')).toBe('Yes')
    expect(await value('#q-start')).toBe('Two weeks after an offer')
    // Sam's log has a submitted application to Maple Ledger, so "previously applied" is a yes.
    expect(await checked('[name="q_before"][value="Yes"]')).toBe(true)

    for (const selector of ['#phone', '#q-us', '#q-python', '#q-salary', '#q-heard', '#q-why', '#q-gender', '#q-date']) {
      expect(await value(selector), selector).toBe('')
    }
    expect(await checked('[name="consent"]')).toBe(false)

    const left = result.decisions.filter((decision) => decision.action === 'leave').map((decision) => decision.label)
    expect(left).toEqual([
      'Phone',
      'Resume/CV',
      'Will you require sponsorship to work in the United States?',
      'Do you have experience with Python?',
      'What are your salary expectations?',
      'How did you hear about this role?',
      'Why do you want to work at Maple Ledger?',
      'Gender',
      'I agree to the privacy policy',
      'Available from',
    ])
    expect(new Set(result.decisions.map((decision) => decision.key)).size).toBe(result.decisions.length)
    expect(result.fields.map((found) => found.name)).not.toContain('honeypot')
    expect(result.decisions.find((decision) => decision.label === 'Website')).toMatchObject({ action: 'keep' })
  })

  it('outlines every field it left and lists them in a panel', async () => {
    await prefillPage(page, profile, { company: 'Maple Ledger', applications }, { fill: true })
    expect(await page.locator('[data-shortlist-state="left"]').count()).toBe(10)
    expect(await page.locator('#q-salary').evaluate((element) => element.style.outlineWidth)).toBe('3px')
    expect(await page.locator('#first_name').getAttribute('data-shortlist-state')).toBe('filled')
    const panel = page.locator('#shortlist-prefill-panel')
    await expect(panel.locator('summary').textContent()).resolves.toBe('Shortlist filled 11 fields. 10 are left for you.')
    expect(await panel.locator('li').count()).toBe(10)
    expect(await panel.locator('button, input, a').count()).toBe(0)
    expect(await page.evaluate(() => (window as unknown as { __submitAttempts: number }).__submitAttempts)).toBe(0)
  })

  it('types nothing in inspect mode', async () => {
    const result = await prefillPage(page, profile, { company: 'Maple Ledger', applications }, { fill: false })
    expect(result.decisions.filter((decision) => decision.action === 'fill')).toHaveLength(11)
    expect(await value('#first_name')).toBe('')
    expect(await value('#q-auth')).toBe('')
  })

  it('throws before touching any submit control, button, link, checkbox or file input', async () => {
    for (const selector of ['#submit-button', '#submit-input', '#default-button', '#role-button', '[name="consent"]', '#resume']) {
      await expect(assertFillable(page.locator(selector)), selector).rejects.toBeInstanceOf(SubmitGuardError)
    }
    for (const selector of ['#first_name', '#q-auth', '[name="q_sponsor"][value="no"]', '#q-why']) {
      await expect(assertFillable(page.locator(selector)), selector).resolves.toBeUndefined()
    }
    expect(await page.evaluate(() => (window as unknown as { __submitAttempts: number }).__submitAttempts)).toBe(0)
  })

  it('leaves a field it cannot fill and still marks the page', async () => {
    // Hidden native radios behind styled labels, and a field inside a link: both are left, and the run goes on.
    const html = `<form onsubmit="window.__submitAttempts = (window.__submitAttempts || 0) + 1; return false">
      <label for="first_name">First Name</label><input id="first_name" name="first_name">
      <fieldset><legend>Will you now or in the future require sponsorship for employment visa status?</legend>
        <label><input type="radio" name="q_sponsor" value="yes" style="display:none"><span>Yes</span></label>
        <label><input type="radio" name="q_sponsor" value="no" style="display:none"><span>No</span></label>
      </fieldset>
      <a href="#"><input id="trap" aria-label="Last name"></a>
      <label for="email">Email</label><input id="email" type="email">
    </form>`
    await context.unrouteAll()
    await context.route('**/*', (route) => (route.request().url() === FORM_URL ? route.fulfill({ status: 200, contentType: 'text/html', body: html }) : route.abort()))
    await page.goto(FORM_URL)

    const result = await prefillPage(page, profile, {}, { fill: true })
    expect(await value('#first_name')).toBe('Sam')
    expect(await value('#email')).toBe('sam.rivera@example.com')
    expect(await value('#trap')).toBe('')
    expect(await page.locator('[name="q_sponsor"]:checked').count()).toBe(0)
    const byLabel = Object.fromEntries(result.decisions.map((decision) => [decision.label, decision]))
    expect(byLabel['Last name']).toMatchObject({ action: 'leave', reason: expect.stringMatching(/Refused to touch/) })
    expect(byLabel['Will you now or in the future require sponsorship for employment visa status?']).toMatchObject({ action: 'leave' })
    expect(await page.locator('#shortlist-prefill-panel').count()).toBe(1)
    expect(await page.locator('[data-shortlist-state="left"]').count()).toBe(2)
    expect(await page.evaluate(() => (window as unknown as { __submitAttempts?: number }).__submitAttempts ?? 0)).toBe(0)
  })

  it('refuses to fill a page that is not an allowed form', async () => {
    await context.unrouteAll()
    await context.route('**/*', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<form><input name="email"></form>' }))
    await page.goto('https://www.example.com/apply')
    await expect(prefillPage(page, profile, {}, { fill: true })).rejects.toThrow(/not a Greenhouse, Lever or Ashby form/)
  })
})

describe('the assistant has no way to click or submit', () => {
  it('exports only the guard and the fill routine', () => {
    expect(Object.keys(pageModule).sort()).toEqual(['SubmitGuardError', 'assertFillable', 'prefillPage'])
  })

  it('has no click, key, tap or submit calls anywhere in its code, apart from checking a radio', async () => {
    // Playwright's check() clicks the element. The one allowed call site checks a radio that
    // assertFillable has just inspected; any other click-like call fails this test.
    const ALLOWED = 'await radio.check({ timeout })'
    for (const file of ['scripts/prefill.ts', 'scripts/lib/prefill-page.ts', 'scripts/lib/prefill-plan.ts']) {
      const raw = await read(file)
      const allowed = raw.split(ALLOWED).length - 1
      expect(allowed, file).toBe(file === 'scripts/lib/prefill-page.ts' ? 1 : 0)
      const source = raw.replaceAll(ALLOWED, '')
      expect(source, file).not.toMatch(/\.(?:click|dblclick|press|pressSequentially|tap|type|check|uncheck|setChecked|dispatchEvent|requestSubmit|submit|dragTo|setInputFiles)\s*\(/)
      expect(source, file).not.toMatch(/\b(?:keyboard|mouse|touchscreen)\./)
      expect(source, file).not.toMatch(/\bforce\s*:\s*true/)
    }
  })
})

describe('recording what was filled', () => {
  const filled = [
    { key: 'a', label: 'Are you legally authorized to work in Canada?', action: 'fill' as const, value: 'Yes', source: 'answer' as const, reason: '' },
    { key: 'b', label: 'First Name', action: 'fill' as const, value: 'Sam', source: 'profile' as const, reason: '' },
  ]

  it('adds the filled answers to a new draft for a saved job, leaving out name and links', () => {
    const job = jobs.find((candidate) => candidate.ats === 'lever')!
    const recorded = recordFilled(filled, { url: `${job.url}/apply`, pageTitle: '', jobs, applications: [], now: NOW })!
    expect(recorded.newJob).toBeNull()
    expect(recorded.newApp).toBe(true)
    expect(recorded.app).toMatchObject({ jobId: job.id, status: 'draft', answersUsed: { 'Are you legally authorized to work in Canada?': 'Yes' } })
  })

  it('merges into an open application and keeps its status', () => {
    const open = applications.find((app) => app.status === 'prepared')!
    const job = jobs.find((candidate) => candidate.id === open.jobId)!
    const recorded = recordFilled(filled, { url: job.url, pageTitle: '', jobs, applications, now: NOW })!
    expect(recorded.newApp).toBe(false)
    expect(recorded.app.id).toBe(open.id)
    expect(recorded.app.status).toBe('prepared')
    expect(recorded.app.answersUsed).toMatchObject({ ...(open.answersUsed ?? {}), 'Are you legally authorized to work in Canada?': 'Yes' })
  })

  it('keeps what it recorded when you later record the submission in the apply kit', () => {
    const job = jobs.find((candidate) => candidate.ats === 'lever')!
    const recorded = recordFilled(filled, { url: `${job.url}/apply`, pageTitle: '', jobs, applications: [], now: NOW })!
    const submitted = recordSubmission(recorded.app, { at: NOW.toISOString(), answers: {} }, 'America/Toronto')
    expect(submitted.ok && submitted.app.answersUsed).toEqual({ 'Are you legally authorized to work in Canada?': 'Yes' })
  })

  it('adds the posting when it is not saved, and records nothing when nothing was answered', () => {
    const recorded = recordFilled(filled, { url: 'https://jobs.lever.co/newco-sample/abc/apply', pageTitle: 'Junior Developer', jobs, applications, now: NOW })!
    expect(recorded.newJob).toMatchObject({ company: 'Newco Sample', title: 'Junior Developer', status: 'shortlisted', ats: 'lever' })
    expect(recorded.app.jobId).toBe(recorded.newJob!.id)
    expect(recordFilled([filled[1]], { url: FORM_URL, pageTitle: '', jobs, applications, now: NOW })).toBeNull()
    expect(postingKey('https://jobs.ashbyhq.com/x/1/application?utm_source=a')).toBe('https://jobs.ashbyhq.com/x/1')
  })
})
