import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import { cx } from './cx.ts'

export interface TabItem {
  id: string
  label: ReactNode
  /** A count shown after the label, e.g. how many items the panel holds. */
  count?: number
  content: ReactNode
}

export interface TabsProps {
  /** Names the tab list for screen readers, e.g. "Job sections". */
  label: string
  items: TabItem[]
  /** Controlled selection. Leave out to let Tabs track it, starting at defaultValue or the first tab. */
  value?: string
  defaultValue?: string
  onChange?: (id: string) => void
  className?: string
}

/**
 * Tabs with the WAI-ARIA keyboard model: arrow keys, Home and End move between tabs and select
 * them, and only the selected tab is in the Tab order. Only the selected panel is rendered.
 */
export function Tabs({ label, items, value, defaultValue, onChange, className }: TabsProps) {
  const baseId = useId()
  const [uncontrolled, setUncontrolled] = useState(defaultValue ?? items[0]?.id)
  const selectedId = value ?? uncontrolled
  const selected = items.find((item) => item.id === selectedId) ?? items[0]
  const tabRefs = useRef(new Map<string, HTMLButtonElement>())

  function select(id: string) {
    if (value === undefined) setUncontrolled(id)
    onChange?.(id)
  }

  function handleKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const index = items.findIndex((item) => item.id === selected?.id)
    const next = {
      ArrowRight: index + 1,
      ArrowLeft: index - 1,
      Home: 0,
      End: items.length - 1,
    }[event.key]
    if (next === undefined || items.length === 0) return
    event.preventDefault()
    const item = items[(next + items.length) % items.length]
    select(item.id)
    tabRefs.current.get(item.id)?.focus()
  }

  if (!selected) return null

  return (
    <div className={cx('min-w-0', className)}>
      {/* Below sm the tabs wrap onto a second row, so none is hidden off the edge of a phone. */}
      <div
        role="tablist"
        aria-label={label}
        onKeyDown={handleKeyDown}
        className="flex flex-wrap gap-x-1 shadow-[inset_0_-1px_0_var(--line)] sm:flex-nowrap sm:overflow-x-auto"
      >
        {items.map((item) => {
          const isSelected = item.id === selected.id
          return (
            <button
              key={item.id}
              ref={(node) => {
                if (node) tabRefs.current.set(item.id, node)
                else tabRefs.current.delete(item.id)
              }}
              type="button"
              role="tab"
              id={`${baseId}-tab-${item.id}`}
              aria-selected={isSelected}
              aria-controls={isSelected ? `${baseId}-panel-${item.id}` : undefined}
              tabIndex={isSelected ? 0 : -1}
              onClick={() => select(item.id)}
              className={cx(
                'inline-flex h-9 shrink-0 items-center gap-1.5 border-b-2 px-2.5 text-[0.8125rem] font-medium whitespace-nowrap transition-colors',
                isSelected ? 'border-fg text-fg' : 'border-transparent text-fg-muted hover:text-fg',
              )}
            >
              {item.label}
              {item.count !== undefined ? <span className="font-mono text-xs text-fg-subtle tabular-nums">{item.count}</span> : null}
            </button>
          )
        })}
      </div>
      <div
        role="tabpanel"
        id={`${baseId}-panel-${selected.id}`}
        aria-labelledby={`${baseId}-tab-${selected.id}`}
        tabIndex={0}
        className="pt-4 focus-visible:outline-offset-4"
      >
        {selected.content}
      </div>
    </div>
  )
}
