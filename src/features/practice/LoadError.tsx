import { Button } from '@/ui/Button.tsx'
import { EmptyState } from '@/ui/EmptyState.tsx'
import { AlertIcon } from '@/ui/icons.tsx'
import { PageHeader } from '@/ui/PageHeader.tsx'

/** A page whose data could not be read: what failed, and a way to try again. */
export function LoadError({ title, error, onRetry }: { title: string; error: Error; onRetry: () => void }) {
  return (
    <>
      <PageHeader title={title} />
      <EmptyState
        icon={<AlertIcon />}
        title="Couldn't load your data"
        description={error.message}
        action={
          <Button variant="primary" onClick={onRetry}>
            Try again
          </Button>
        }
      />
    </>
  )
}
