/// <reference lib="dom" />
/// <reference lib="dom.iterable" />
// The functions passed to evaluate() run in the page, so this file needs the DOM types.
/**
 * The form assistant's browser side: find the fields, fill the sure ones, and mark the rest.
 *
 * It never submits. It presses no keys, calls no submit and clicks nothing but a radio: the
 * only actions are fill (types into a text field), selectOption (chooses in a select) and
 * check, which selects a visible radio with a single click on the radio itself. Each one goes
 * through assertFillable first, which throws on a button, a submit or image input, a link, or
 * anything inside a button. scripts/prefill.test.ts proves on a synthetic form that the form is
 * never submitted, and that check() on a radio is the only click-like call in this code.
 */
import type { Frame, Locator, Page } from 'playwright'
import type { AnswerContext } from '../../src/engine/answers.ts'
import type { Profile } from '../../src/engine/types.ts'
import { isFormHost, planFields, type FieldDecision, type FormField } from './prefill-plan.ts'

const FIELD = 'data-shortlist-field'
const OPTION = 'data-shortlist-option'

export class SubmitGuardError extends Error {}

/**
 * Throws unless the element is a text field, textarea, select or radio. A submit control can
 * never get past this, whatever its label says.
 */
export async function assertFillable(locator: Locator): Promise<void> {
  const element = await locator.evaluate((node) => ({
    tag: node.tagName.toLowerCase(),
    type: (node.getAttribute('type') ?? '').toLowerCase(),
    role: (node.getAttribute('role') ?? '').toLowerCase(),
    insideControl: Boolean(node.parentElement?.closest('button, a[href], [role="button"], [role="link"], summary')),
    editable: (node as HTMLElement).isContentEditable,
  }))
  const blockedInputs = ['submit', 'image', 'button', 'reset', 'file', 'password', 'hidden', 'checkbox']
  const fillable =
    (element.tag === 'input' && !blockedInputs.includes(element.type)) || element.tag === 'textarea' || element.tag === 'select'
  if (!fillable || element.insideControl || ['button', 'link', 'menuitem'].includes(element.role) || element.editable) {
    throw new SubmitGuardError(`Refused to touch a <${element.tag}${element.type ? ` type="${element.type}"` : ''}>: the assistant only fills text fields, selects and radios, and never submits.`)
  }
}

/**
 * Collects the form fields in one frame and tags each with data-shortlist-field so it can be
 * found again. Runs in the page, so it is one self-contained function.
 */
