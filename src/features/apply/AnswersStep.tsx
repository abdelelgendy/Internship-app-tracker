import { useId, useState, type FormEvent } from 'react'
import type { Profile } from '../../engine/types.ts'
import { Badge } from '../../ui/Badge.tsx'
import { Button } from '../../ui/Button.tsx'
import { IconButton } from '../../ui/IconButton.tsx'
import { Input } from '../../ui/Input.tsx'
import { Textarea } from '../../ui/Textarea.tsx'
import { useToast } from '../../ui/toast-context.ts'
import { copyText } from '../jobs/clipboard.ts'
import { CopyIcon } from '../../ui/icons.tsx'
import { answerSource, initialAnswer, type AnswerState, type QuestionOrigin } from './applyModel.ts'

const GROUPS: { origin: QuestionOrigin[]; title: string }[] = [
  { origin: ['saved'], title: 'Your saved answers' },
  { origin: ['history', 'skill'], title: 'From this posting' },
  { origin: ['custom'], title: 'Questions you added' },
]

/**
 * The form answers, one row per question: the suggested answer and where it came from, or a
 * "You answer this" flag when the engine has no answer it can stand behind. Copy an answer into
 * the form, and tick "Used on this form" for every one you gave; those are recorded when you
 * mark the application submitted.
 */
export function AnswersStep({
  states,
  profile,
  onChange,
  onAddQuestion,
}: {
  states: AnswerState[]
  profile: Profile
  onChange: (question: string, next: { value: string; used: boolean }) => void
  onAddQuestion: (question: string) => void
}) {
  const toast = useToast()
  const [question, setQuestion] = useState('')
  const toAnswer = states.filter((state) => state.row.decision.kind === 'human').length
  const used = states.filter((state) => state.used && state.value.trim() !== '').length

  async function copy(state: AnswerState) {
    const copied = await copyText(state.value)
    if (copied) {
      onChange(state.row.question, { value: state.value, used: true })
      toast.show({ title: 'Answer copied', description: state.row.question })
    } else {
      toast.show({
        title: "Couldn't copy",
        description: 'Your browser blocked the clipboard. Select the answer and copy it by hand.',
        tone: 'danger',
      })
    }
  }

  function add(event: FormEvent) {
    event.preventDefault()
    const text = question.trim()
    if (!text) return
    onAddQuestion(text)
    setQuestion('')
  }

  return (
    <div className="space-y-5">
      <p className="text-[0.8125rem] text-fg-muted">
        <span className="font-mono text-fg tabular-nums">{states.length - toAnswer}</span> suggested,{' '}
        <span className="font-mono text-fg tabular-nums">{toAnswer}</span> for you to answer,{' '}
        <span className="font-mono text-fg tabular-nums">{used}</span> marked as used.
      </p>
      {GROUPS.map((group) => {
        const inGroup = states.filter((state) => group.origin.includes(state.row.origin))
        if (inGroup.length === 0) return null
        return (
          <section key={group.title} aria-label={group.title}>
            <h3 className="mb-1 text-xs font-semibold tracking-wide text-fg-muted uppercase">{group.title}</h3>
            <ul className="divide-y divide-line">
              {inGroup.map((state) => (
                <AnswerItem key={state.row.question} state={state} profile={profile} onChange={onChange} onCopy={copy} />
              ))}
            </ul>
          </section>
        )
      })}
      <form onSubmit={add} className="flex flex-wrap items-end gap-2 border-t border-line pt-4">
        <label className="min-w-0 flex-[1_1_16rem]">
          <span className="mb-1 block text-[0.8125rem] font-medium text-fg">Another question from the form</span>
          <Input
            value={question}
            onChange={(event) => setQuestion(event.target.value)}
            placeholder="Paste a question"
          />
        </label>
        <Button type="submit" disabled={question.trim() === ''}>
          Add question
        </Button>
      </form>
    </div>
  )
}

function AnswerItem({
  state,
  profile,
  onChange,
  onCopy,
}: {
  state: AnswerState
  profile: Profile
  onChange: (question: string, next: { value: string; used: boolean }) => void
  onCopy: (state: AnswerState) => void
}) {
  const id = useId()
  const { row, value, used, edited } = state
  const human = row.decision.kind === 'human'
  const suggestion = initialAnswer(row.decision)

  return (
    <li className="py-3" data-answer-row={row.question}>
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1">
        <label htmlFor={`${id}-answer`} className="min-w-0 flex-1 text-sm font-medium break-words text-fg">
          {row.question}
        </label>
        {human ? <Badge tone="warn">You answer this</Badge> : null}
      </div>
      <p id={`${id}-source`} className="mt-0.5 text-xs break-words text-fg-muted">
        {human ? row.decision.reason : answerSource(row.decision, profile)}
      </p>
      <div className="mt-2 flex items-start gap-1.5">
        {/* Always a textarea that grows with its answer: the answer is what you read and copy, so it must never be cut off. */}
        <Textarea
          autoGrow
          id={`${id}-answer`}
          aria-describedby={`${id}-source`}
          value={value}
          placeholder={human ? 'Your answer' : undefined}
          onChange={(event) => onChange(row.question, { value: event.target.value, used: event.target.value.trim() !== '' })}
        />
        <IconButton
          label={`Copy answer to: ${row.question}`}
          icon={<CopyIcon />}
          variant="secondary"
          disabled={value.trim() === ''}
          onClick={() => onCopy(state)}
        />
      </div>
      <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs">
        <label className="flex items-center gap-1.5 text-fg">
          <input
            type="checkbox"
            checked={used}
            disabled={value.trim() === ''}
            onChange={(event) => onChange(row.question, { value, used: event.target.checked })}
          />
          Used on this form
        </label>
        {edited && suggestion ? (
          <span className="text-fg-muted">
            Edited.{' '}
            <button
              type="button"
              className="font-medium text-fg underline underline-offset-2"
              onClick={() => onChange(row.question, { value: suggestion, used })}
            >
              Use the saved answer
            </button>
          </span>
        ) : null}
      </div>
    </li>
  )
}
