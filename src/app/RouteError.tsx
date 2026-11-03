import { isRouteErrorResponse, useRouteError } from 'react-router'
import { Button } from '../ui/Button.tsx'
import { EmptyState } from '../ui/EmptyState.tsx'
import { AlertIcon } from '../ui/icons.tsx'

/** Catches errors thrown while loading or rendering a page, so the rest of the app keeps working. */
export function RouteError() {
  const error = useRouteError()
  const detail = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : error instanceof Error
      ? error.message
      : String(error)
  return (
    <div role="alert">
      <EmptyState
        icon={<AlertIcon />}
        title="This page stopped with an error"
        description={
          <>
            Reloading usually fixes it. If it keeps happening, the message below says where it broke:
            <span className="mt-2 block font-mono text-xs break-all text-danger-ink">{detail}</span>
          </>
        }
        action={
          <Button variant="primary" onClick={() => window.location.reload()}>
            Reload page
          </Button>
        }
      />
    </div>
  )
}
