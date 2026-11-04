import { useEffect, useRef, useState } from 'react'
import { Outlet, ScrollRestoration, useLocation, useNavigate, useNavigation } from 'react-router'
import { Button } from '../ui/Button.tsx'
import { cx } from '../ui/cx.ts'
import { Dialog } from '../ui/Dialog.tsx'
import { IconButton } from '../ui/IconButton.tsx'
import { KeyboardIcon, MenuIcon } from '../ui/icons.tsx'
import { Kbd } from '../ui/Kbd.tsx'
import { Brand } from './Brand.tsx'
import type { DataMode } from '../data/mode.ts'
import { ModeBanner } from './ModeBanner.tsx'
import { NavList } from './NavList.tsx'
import { ShortcutsDialog } from './ShortcutsDialog.tsx'
import { ThemeToggle } from './ThemeToggle.tsx'
import { useKeyboardShortcuts } from './useKeyboardShortcuts.ts'

// How long to wait for a page that is still loading to render its heading.
const HEADING_WAIT_MS = 3000

/**
 * After a navigation, move focus to the new page's heading so screen readers announce it. A page
 * that is still loading shows a skeleton without one, so this waits for the h1 to mount, and
 * falls back to <main> only if none appears. It never takes focus back from something the person
 * has already moved to inside the page.
 */
function useFocusOnNavigation(pathname: string) {
  const lastPathname = useRef(pathname)
  useEffect(() => {
    if (lastPathname.current === pathname) return
    lastPathname.current = pathname
    const main = document.getElementById('main')
    if (!main) return
    const focus = (target: HTMLElement) => {
      const current = document.activeElement
      if (current === main || !main.contains(current)) target.focus({ preventScroll: true })
    }
    const heading = () => main.querySelector<HTMLElement>('h1')
    const ready = heading()
    if (ready) {
      focus(ready)
      return
    }
    const observer = new MutationObserver(() => {
      const found = heading()
      if (!found) return
      stop()
      focus(found)
    })
    const timer = setTimeout(() => {
      stop()
      focus(heading() ?? main)
    }, HEADING_WAIT_MS)
    function stop() {
      observer.disconnect()
      clearTimeout(timer)
    }
    observer.observe(main, { childList: true, subtree: true })
    return stop
  }, [pathname])
}

const WIDE_PAGES = new Set(['/board'])

/**
 * Layout for every page: a left sidebar from md (768px) up, a compact top bar with a menu
 * below that, and the data-source banner above the page content.
 */
export function AppShell({ dataMode }: { dataMode: DataMode }) {
  const navigate = useNavigate()
  const navigation = useNavigation()
  const { pathname } = useLocation()
  const [menuOpen, setMenuOpen] = useState(false)
  const [shortcutsOpen, setShortcutsOpen] = useState(false)

  useKeyboardShortcuts({ onNavigate: navigate, onShowHelp: () => setShortcutsOpen(true) })
  useFocusOnNavigation(pathname)

  return (
    <div className="min-h-dvh md:grid md:grid-cols-[14rem_minmax(0,1fr)]">
      <a
        href="#main"
        className="sr-only z-50 rounded-md bg-fg px-3 py-2 text-surface focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        Skip to content
      </a>
      {navigation.state === 'loading' ? (
        <div aria-hidden="true" className="route-progress fixed inset-x-0 top-0 z-50 h-0.5 bg-fg" />
      ) : null}

      <aside className="hidden border-r border-line md:sticky md:top-0 md:flex md:h-dvh md:flex-col md:px-3 md:py-4">
        <Brand />
        <nav aria-label="Main" className="mt-6 min-h-0 flex-1 overflow-y-auto">
          <NavList />
        </nav>
        <div className="mt-4 space-y-0.5 border-t border-line pt-3">
          <ThemeToggle />
          <Button variant="ghost" size="sm" className="w-full justify-start" onClick={() => setShortcutsOpen(true)}>
            <KeyboardIcon />
            <span className="flex-1 text-left">Keyboard shortcuts</span>
            <Kbd>?</Kbd>
          </Button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-col">
        <header className="sticky top-0 z-30 flex h-12 items-center justify-between gap-2 border-b border-line bg-bg px-2.5 md:hidden">
          <Brand />
          <div className="flex items-center gap-0.5">
            <ThemeToggle compact />
            <IconButton label="Open menu" icon={<MenuIcon />} aria-expanded={menuOpen} onClick={() => setMenuOpen(true)} />
          </div>
        </header>
        <ModeBanner mode={dataMode} />
        {/* The board's eleven columns use the full width; every other page keeps a readable measure. */}
        <main
          id="main"
          tabIndex={-1}
          className={cx('mx-auto w-full flex-1 px-4 py-6 outline-none md:px-8 md:py-8', !WIDE_PAGES.has(pathname) && 'max-w-6xl')}
        >
          <Outlet />
        </main>
      </div>

      <Dialog variant="sheet" open={menuOpen} onClose={() => setMenuOpen(false)} title="Menu">
        <nav aria-label="Main">
          <NavList onNavigate={() => setMenuOpen(false)} />
        </nav>
      </Dialog>
      <ShortcutsDialog open={shortcutsOpen} onClose={() => setShortcutsOpen(false)} />
      <ScrollRestoration />
    </div>
  )
}
