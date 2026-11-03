import { useState } from 'react'
import type { Job, Profile } from '../../engine/types.ts'
import { Button } from '../../ui/Button.tsx'
import { Dialog } from '../../ui/Dialog.tsx'
import { useToast } from '../../ui/toast-context.ts'
import { SparkIcon } from '../jobs/icons.tsx'
import { draftRequest, requestCoverDraft } from './aiDraft.ts'

/**
 * "Draft with Claude": shows exactly what will be sent, sends it only when you confirm, and puts
 * the draft in the editor for you to edit, with undo. Loaded only on the dev server in local mode.
 */
export function DraftWithClaude({
  job,
  profile,
  current,
  onDraft,
}: {
  job: Pick<Job, 'company' | 'title' | 'jdText'>
  profile: Profile
  current: string
  onDraft: (value: string) => void
}) {
  const toast = useToast()
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const request = draftRequest(job, profile)
  const postingWords = request.jdText.split(/\s+/).filter(Boolean).length

  async function send() {
    setBusy(true)
    setError(null)
    try {
      const draft = await requestCoverDraft(request)
      const signature = profile.coverLetter.signature.trim()
      const letter = signature && !draft.trimEnd().endsWith(signature) ? `${draft.trimEnd()}\n\n${signature}` : draft
      const previous = current
      onDraft(letter)
      setOpen(false)
      toast.show({
        title: 'Draft added',
        description: 'Read it and edit it before you use it. The checks below ran on it.',
        action: previous.trim() ? { label: 'Undo', onAction: () => onDraft(previous) } : undefined,
      })
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <Button size="sm" onClick={() => setOpen(true)}>
        <SparkIcon />
        Draft with Claude
      </Button>
      <Dialog
        open={open}
        onClose={() => !busy && setOpen(false)}
        title="Draft a cover letter with Claude"
        description="This sends text to Anthropic's API. Read what goes before you send it."
        footer={
          <>
            <Button onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="primary" onClick={() => void send()} disabled={busy || postingWords < 8}>
              {busy ? 'Drafting...' : 'Send and draft'}
            </Button>
          </>
        }
      >
        <div className="space-y-3 text-[0.8125rem]">
          <p className="font-medium text-fg">What is sent</p>
          <ul className="list-disc space-y-1 pl-5 text-fg">
            <li className="break-words">
              The posting: {job.company}, {job.title} ({postingWords} words of description)
            </li>
            <li className="break-words">
              {request.facts.length} approved fact{request.facts.length === 1 ? '' : 's'}
              {request.facts.length > 0 ? `: ${request.facts.map((fact) => fact.label).join(', ')}` : ''}
            </li>
            <li>Your style rules: at most {request.style.maxWords} words, voice notes and banned phrases</li>
          </ul>
          <p className="text-fg-muted">
            Not sent: your name, email, phone, links, location, work authorization, form answers or application history. Email addresses and
            phone numbers are removed from the text before it leaves this computer.
          </p>
          {postingWords < 8 ? (
            <p className="text-danger-ink">This job has no description to write from. Paste it into the job first.</p>
          ) : null}
          {current.trim() ? <p className="text-warn-ink">The draft replaces the text in the editor. You can undo it.</p> : null}
          {error ? (
            <p role="alert" className="break-words text-danger-ink">
              {error}
            </p>
          ) : null}
        </div>
      </Dialog>
    </>
  )
}
