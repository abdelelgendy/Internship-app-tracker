import { EmptyState } from '@/ui/EmptyState.tsx'
import { PageHeader } from '@/ui/PageHeader.tsx'

export function ProfilePage() {
  return (
    <>
      <PageHeader title="Profile" description="Your details, targeting rules and saved answers." />
      <EmptyState title="Not built yet" description="This page is a placeholder from the scaffold." />
    </>
  )
}
