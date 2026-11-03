import { EmptyState } from '@/ui/EmptyState.tsx'
import { PageHeader } from '@/ui/PageHeader.tsx'

export function TodayPage() {
  return (
    <>
      <PageHeader title="Today" description="Follow-ups that are due, interviews coming up, and applications waiting on you." />
      <EmptyState title="Not built yet" description="This page is a placeholder from the scaffold." />
    </>
  )
}