function collectInPage({ prefix, fieldAttr, optionAttr }: { prefix: string; fieldAttr: string; optionAttr: string }) {
  const clean = (text: string | null | undefined) =>
    (text ?? '')
      .replace(/\s+/g, ' ')
      .replace(/\s*\*\s*$/, '')
      .replace(/\s*\(required\)\s*$/i, '')
      .trim()
  /** Text of an element without the text of fields inside it (a label wrapping a select lists its options). */
  const ownText = (element: Element | null) => {
    if (!element) return ''
    const copy = element.cloneNode(true) as Element
    copy.querySelectorAll('input, select, textarea, option, button, script, style').forEach((node) => node.remove())
    return clean(copy.textContent)
  }
  const visible = (element: HTMLElement) => {
    const style = getComputedStyle(element)
    return style.display !== 'none' && style.visibility !== 'hidden' && element.getClientRects().length > 0
  }
  const byIds = (ids: string | null) =>
    clean(
      (ids ?? '')
        .split(/\s+/)
        .map((id) => (id ? document.getElementById(id)?.textContent ?? '' : ''))
        .join(' '),
    )
  const directLabel = (element: HTMLElement) => {
    if (element.id) {
      const label = document.querySelector(`label[for="${CSS.escape(element.id)}"]`)
      if (label) return ownText(label)
    }
    const wrapping = element.closest('label')
    if (wrapping) return ownText(wrapping)
    return ''
  }
  /** The nearest label or legend above the field, within a few levels: how Greenhouse, Lever and Ashby lay out questions. */
  const nearbyLabel = (element: HTMLElement, skip: readonly Element[]) => {
    let node: HTMLElement | null = element.parentElement
    for (let depth = 0; node && depth < 4; depth += 1, node = node.parentElement) {
      const candidate = [...node.querySelectorAll('legend, label, [class*="label" i], h3, h4')].find(
        (found) => !skip.some((other) => found === other || found.contains(other) || other.contains(found)) && ownText(found) !== '',
      )
      if (candidate) return ownText(candidate)
    }
    return ''
  }
  const questionLabel = (element: HTMLElement, skip: readonly Element[] = [element]) =>
    byIds(element.getAttribute('aria-labelledby')) ||
    clean(element.getAttribute('aria-label')) ||
    directLabel(element) ||
    ownText(element.closest('fieldset')?.querySelector('legend') ?? null) ||
    nearbyLabel(element, skip) ||
    clean(element.getAttribute('placeholder')) ||
    clean(element.getAttribute('title'))

  const fields: {
    key: string
    kind: string
    hidden?: boolean
    label: string
    name: string
    autocomplete: string
    required: boolean
    value: string
    options: { label: string; value: string }[]
  }[] = []
  const radiosDone = new Set<string>()
  let count = 0
  for (const element of document.querySelectorAll<HTMLElement>('input, textarea, select')) {
    if (element.closest('#shortlist-prefill-panel')) continue
    const input = element as HTMLInputElement
    const type = element.tagName === 'INPUT' ? (input.type || 'text').toLowerCase() : element.tagName.toLowerCase()
    if (['hidden', 'submit', 'button', 'image', 'reset'].includes(type) || input.disabled || input.readOnly) continue
    if (!visible(element) && type !== 'file' && type !== 'radio') continue
    const key = `${prefix}${count}`
    count += 1
    const base = { key, name: input.name ?? '', autocomplete: element.getAttribute('autocomplete') ?? '', required: input.required || element.getAttribute('aria-required') === 'true' }

    if (type === 'radio') {
      const group = input.name ? `name:${input.name}` : `solo:${key}`
      if (radiosDone.has(group)) continue
      radiosDone.add(group)
      const radios = input.name
        ? [...(input.form ?? document).querySelectorAll<HTMLInputElement>(`input[type="radio"][name="${CSS.escape(input.name)}"]`)]
        : [input]
      const container = (radios[0].closest('fieldset, [role="radiogroup"]') as HTMLElement | null) ?? radios[0].parentElement?.parentElement ?? null
      const optionLabels = radios.map((radio) => directLabel(radio) || clean(radio.value))
      radios.forEach((radio, index) => {
        radio.setAttribute(fieldAttr, key)
        radio.setAttribute(optionAttr, String(index))
      })
      const label = container
        ? byIds(container.getAttribute('aria-labelledby')) ||
          clean(container.getAttribute('aria-label')) ||
          ownText(container.querySelector('legend')) ||
          nearbyLabel(radios[0], radios.map((radio) => radio.closest('label') ?? radio))
        : ''
      const checked = radios.findIndex((radio) => radio.checked)
      fields.push({
        ...base,
        kind: 'radio',
        hidden: radios.some((radio) => !visible(radio)),
        label,
        options: radios.map((radio, index) => ({ label: optionLabels[index], value: radio.value })),
        value: checked === -1 ? '' : optionLabels[checked],
      })
      continue
    }

    element.setAttribute(fieldAttr, key)
    const role = (element.getAttribute('role') ?? '').toLowerCase()
    let kind: string
    if (role === 'combobox' && element.tagName === 'INPUT') kind = 'combobox'
    else if (element.tagName === 'TEXTAREA') kind = 'textarea'
    else if (element.tagName === 'SELECT') kind = (element as HTMLSelectElement).multiple ? 'other' : 'select'
    else if (['text', 'search'].includes(type)) kind = 'text'
    else if (['email', 'url', 'tel', 'number', 'checkbox', 'file', 'password'].includes(type)) kind = type
    else kind = 'other'
    const select = element as HTMLSelectElement
    fields.push({
      ...base,
      kind,
      label: kind === 'checkbox' ? directLabel(element) || questionLabel(element) : questionLabel(element),
      options: kind === 'select' ? [...select.options].map((option) => ({ label: clean(option.textContent), value: option.value })) : [],
      value: kind === 'select' ? (select.value ? clean(select.selectedOptions[0]?.textContent) : '') : kind === 'checkbox' ? '' : (input.value ?? ''),
    })
  }
  return fields
}

/** Marks every field with its outcome and adds a panel listing what is left. Text is set with textContent only. */
function markInPage({ marks, fieldAttr, summary }: { marks: { key: string; state: string; label: string; reason: string }[]; fieldAttr: string; summary: string }) {
  const colors: Record<string, string> = { filled: '#15803d', kept: '#2563eb', left: '#d97706' }
  for (const mark of marks) {
    const elements = [...document.querySelectorAll<HTMLElement>(`[${fieldAttr}="${CSS.escape(mark.key)}"]`)]
    if (elements.length === 0) continue
    // A radio group is outlined as a whole: its fieldset, or the smallest box holding every option.
    let target: HTMLElement = (elements[0].closest('fieldset, [role="radiogroup"]') as HTMLElement | null) ?? elements[0]
    while (target.parentElement && !elements.every((element) => target.contains(element))) target = target.parentElement
    target.style.outline = `${mark.state === 'left' ? 3 : 2}px solid ${colors[mark.state]}`
    target.style.outlineOffset = '2px'
    target.setAttribute('data-shortlist-state', mark.state)
    target.title = `Shortlist: ${mark.reason}`
  }
  document.getElementById('shortlist-prefill-panel')?.remove()
  const panel = document.createElement('aside')
  panel.id = 'shortlist-prefill-panel'
  panel.setAttribute('aria-label', 'Shortlist form assistant')
  panel.style.cssText =
    'position:fixed;right:16px;bottom:16px;z-index:2147483647;max-width:min(380px,calc(100vw - 32px));max-height:50vh;overflow:auto;background:#fffdf7;color:#1c1917;border:2px solid #d97706;border-radius:10px;padding:12px 14px;font:14px/1.45 system-ui,sans-serif;box-shadow:0 8px 24px rgba(0,0,0,.18)'
  const details = document.createElement('details')
  details.open = true
  const heading = document.createElement('summary')
  heading.style.cssText = 'font-weight:600;cursor:pointer'
  heading.textContent = summary
  details.append(heading)
  const left = marks.filter((mark) => mark.state === 'left')
  if (left.length > 0) {
    const list = document.createElement('ol')
    list.style.cssText = 'margin:8px 0 0;padding-left:20px'
    for (const mark of left) {
      const item = document.createElement('li')
      const name = document.createElement('strong')
      name.textContent = mark.label
      item.append(name, document.createTextNode(`: ${mark.reason}`))
      list.append(item)
    }
    details.append(list)
  }
  const note = document.createElement('p')
  note.style.cssText = 'margin:8px 0 0'
  note.textContent = 'Amber fields are yours. Check every field, then submit the form yourself. Shortlist never submits.'
  details.append(note)
  panel.append(details)
  document.body.append(panel)
}

