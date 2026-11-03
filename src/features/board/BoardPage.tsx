import { EmptyState } from '@/ui/EmptyState.tsx'
import { PageHeader } from '@/ui/PageHeader.tsx'

export function BoardPage() {
  return (
    <>
      <PageHeader title="Board" description="Every application by status. Drag a card to move it." />
      <EmptyState title="Not built yet" description="This page is a placeholder from the scaffold." />
    </>
  )
}
