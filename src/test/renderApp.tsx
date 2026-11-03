import { render } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router'
import { createRoutes } from '../app/routes.tsx'
import { DataProvider } from '../data/DataProvider.tsx'
import type { DataMode, DataSource } from '../data/mode.ts'
import { ToastProvider } from '../ui/Toast.tsx'
import { sampleSource } from './sampleSource.ts'

/**
 * Renders the whole app at a path, with the same routes and providers as App.tsx. The data
 * defaults to a fresh in-memory copy of the sample data; `dataMode` only changes the banner.
 */
export function renderApp(path = '/today', dataMode?: DataMode, source: DataSource = sampleSource()) {
  const mode = dataMode ?? source.mode
  const router = createMemoryRouter(createRoutes(mode), { initialEntries: [path] })
  const view = render(
    <DataProvider source={{ ...source, mode }}>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </DataProvider>,
  )
  return { ...view, router }
}
