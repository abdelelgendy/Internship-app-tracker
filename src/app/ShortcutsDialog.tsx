import { Dialog } from '../ui/Dialog.tsx'
import { Kbd, KeySequence } from '../ui/Kbd.tsx'
import { NAV_ITEMS } from './nav.ts'

export function ShortcutsDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  return (
    <Dialog open={open} onClose={onClose} title="Keyboard shortcuts" description="They work anywhere except while you type in a field." size="sm">
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
          <dt>
            <Kbd>Esc</Kbd>
          </dt>
          <dd className="text-fg">Close a dialog or menu</dd>
        </div>
      </dl>
    </Dialog>
  )
}
