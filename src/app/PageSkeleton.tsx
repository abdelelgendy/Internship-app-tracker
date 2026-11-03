import { Skeleton, SkeletonText } from '../ui/Skeleton.tsx'

/** Shown while a page's code loads. Mirrors PageHeader and a couple of cards. */
export function PageSkeleton() {
  return (
    <div aria-busy="true">
      <span className="sr-only">Loading page</span>
      <div className="mb-6">
        <Skeleton className="h-7 w-40" />
        <Skeleton className="mt-2 h-4 w-full max-w-sm" />
      </div>
      <div className="space-y-3">
        {[0, 1].map((key) => (
          <div key={key} className="rounded-lg border border-line bg-surface p-4">
            <Skeleton className="mb-3 h-4 w-1/3" />
            <SkeletonText lines={3} />
          </div>
        ))}
      </div>
    </div>
  )
}
