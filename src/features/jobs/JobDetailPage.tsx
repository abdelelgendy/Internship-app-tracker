import { useParams } from 'react-router'
import { EmptyState } from '@/ui/EmptyState.tsx'
import { PageHeader } from '@/ui/PageHeader.tsx'

export function JobDetailPage() {
  const { id } = useParams()
  return (
    <>
      <PageHeader
        title="Job"
        description={
          <>
            Score breakdown, gate verdict and the full posting for job <span className="font-mono break-all">{id}</span>.
          </>
        }
      />
      <EmptyState title="Not built yet" description="This page is a placeholder from the scaffold." />
    </>
  )
}
