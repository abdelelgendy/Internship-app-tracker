import { EmptyState } from '@/ui/EmptyState.tsx'
import { PageHeader } from '@/ui/PageHeader.tsx'

export function SettingsPage() {
  return (
    <>
      <PageHeader title="Settings" description="Theme, data folder and reminders." />
      <EmptyState title="Not built yet" description="This page is a placeholder from the scaffold." />
    </>
  )
}
