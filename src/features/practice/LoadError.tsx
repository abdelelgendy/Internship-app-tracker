import { LoadProblem } from '@/ui/LoadProblem.tsx'
import { PageHeader } from '@/ui/PageHeader.tsx'

/** A page whose data could not be read: its heading, then the shared load problem. */
export function LoadError({ title, error, onRetry }: { title: string; error: Error; onRetry: () => void }) {
  return (
    <>
      <PageHeader title={title} />
      <LoadProblem what="your data" error={error} onRetry={onRetry} />
    </>
  )
}
