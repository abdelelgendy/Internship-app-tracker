// RouterProvider comes from the main entry, not react-router/dom: under Vitest the two entries load
// different builds of the router, which splits its context in two.
import { RouterProvider, type DataRouter } from 'react-router'
import { DataProvider } from './data/DataProvider.tsx'
import type { DataSource } from './data/mode.ts'
import { ToastProvider } from './ui/Toast.tsx'

/** main.tsx picks the data source and builds the router once, before the first render. */
export default function App({ source, router }: { source: DataSource; router: DataRouter }) {
  return (
    <DataProvider source={source}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </DataProvider>
  )
}
