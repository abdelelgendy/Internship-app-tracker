import type { ScoreResult } from '../../engine/types.ts'
import { Badge } from '../../ui/Badge.tsx'
import { cx } from '../../ui/cx.ts'
import type { BadgeTone } from '../../ui/status.ts'

/**
 * The score, the tier and the gate verdict, drawn the same way on every page. A score is marked
 * with the highlighter only when the gate says to apply now, so the yellow means one thing.
 */

const VERDICT: Record<ScoreResult['gate']['verdict'], { label: string; tone: BadgeTone }> = {
  apply: { label: 'Apply now', tone: 'success' },
  hold: { label: 'On hold', tone: 'warn' },
  skip: { label: 'Skip', tone: 'muted' },
}

export function ScoreMark({ score, size = 'md' }: { score: ScoreResult | null; size?: 'md' | 'lg' }) {
  const text = size === 'lg' ? 'text-3xl font-semibold' : 'text-sm font-semibold'
  if (!score) return <span className={cx('font-mono text-fg-subtle tabular-nums', text)}>--</span>
  const label = `Score ${score.total} of 100${score.gate.verdict === 'apply' ? ', passes the gate' : ''}`
  return (
    <span className={cx('inline-block font-mono tabular-nums', text)} aria-label={label} title={label}>
      <span className={score.gate.verdict === 'apply' ? 'mark-swipe' : 'text-fg'}>{score.total}</span>
    </span>
  )
}

export function VerdictBadge({ verdict }: { verdict: ScoreResult['gate']['verdict'] }) {
  const { label, tone } = VERDICT[verdict]
  return <Badge tone={tone}>{label}</Badge>
}

/** A real minus sign (U+2212) for deductions, which reads better than a hyphen in a number. */
function signed(points: number): string {
  return points < 0 ? `\u2212${-points}` : String(points)
}

/** One row per rubric part, each with a bar for its share of the maximum and the reason in words. */
export function ScoreBreakdown({ score }: { score: ScoreResult }) {
  return (
    <div>
      <ul className="divide-y divide-line">
        {score.parts.map((part) => {
          const deduction = part.max === 0
          const share = part.max > 0 ? Math.max(0, Math.min(1, part.points / part.max)) : 0
          return (
            <li key={part.key} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 py-3 first:pt-0">
              <span className="text-sm font-medium text-fg">{part.label}</span>
              <span className="text-right font-mono text-sm tabular-nums">
                {deduction ? (
                  <span className={part.points < 0 ? 'text-danger-ink' : 'text-fg-subtle'}>{signed(part.points)}</span>
                ) : (
                  <>
                    <span className="text-fg">{part.points}</span>
                    <span className="text-fg-subtle"> / {part.max}</span>
                  </>
                )}
              </span>
              {deduction ? null : (
                <div aria-hidden="true" className="col-span-2 mt-2 h-1.5 overflow-hidden rounded-full bg-surface-2">
                  <div className="h-full rounded-full bg-fg" style={{ width: `${share * 100}%` }} />
                </div>
              )}
              <p className="col-span-2 mt-1.5 text-[0.8125rem] break-words text-fg-muted">{part.reason}</p>
            </li>
          )
        })}
      </ul>
      <div className="mt-1 flex items-baseline justify-between gap-3 border-t-2 border-fg pt-3">
        <span className="text-sm font-semibold text-fg">Total</span>
        <span className="font-mono text-sm tabular-nums">
          <ScoreMark score={score} />
          <span className="text-fg-subtle"> / 100</span>
        </span>
      </div>
    </div>
  )
}
