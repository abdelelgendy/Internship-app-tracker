import { EmptyState } from '@/ui/EmptyState.tsx'
import { PageHeader } from '@/ui/PageHeader.tsx'

export function JobsPage() {
  return (
    <>
      <PageHeader title="Jobs" description="Postings from the scanner or added by hand, each scored for fit." />
      <EmptyState title="Not built yet" description="This page is a placeholder from the scaffold." />
    </>
  )
}
