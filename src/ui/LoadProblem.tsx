import { Button } from './Button.tsx'
import { EmptyState } from './EmptyState.tsx'
import { AlertIcon } from './icons.tsx'

/** The error's own words for the details, or a plain note when it has none ("null" says nothing). */
function technicalText(error: Error): string {
  const message = error.message.trim()
  if (message && message !== 'null' && message !== 'undefined') return message
  return error.name && error.name !== 'Error' ? error.name : 'The error had no message.'
}

/**
 * A failed load, said in plain words with the next step. The raw message is for whoever has to
 * debug it, so it sits behind "Technical details". Every page uses this one, so they all read
 * and behave the same.
 */
export function LoadProblem({ what, error, onRetry }: { what: string; error: Error; onRetry: () => void }) {
  return (
    <div role="alert">
      <EmptyState
        icon={<AlertIcon />}
        title={`Couldn't load ${what}`}
        description="Shortlist couldn't read your saved data just now. Try again, or reload the page. Nothing was changed."
        action={
          <div className="flex flex-col items-center gap-3">
            <Button variant="primary" onClick={onRetry}>
              Try again
            </Button>
            <details className="max-w-prose text-xs text-fg-muted">
              <summary className="cursor-pointer">Technical details</summary>
              <p className="mt-1 font-mono break-words">{technicalText(error)}</p>
            </details>
          </div>
        }
      />
    </div>
  )
}
