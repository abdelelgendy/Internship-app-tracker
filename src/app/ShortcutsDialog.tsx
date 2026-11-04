import { Dialog } from '../ui/Dialog.tsx'
import { Kbd, KeySequence } from '../ui/Kbd.tsx'
import { NAV_ITEMS } from './nav.ts'
import { useShortcutsEnabled } from './shortcutsSetting.ts'

export function ShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [enabled, setEnabled] = useShortcutsEnabled()
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Keyboard shortcuts"
      description={enabled ? 'They work anywhere except while you type in a field.' : 'The single-key shortcuts are off. Alt+N and Esc still work.'}
      size="sm"
    >
      <label className="mb-4 flex cursor-pointer items-center gap-2.5 text-[0.8125rem] font-medium text-fg">
        <input type="checkbox" className="size-4 shrink-0" checked={enabled} onChange={(event) => setEnabled(event.target.checked)} />
        Use single-key shortcuts
      </label>
      <dl className="grid grid-cols-[auto_1fr] items-center gap-x-4 gap-y-2.5 text-[0.8125rem]">
        {NAV_ITEMS.map((item) => (
          <div key={item.to} className="contents">
            <dt>
              <KeySequence keys={['g', item.shortcut]} />
            </dt>
            <dd className="text-fg">Go to {item.label}</dd>
          </div>
        ))}
        <div className="contents">
          <dt>
            <Kbd>?</Kbd>
          </dt>
          <dd className="text-fg">Show this list</dd>
        </div>
        <div className="contents">
          <dt className="inline-flex items-center gap-1">
            <Kbd>1</Kbd>
            <span className="text-[0.6875rem] text-fg-subtle">to</span>
            <Kbd>4</Kbd>
          </dt>
          <dd className="text-fg">Grade a practice card: Again, Hard, Good, Easy</dd>
        </div>
        <div className="contents">
          <dt className="inline-flex items-center gap-1">
            <Kbd>Alt</Kbd>
            <span className="text-[0.6875rem] text-fg-subtle">+</span>
            <Kbd>N</Kbd>
          </dt>
          <dd className="text-fg">Go to the latest notification, such as Undo</dd>
        </div>
        <div className="contents">
          <dt>
            <Kbd>Esc</Kbd>
          </dt>
          <dd className="text-fg">Close a dialog or menu</dd>
        </div>
      </dl>
    </Dialog>
  )
}
