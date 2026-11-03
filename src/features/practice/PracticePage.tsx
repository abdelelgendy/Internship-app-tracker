import { EmptyState } from '@/ui/EmptyState.tsx'
import { PageHeader } from '@/ui/PageHeader.tsx'

export function PracticePage() {
  return (
    <>
      <PageHeader title="Practice" description="Interview cards, exercises and STAR stories, scheduled for review." />
      <EmptyState title="Not built yet" description="This page is a placeholder from the scaffold." />
    </>
  )
}
