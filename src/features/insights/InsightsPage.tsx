import { EmptyState } from '@/ui/EmptyState.tsx'
import { PageHeader } from '@/ui/PageHeader.tsx'

export function InsightsPage() {
  return (
    <>
      <PageHeader title="Insights" description="Response and interview rates, shown once there are enough applications to mean something." />
      <EmptyState title="Not built yet" description="This page is a placeholder from the scaffold." />
    </>
  )
}
