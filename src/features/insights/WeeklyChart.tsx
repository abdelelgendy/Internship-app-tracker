import { useCallback, useState } from 'react'
import { Button } from '../../ui/Button.tsx'
import { countTicks, type WeekCount } from './insightsModel.ts'

const HEIGHT = 200
const MARGIN = { top: 20, right: 8, bottom: 28, left: 28 }
const MAX_COLUMN = 24
const RADIUS = 4
const FALLBACK_WIDTH = 560

const SHORT_DAY = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })

/** "Oct 27" for a YYYY-MM-DD day. The day is already in the user's zone, so it is formatted as a UTC date. */
function shortDay(day: string): string {
  return SHORT_DAY.format(new Date(`${day}T00:00:00Z`))
}

function weekName(week: WeekCount): string {
  return week.current ? `This week (from ${shortDay(week.start)}, so far)` : `Week of ${shortDay(week.start)}`
}

/** A column with a 4px rounded top and a square base on the baseline. */
function columnPath(x: number, width: number, top: number, base: number): string {
  const height = base - top
  if (height <= 0) return ''
  const r = Math.min(RADIUS, height, width / 2)
  return `M${x},${base}V${top + r}Q${x},${top} ${x + r},${top}H${x + width - r}Q${x + width},${top} ${x + width},${top + r}V${base}Z`
}

/** The element's width, kept up to date while the page is resized. */
function useWidth(): [number, (node: HTMLElement | null) => void] {
  const [width, setWidth] = useState(FALLBACK_WIDTH)
  const ref = useCallback((node: HTMLElement | null) => {
    if (!node) return
    const measure = () => setWidth(Math.round(node.getBoundingClientRect().width) || FALLBACK_WIDTH)
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [])
  return [width, ref]
}

export function WeeklyChart({ weeks }: { weeks: WeekCount[] }) {
  const [showTable, setShowTable] = useState(false)
  const total = weeks.reduce((sum, week) => sum + week.count, 0)
  const busiest = weeks.reduce((best, week) => (week.count > best.count ? week : best), weeks[0])
  const summary =
    total === 0
      ? `No applications sent in the last ${weeks.length} weeks.`
      : `${total} sent in the last ${weeks.length} weeks. The busiest was ${busiest.current ? 'this week' : `the week of ${shortDay(busiest.start)}`}, with ${busiest.count}. This week so far: ${weeks[weeks.length - 1].count}.`

  return (
    <div className="p-4">
      <div className="flex flex-wrap items-start justify-between gap-x-3 gap-y-2">
        <p className="min-w-0 flex-1 basis-56 text-[0.8125rem] text-fg-muted">{summary}</p>
        <Button size="sm" variant="ghost" aria-pressed={showTable} onClick={() => setShowTable((value) => !value)}>
          {showTable ? 'Show chart' : 'Show table'}
        </Button>
      </div>
      {showTable ? <WeekTable weeks={weeks} /> : <Columns weeks={weeks} summary={summary} />}
    </div>
  )
}

function WeekTable({ weeks }: { weeks: WeekCount[] }) {
  return (
    <div className="mt-3 overflow-x-auto">
      <table className="w-full text-sm">
        <caption className="sr-only">Applications sent per week</caption>
        <thead>
          <tr className="border-b border-line text-left text-xs text-fg-muted">
            <th scope="col" className="py-2 pr-4 font-medium">
              Week
            </th>
            <th scope="col" className="py-2 text-right font-medium">
              Sent
            </th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {[...weeks].reverse().map((week) => (
            <tr key={week.start}>
              <th scope="row" className="py-1.5 pr-4 text-left font-normal text-fg">
                {weekName(week)}
              </th>
              <td className="py-1.5 text-right font-mono text-fg tabular-nums">{week.count}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function Columns({ weeks, summary }: { weeks: WeekCount[]; summary: string }) {
  const [width, measure] = useWidth()
  const [hovered, setHovered] = useState<number | null>(null)
  const ticks = countTicks(Math.max(...weeks.map((week) => week.count)))
  const top = ticks[ticks.length - 1]
  const plotWidth = Math.max(0, width - MARGIN.left - MARGIN.right)
  const plotHeight = HEIGHT - MARGIN.top - MARGIN.bottom
  const band = plotWidth / weeks.length
  const column = Math.min(MAX_COLUMN, Math.max(4, band * 0.6))
  const y = (value: number) => MARGIN.top + plotHeight - (value / top) * plotHeight
  const base = y(0)
  // A label every week when there is room, otherwise every second or third, always keeping this week.
  const labelEvery = band >= 44 ? 1 : band >= 24 ? 2 : 3
  const peak = Math.max(...weeks.map((week) => week.count))
  const peakIndex = weeks.findIndex((week) => week.count === peak)
  const tip = hovered === null ? null : weeks[hovered]

  return (
    <div ref={measure} className="relative mt-3">
      <svg width={width} height={HEIGHT} role="img" aria-label={`Column chart. ${summary}`} className="block max-w-full overflow-visible">
        {ticks.map((tick) => (
          <g key={tick}>
            <line x1={MARGIN.left} x2={width - MARGIN.right} y1={y(tick)} y2={y(tick)} stroke="var(--line)" strokeWidth={1} shapeRendering="crispEdges" />
            <text x={MARGIN.left - 8} y={y(tick)} dy="0.32em" textAnchor="end" fill="var(--fg-subtle)" fontSize={11} className="font-mono tabular-nums">
              {tick}
            </text>
          </g>
        ))}
        {weeks.map((week, index) => {
          const x = MARGIN.left + index * band
          const columnX = x + (band - column) / 2
          const showLabel = week.current || (weeks.length - 1 - index) % labelEvery === 0
          const showValue = week.count > 0 && (index === peakIndex || week.current || hovered === index)
          return (
            <g key={week.start}>
              {hovered === index ? <rect x={x} y={MARGIN.top} width={band} height={plotHeight} fill="var(--surface-2)" /> : null}
              <path d={columnPath(columnX, column, y(week.count), base)} fill="var(--accent-ink)" />
              {showValue ? (
                <text x={columnX + column / 2} y={y(week.count) - 6} textAnchor="middle" fill="var(--fg)" fontSize={11} fontWeight={600} className="font-mono tabular-nums">
                  {week.count}
                </text>
              ) : null}
              {showLabel ? (
                <text x={x + band / 2} y={HEIGHT - 8} textAnchor="middle" fill="var(--fg-subtle)" fontSize={11}>
                  {week.current ? 'This week' : shortDay(week.start)}
                </text>
              ) : null}
              <rect
                x={x}
                y={MARGIN.top}
                width={band}
                height={plotHeight + MARGIN.bottom}
                fill="transparent"
                onPointerEnter={() => setHovered(index)}
                onPointerLeave={() => setHovered((current) => (current === index ? null : current))}
              />
            </g>
          )
        })}
        <line x1={MARGIN.left} x2={width - MARGIN.right} y1={base} y2={base} stroke="var(--line-strong)" strokeWidth={1} shapeRendering="crispEdges" />
      </svg>
      {tip && hovered !== null ? (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-full rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs whitespace-nowrap text-fg shadow-pop"
          style={{ left: Math.min(Math.max(MARGIN.left + (hovered + 0.5) * band, 70), width - 70), top: Math.max(y(tip.count) - 22, 18) }}
        >
          <span className="text-fg-muted">{weekName(tip)}</span>
          <span className="ml-2 font-mono font-semibold tabular-nums">{tip.count} sent</span>
        </div>
      ) : null}
    </div>
  )
}