export interface PrefillResult {
  url: string
  pageTitle: string
  fields: FormField[]
  decisions: FieldDecision[]
}

// Short, so one stuck field costs seconds, not Playwright's default 30.
const ACTION_TIMEOUT_MS = 5000

async function fillOne(frame: Frame, decision: Extract<FieldDecision, { action: 'fill' }>, kind: FormField['kind']): Promise<string | null> {
  const timeout = ACTION_TIMEOUT_MS
  if (kind === 'radio') {
    const radio = frame.locator(`[${FIELD}="${decision.key}"][${OPTION}="${decision.optionIndex}"]`)
    await assertFillable(radio)
    // The one click in this file: Playwright's check() clicks the radio input itself, which
    // assertFillable has just confirmed is a radio and not inside a button or link.
    await radio.check({ timeout })
    return (await radio.isChecked()) ? null : 'The page did not keep the choice. Pick it yourself.'
  }
  const field = frame.locator(`[${FIELD}="${decision.key}"]`)
  await assertFillable(field)
  if (kind === 'select') {
    await field.selectOption({ index: decision.optionIndex ?? 0 }, { timeout })
    return null
  }
  await field.fill(decision.value, { timeout })
  return (await field.inputValue({ timeout })) === decision.value ? null : 'The page did not keep the value. Type it yourself.'
}

/** One failed field is left for the person with the reason; the run still marks the page and records. */
async function tryFillOne(frame: Frame, decision: Extract<FieldDecision, { action: 'fill' }>, kind: FormField['kind']): Promise<string | null> {
  try {
    return await fillOne(frame, decision, kind)
  } catch (error) {
    if (error instanceof SubmitGuardError) return error.message
    return `The assistant couldn't fill this one (${error instanceof Error ? error.message.split('\n')[0] : String(error)}). Fill it yourself.`
  }
}

/**
 * Finds the fields on the page and in its form frames, fills the sure ones (unless `fill` is
 * false), marks every field, and returns what it did. Frames from other hosts are left alone.
 */
export async function prefillPage(page: Page, profile: Profile, context: AnswerContext, { fill }: { fill: boolean }): Promise<PrefillResult> {
  if (!isFormHost(page.url())) throw new Error(`The page is now at ${new URL(page.url()).hostname}, which is not a Greenhouse, Lever or Ashby form. Nothing was filled.`)
  const frames = page.frames().filter((frame) => isFormHost(frame.url()))
  const fields: FormField[] = []
  const decisions: FieldDecision[] = []
  for (const [index, frame] of frames.entries()) {
    const found = (await frame.evaluate(collectInPage, { prefix: `f${index}-`, fieldAttr: FIELD, optionAttr: OPTION })) as FormField[]
    const planned = planFields(found, profile, context)
    if (fill) {
      for (const [at, decision] of planned.entries()) {
        if (decision.action !== 'fill') continue
        const problem = await tryFillOne(frame, decision, found[at].kind)
        if (problem) planned[at] = { key: decision.key, label: decision.label, action: 'leave', reason: problem }
      }
    }
    const filled = planned.filter((decision) => decision.action === 'fill').length
    const left = planned.filter((decision) => decision.action === 'leave').length
    const summary = fill ? `Shortlist filled ${filled} fields. ${left} are left for you.` : `Shortlist can fill ${filled} fields (nothing typed yet). ${left} are left for you.`
    const marks = planned.map((decision) => ({ key: decision.key, label: decision.label, reason: decision.reason, state: decision.action === 'fill' ? (fill ? 'filled' : 'kept') : decision.action === 'keep' ? 'kept' : 'left' }))
    await frame.evaluate(markInPage, { marks, fieldAttr: FIELD, summary })
    fields.push(...found)
    decisions.push(...planned)
  }
  return { url: page.url(), pageTitle: (await page.locator('h1').first().textContent({ timeout: 1000 }).catch(() => null))?.trim() || (await page.title()), fields, decisions }
}
