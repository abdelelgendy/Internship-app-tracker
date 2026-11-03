import { useDeferredValue, useId, useState, type ReactNode } from 'react'
import type { Profile, SkillLevel } from '@/engine/types.ts'
import { Badge } from '@/ui/Badge.tsx'
import { Button } from '@/ui/Button.tsx'
import { cx } from '@/ui/cx.ts'
import { ChevronDownIcon } from '@/ui/icons.tsx'
import { Field } from '@/ui/Field.tsx'
import { Input } from '@/ui/Input.tsx'
import { Select } from '@/ui/Select.tsx'
import { Textarea } from '@/ui/Textarea.tsx'
import { isDemographicAnswer, LINK_FIELDS, SKILL_LEVELS, toLines, type Answer } from './profileForm.ts'
import { moveRow, removeRow, replaceRow, rowKey } from './rows.ts'

export interface SectionProps {
  profile: Profile
  update: (change: (profile: Profile) => Profile) => void
  /** Error message by field, such as "skills.2.name". */
  errors: Record<string, string>
  readOnly: boolean
}

function SectionIntro({ children, action }: { children: ReactNode; action?: ReactNode }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-x-4 gap-y-2">
      <p className="max-w-prose text-[0.8125rem] text-fg-muted">{children}</p>
      {action}
    </div>
  )
}

// ---------- Links ----------

export function LinksSection({ profile, update, errors, readOnly }: SectionProps) {
  return (
    <div className="max-w-xl space-y-4">
      <SectionIntro>Links that application forms ask for. Leave one empty if you don't have it.</SectionIntro>
      {LINK_FIELDS.map(({ key, label }) => (
        <Field key={key} label={label} error={errors[`links.${key}`]}>
          {(control) => (
            <Input
              {...control}
              type="url"
              inputMode="url"
              data-field={`links.${key}`}
              readOnly={readOnly}
              className="font-mono"
              placeholder={readOnly ? undefined : 'https://'}
              value={profile.links[key] ?? ''}
              onChange={(event) => update((current) => ({ ...current, links: { ...current.links, [key]: event.target.value } }))}
            />
          )}
        </Field>
      ))}
    </div>
  )
}

// ---------- Skills ----------

