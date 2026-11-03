import { cx } from './cx.ts'

/** A placeholder block. Give it the size of what it stands in for, so nothing jumps when data arrives. */
export function Skeleton({ className }: { className?: string }) {
  return <div aria-hidden="true" className={cx('animate-pulse rounded bg-surface-2', className)} />
}

/** Lines of text, the last one shorter, like a paragraph. */
export function SkeletonText({ lines = 3, className }: { lines?: number; className?: string }) {
  return (
    <div aria-hidden="true" className={cx('space-y-2', className)}>
      {Array.from({ length: lines }, (_, index) => (
        <Skeleton key={index} className={cx('h-3', index === lines - 1 && lines > 1 ? 'w-3/5' : 'w-full')} />
      ))}
    </div>
  )
}
