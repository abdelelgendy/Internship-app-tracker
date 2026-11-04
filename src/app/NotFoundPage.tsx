import { Link, useLocation } from 'react-router'
import { EmptyState } from '../ui/EmptyState.tsx'
import { PageHeader } from '../ui/PageHeader.tsx'
import { buttonClass } from '../ui/styles.ts'

export function NotFoundPage() {
  const { pathname } = useLocation()
  return (
    <>
      <PageHeader title="Page not found" />
      <EmptyState
        title={
          <>
            Nothing lives at <span className="font-mono break-words">{pathname}</span>
          </>
        }
        description="The link may be old, or the item it pointed to was removed."
        action={
          <Link to="/today" className={buttonClass({ variant: 'primary' })}>
            Go to Today
          </Link>
        }
      />
    </>
  )
}
