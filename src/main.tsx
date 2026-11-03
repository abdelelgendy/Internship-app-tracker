import '@fontsource-variable/atkinson-hyperlegible-next'
import '@fontsource-variable/atkinson-hyperlegible-mono'
import './index.css'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { createBrowserRouter } from 'react-router'
import App from './App.tsx'
import { createRoutes } from './app/routes.tsx'
import { openDataSource } from './data/mode.ts'

const root = document.getElementById('root')!

// The data source is chosen before the first render, so every page starts with the right
// banner and repo. It never throws for an unavailable store; it falls back to the demo.
openDataSource().then(
  (source) => {
    const router = createBrowserRouter(createRoutes(source.mode), { basename: import.meta.env.BASE_URL })
    createRoot(root).render(
      <StrictMode>
        <App source={source} router={router} />
      </StrictMode>,
    )
  },
  (error: unknown) => {
    console.error('[shortlist] Could not load any data:', error)
    root.textContent = "Shortlist couldn't load its data. Reload the page to try again."
  },
)