export function SkillsSection({ profile, update, errors, readOnly }: SectionProps) {
  const projects = [...profile.projects.map((project) => project.slug), ...profile.experience.map((role) => role.org)]
  const listId = useId()
  const counts = SKILL_LEVELS.map(({ level, label }) => `${profile.skills.filter((skill) => skill.level === level).length} ${label.toLowerCase()}`)
  const setSkill = (index: number, change: Partial<Profile['skills'][number]>) =>
    update((current) => ({ ...current, skills: replaceRow(current.skills, index, { ...current.skills[index], ...change }) }))

  return (
    <div>
      <SectionIntro
        action={
          readOnly ? null : (
            <Button size="sm" onClick={() => update((current) => ({ ...current, skills: [...current.skills, { name: '', level: 'familiar' as SkillLevel }] }))}>
              Add skill
            </Button>
          )
        }
      >
        Be honest: the answer helper says "Yes" to "Do you have experience with X?" only for strong and working skills, and asks you about familiar ones.{' '}
        {SKILL_LEVELS.map(({ label, meaning }) => (
          <span key={label} className="block">
            <strong className="font-medium text-fg">{label}</strong>: {meaning}.
          </span>
        ))}
        <span className="mt-1 block font-mono text-xs">{counts.join(' · ')}</span>
      </SectionIntro>

      <datalist id={listId}>
        {projects.map((project) => (
          <option key={project} value={project} />
        ))}
      </datalist>
      <div className="hidden grid-cols-[minmax(0,1.2fr)_9rem_minmax(0,1fr)_5.5rem] gap-3 px-3 pb-1.5 text-xs font-medium text-fg-muted md:grid" aria-hidden="true">
        <span>Skill</span>
        <span>Level</span>
        <span>Evidence (a project or role)</span>
      </div>
      <ul className="space-y-2">
        {profile.skills.map((skill, index) => {
          const nameError = errors[`skills.${index}.name`]
          return (
            <li key={rowKey(skill)} className="rounded-md border border-line bg-surface p-3 md:border-0 md:bg-transparent md:p-0 md:px-0">
              <div className="grid grid-cols-2 gap-2 md:grid-cols-[minmax(0,1.2fr)_9rem_minmax(0,1fr)_5.5rem] md:items-start md:gap-3 md:px-3">
                <div className="col-span-2 md:col-span-1">
                  <Input
                    aria-label={`Skill ${index + 1} name`}
                    aria-invalid={nameError ? true : undefined}
                    data-field={`skills.${index}.name`}
                    readOnly={readOnly}
                    value={skill.name}
                    onChange={(event) => setSkill(index, { name: event.target.value })}
                  />
                  {nameError ? <p className="mt-1 text-xs text-danger-ink">{nameError}</p> : null}
                </div>
                <Select
                  aria-label={`Skill ${index + 1} level`}
                  data-field={`skills.${index}.level`}
                  disabled={readOnly}
                  value={skill.level}
                  onChange={(event) => setSkill(index, { level: event.target.value as SkillLevel })}
                >
                  {SKILL_LEVELS.map(({ level, label }) => (
                    <option key={level} value={level}>
                      {label}
                    </option>
                  ))}
                </Select>
                <Input
                  aria-label={`Skill ${index + 1} evidence`}
                  list={listId}
                  readOnly={readOnly}
                  placeholder={readOnly ? undefined : 'Project or role'}
                  value={skill.evidence ?? ''}
                  onChange={(event) => setSkill(index, { evidence: event.target.value })}
                />
                {readOnly ? null : (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="col-span-2 justify-self-start md:col-span-1 md:mt-0.5"
                    aria-label={`Remove ${skill.name || `skill ${index + 1}`}`}
                    onClick={() => update((current) => ({ ...current, skills: removeRow(current.skills, index) }))}
                  >
                    Remove
                  </Button>
                )}
              </div>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

// ---------- Answers ----------

interface AnswersProps extends SectionProps {
  /** The demo hides self-identification answers entirely. */
  hideDemographics: boolean
}

export function AnswersSection({ profile, update, errors, readOnly, hideDemographics }: AnswersProps) {
  const [query, setQuery] = useState('')
  const [opened, setOpened] = useState<ReadonlySet<string>>(new Set())
  const deferred = useDeferredValue(query.trim().toLowerCase())
  const filtering = deferred !== ''
  const hidden = hideDemographics ? profile.answers.filter(isDemographicAnswer).length : 0
  const rows = profile.answers
    .map((answer, index) => ({ answer, index }))
    .filter(({ answer }) => !(hideDemographics && isDemographicAnswer(answer)))
    .filter(({ answer }) => !filtering || [answer.question, answer.answer, ...answer.patterns].join(' ').toLowerCase().includes(deferred))

  const setAnswer = (index: number, change: Partial<Answer>) =>
    update((current) => ({ ...current, answers: replaceRow(current.answers, index, { ...current.answers[index], ...change }) }))

  function add() {
    const answer: Answer = { id: '', question: '', patterns: [''], answer: '' }
    setQuery('')
    setOpened((current) => new Set(current).add(rowKey(answer)))
    update((current) => ({ ...current, answers: [...current.answers, answer] }))
  }

  return (
    <div>
      <SectionIntro action={readOnly ? null : <Button size="sm" onClick={add}>Add answer</Button>}>
        Saved answers for application questions. The first answer whose pattern appears in a question is suggested, so put specific answers above general ones.
        Tick "I answer this myself" for anything that depends on the job, such as salary, and for self-identification questions.
      </SectionIntro>
      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        <Input type="search" aria-label="Search answers" placeholder="Search questions and answers" className="max-w-sm" value={query} onChange={(event) => setQuery(event.target.value)} />
        <p className="text-[0.8125rem] text-fg-muted" aria-live="polite">
          {filtering ? `${rows.length} of ${profile.answers.length - hidden} answers` : `${profile.answers.length - hidden} answers`}
          {filtering && !readOnly ? '. Clear the search to reorder.' : null}
        </p>
      </div>
      {hidden > 0 ? (
        <p className="mb-3 rounded-md bg-surface-2 px-3 py-2 text-[0.8125rem] text-fg-muted">
          {hidden === 1 ? 'One self-identification answer is' : `${hidden} self-identification answers are`} hidden in the demo.
        </p>
      ) : null}
      <ol className="space-y-2">
        {rows.map(({ answer, index }) => {
          const key = rowKey(answer)
          const hasError = Object.keys(errors).some((field) => field.startsWith(`answers.${index}.`))
          return (
            <li key={key}>
              <details
                open={opened.has(key) || hasError}
                onToggle={(event) => {
                  const open = event.currentTarget.open
                  setOpened((current) => {
                    if (current.has(key) === open) return current
                    const nextOpen = new Set(current)
                    if (open) nextOpen.add(key)
                    else nextOpen.delete(key)
                    return nextOpen
                  })
                }}
                className={cx('group rounded-lg border bg-surface', hasError ? 'border-danger' : 'border-line open:border-line-strong')}
              >
                <summary className="relative flex cursor-pointer flex-wrap items-baseline gap-x-2 gap-y-1 py-2.5 pr-10 pl-4 select-none">
                  <ChevronDownIcon className="absolute top-3 right-3.5 size-4 text-fg-subtle transition-transform group-open:rotate-180 motion-reduce:transition-none" />
                  <span className="min-w-0 font-medium break-words text-fg">{answer.question || 'New answer'}</span>
                  {answer.needsHuman ? <Badge tone="warn">You answer</Badge> : null}
                  {isDemographicAnswer(answer) ? <Badge tone="violet">Self-ID</Badge> : null}
                  {hasError ? <Badge tone="danger">Needs a fix</Badge> : null}
                  {!answer.needsHuman && answer.answer ? <span className="min-w-0 flex-1 basis-full text-[0.8125rem] break-words text-fg-muted md:basis-auto">{answer.answer}</span> : null}
                </summary>
                <AnswerFields answer={answer} index={index} errors={errors} readOnly={readOnly} onChange={(change) => setAnswer(index, change)} />
                {readOnly ? null : (
                  <div className="flex flex-wrap gap-1 border-t border-line px-4 py-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={filtering || index === 0}
                      onClick={() => update((current) => ({ ...current, answers: moveRow(current.answers, index, -1) }))}
                    >
                      Move up
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={filtering || index === profile.answers.length - 1}
                      onClick={() => update((current) => ({ ...current, answers: moveRow(current.answers, index, 1) }))}
                    >
                      Move down
                    </Button>
                    <Button variant="ghost" size="sm" className="ml-auto" onClick={() => update((current) => ({ ...current, answers: removeRow(current.answers, index) }))}>
                      Remove answer
                    </Button>
                  </div>
                )}
              </details>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

function AnswerFields({
  answer,
  index,
  errors,
  readOnly,
  onChange,
}: {
  answer: Answer
  index: number
  errors: Record<string, string>
  readOnly: boolean
  onChange: (change: Partial<Answer>) => void
}) {
  const checkId = useId()
  return (
    <div className="grid gap-3 border-t border-line px-4 py-3">
      <Field label="Question" error={errors[`answers.${index}.question`]}>
        {(control) => <Input {...control} data-field={`answers.${index}.question`} readOnly={readOnly} value={answer.question} onChange={(event) => onChange({ question: event.target.value })} />}
      </Field>
      <Field label="Patterns" hint="One per line. Words a form question would contain, such as “sponsorship”." error={errors[`answers.${index}.patterns`]}>
        {(control) => (
          <Textarea
            {...control}
            data-field={`answers.${index}.patterns`}
            readOnly={readOnly}
            rows={3}
            className="font-mono text-[0.8125rem]"
            value={answer.patterns.join('\n')}
            onChange={(event) => onChange({ patterns: toLines(event.target.value) })}
          />
        )}
      </Field>
      <div className="flex items-start gap-2.5">
        <input
          id={checkId}
          type="checkbox"
          className="mt-0.5 size-4 shrink-0"
          disabled={readOnly}
          checked={answer.needsHuman ?? false}
          onChange={(event) => onChange({ needsHuman: event.target.checked })}
        />
        <label htmlFor={checkId} className="text-[0.8125rem]">
          <span className="block font-medium text-fg">I answer this myself</span>
          <span className="block text-fg-muted">Shortlist shows the answer below as a draft but never fills it in.</span>
        </label>
      </div>
      <Field label={answer.needsHuman ? 'Draft answer' : 'Answer'} error={errors[`answers.${index}.answer`]}>
        {(control) => (
          <Textarea {...control} data-field={`answers.${index}.answer`} readOnly={readOnly} rows={3} value={answer.answer} onChange={(event) => onChange({ answer: event.target.value })} />
        )}
      </Field>
      <Field label="Note to yourself" hint="Optional. Why the answer is what it is.">
        {(control) => <Textarea {...control} readOnly={readOnly} rows={2} value={answer.note ?? ''} onChange={(event) => onChange({ note: event.target.value })} />}
      </Field>
      {answer.id ? (
        <p className="text-xs text-fg-subtle">
          Id <span className="font-mono break-all">{answer.id}</span>
        </p>
      ) : null}
    </div>
  )
}

// ---------- Cover letter ----------

export function CoverLetterSection({ profile, update, errors, readOnly }: SectionProps) {
  const cover = profile.coverLetter
  const setCover = (change: Partial<Profile['coverLetter']>) => update((current) => ({ ...current, coverLetter: { ...current.coverLetter, ...change } }))
  return (
    <div className="max-w-2xl space-y-4">
      <SectionIntro>How your cover letters should sound. The cover letter check flags banned phrases and anything over the word limit.</SectionIntro>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Signature" error={errors['coverLetter.signature']}>
          {(control) => <Input {...control} data-field="coverLetter.signature" readOnly={readOnly} value={cover.signature} onChange={(event) => setCover({ signature: event.target.value })} />}
        </Field>
        <Field label="Word limit" error={errors['coverLetter.maxWords']}>
          {(control) => (
            <Input
              {...control}
              data-field="coverLetter.maxWords"
              type="number"
              inputMode="numeric"
              min={50}
              max={1000}
              readOnly={readOnly}
              className="font-mono"
              value={Number.isNaN(cover.maxWords) ? '' : cover.maxWords}
              onChange={(event) => setCover({ maxWords: event.target.value === '' ? Number.NaN : Number(event.target.value) })}
            />
          )}
        </Field>
      </div>
      <Field label="Voice notes" hint="One per line. Reminders for how you write.">
        {(control) => <Textarea {...control} readOnly={readOnly} rows={5} value={cover.voiceNotes.join('\n')} onChange={(event) => setCover({ voiceNotes: toLines(event.target.value) })} />}
      </Field>
      <Field label="Banned phrases" hint="One per line, on top of the built-in list. Matching ignores case.">
        {(control) => (
          <Textarea {...control} readOnly={readOnly} rows={6} className="font-mono text-[0.8125rem]" value={cover.bannedPhrases.join('\n')} onChange={(event) => setCover({ bannedPhrases: toLines(event.target.value) })} />
        )}
      </Field>
    </div>
  )
}

// ---------- Approved facts ----------

export function FactsSection({ profile, update, errors, readOnly }: SectionProps) {
  const setFact = (index: number, change: Partial<Profile['facts'][number]>) =>
    update((current) => ({ ...current, facts: replaceRow(current.facts, index, { ...current.facts[index], ...change }) }))
  return (
    <div>
      <SectionIntro
        action={
          readOnly ? null : (
            <Button size="sm" onClick={() => update((current) => ({ ...current, facts: [...current.facts, { label: '', value: '', source: '' }] }))}>
              Add fact
            </Button>
          )
        }
      >
        The only claims a cover letter may make. The cover letter check flags any number or name that is not here or elsewhere in your profile, so add only what
        you can back up, and say where.
      </SectionIntro>
      <ol className="space-y-2">
        {profile.facts.map((fact, index) => (
          <li key={rowKey(fact)} className="rounded-lg border border-line bg-surface p-3">
            <div className="grid gap-3 md:grid-cols-[12rem_minmax(0,1fr)]">
              <Field label="Label" error={errors[`facts.${index}.label`]}>
                {(control) => <Input {...control} data-field={`facts.${index}.label`} readOnly={readOnly} value={fact.label} onChange={(event) => setFact(index, { label: event.target.value })} />}
              </Field>
              <Field label="Source" error={errors[`facts.${index}.source`]}>
                {(control) => (
                  <Input {...control} data-field={`facts.${index}.source`} readOnly={readOnly} value={fact.source} onChange={(event) => setFact(index, { source: event.target.value })} />
                )}
              </Field>
              <Field label="Fact" className="md:col-span-2" error={errors[`facts.${index}.value`]}>
                {(control) => (
                  <Textarea {...control} data-field={`facts.${index}.value`} readOnly={readOnly} rows={2} value={fact.value} onChange={(event) => setFact(index, { value: event.target.value })} />
                )}
              </Field>
            </div>
            {readOnly ? null : (
              <Button variant="ghost" size="sm" className="mt-2" onClick={() => update((current) => ({ ...current, facts: removeRow(current.facts, index) }))}>
                Remove fact
              </Button>
            )}
          </li>
        ))}
      </ol>
    </div>
  )
}
