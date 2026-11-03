import { Link } from 'react-router'
import { LogoMark } from '../ui/icons.tsx'

export function Brand() {
  return (
    <Link to="/today" className="inline-flex items-center gap-2 rounded-md px-1.5 py-1 text-fg">
      <LogoMark className="size-6" />
      <span className="text-[0.9375rem] font-semibold tracking-tight">Shortlist</span>
    </Link>
  )
}
