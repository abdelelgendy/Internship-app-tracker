import { Button } from '../../ui/Button.tsx'
import { EmptyState } from '../../ui/EmptyState.tsx'
import { AlertIcon } from '../../ui/icons.tsx'

/** A failed load, with the message and a way to try again. */
export function LoadProblem({ what, error, onRetry }: { what: string; error: Error; onRetry: () => void }) {
  return (
    <div role="alert">
      <EmptyState
        icon={<AlertIcon />}
        title={`Couldn't load ${what}`}
        description={<span className="break-words">{error.message}</span>}
        action={<Button onClick={onRetry}>Try again</Button>}
      />
    </div>
  )
}
