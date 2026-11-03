import { useParams } from 'react-router'
import { EmptyState } from '@/ui/EmptyState.tsx'
import { PageHeader } from '@/ui/PageHeader.tsx'

export function ApplyPage() {
  const { applicationId } = useParams()
  return (
    <>
      <PageHeader
        title="Apply"
        description={
          <>
            Checklist, saved answers and the cover letter draft for application <span className="font-mono break-all">{applicationId}</span>.
          </>
        }
      />
      <EmptyState title="Not built yet" description="This page is a placeholder from the scaffold." />
    </>
  )
}
