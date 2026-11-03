import { NavLink } from 'react-router'
import { cx } from '../ui/cx.ts'
import { Kbd } from '../ui/Kbd.tsx'
import { NAV_ITEMS, type NavItem } from './nav.ts'

const GROUPS: { id: NavItem['group']; label?: string }[] = [{ id: 'work' }, { id: 'setup', label: 'Setup' }]

/** The page list, used by the sidebar and by the phone menu. The current page gets the highlighter. */
export function NavList({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <div className="space-y-5">
      {GROUPS.map((group) => (
        <div key={group.id}>
          {group.label ? (
            <p className="px-2.5 pb-1.5 text-[0.6875rem] font-medium tracking-wider text-fg-subtle uppercase">{group.label}</p>
          ) : null}
          <ul className="space-y-0.5">
            {NAV_ITEMS.filter((item) => item.group === group.id).map((item) => (
              <li key={item.to}>
                <NavLink
                  to={item.to}
                  onClick={onNavigate}
                  className={({ isActive }) =>
                    cx(
                      'group flex h-9 items-center gap-2.5 rounded-md px-2.5 text-[0.8125rem] transition-colors md:h-8',
                      isActive ? 'font-medium text-fg' : 'text-fg-muted hover:bg-surface-2 hover:text-fg',
                    )
                  }
                >
                  {({ isActive }) => (
                    <>
                      <item.icon className={cx('size-4 shrink-0', isActive ? 'text-fg' : 'text-fg-subtle group-hover:text-fg')} />
                      <span className="flex-1">
                        <span className={isActive ? 'mark-swipe' : undefined}>{item.label}</span>
                      </span>
                      <span
                        aria-hidden="true"
                        className="hidden gap-0.5 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100 md:flex"
                      >
                        <Kbd>g</Kbd>
                        <Kbd>{item.shortcut}</Kbd>
                      </span>
                    </>
                  )}
                </NavLink>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </div>
  )
}
