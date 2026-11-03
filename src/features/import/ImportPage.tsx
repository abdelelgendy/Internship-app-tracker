import { EmptyState } from '@/ui/EmptyState.tsx'
import { PageHeader } from '@/ui/PageHeader.tsx'

export function ImportPage() {
  return (
    <>
      <PageHeader title="Import" description="Bring in jobs, applications and practice decks, with a preview before anything is written." />
      <EmptyState title="Not built yet" description="This page is a placeholder from the scaffold." />
    </>
  )
}
