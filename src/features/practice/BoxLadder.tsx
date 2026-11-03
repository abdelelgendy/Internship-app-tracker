import type { DeckStats } from '@/engine/practice.ts'
import { cx } from '@/ui/cx.ts'

const BOXES = [1, 2, 3, 4, 5] as const

/**
 * The deck as five Leitner boxes plus a pile of unseen cards: a card climbs a box each time you
 * know it, so a deck you have learned leans to the right.
 */
export function BoxLadder({ stats, className }: { stats: DeckStats; className?: string }) {
  const columns = [{ label: 'new', count: stats.unseen }, ...BOXES.map((box) => ({ label: String(box), count: stats.byBox[box] }))]
  const tallest = Math.max(1, ...columns.map((column) => column.count))
  const summary = `${stats.unseen} new, ${stats.learning} learning (boxes 1 and 2), ${stats.reviewing} reviewing (boxes 3 and 4), ${stats.mastered} mastered (box 5)`
  return (
    <div role="img" aria-label={summary} className={cx('flex items-end gap-1', className)}>
      {columns.map((column, index) => (
        <div key={column.label} className="flex w-full min-w-0 flex-col items-center gap-1">
          <div className="flex h-10 w-full items-end rounded-sm bg-surface-2">
            <div
              className={cx('w-full rounded-sm', index === 0 ? 'bg-line-strong' : index === 5 ? 'bg-accent' : 'bg-fg/70')}
              style={{ height: column.count === 0 ? 0 : `max(3px, ${(column.count / tallest) * 100}%)` }}
            />
          </div>
          <span aria-hidden="true" className="font-mono text-[0.6875rem] leading-none text-fg-subtle tabular-nums">
            {column.label}
          </span>
        </div>
      ))}
    </div>
  )
}
