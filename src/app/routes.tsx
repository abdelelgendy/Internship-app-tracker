import type { ComponentType } from 'react'
import { Navigate, type RouteObject } from 'react-router'
import { AppShell } from './AppShell.tsx'
import type { DataMode } from '../data/mode.ts'
import { NotFoundPage } from './NotFoundPage.tsx'
import { PageSkeleton } from './PageSkeleton.tsx'
import { RouteError } from './RouteError.tsx'

/** Each page's code loads when it is first opened; the skeleton holds its place meanwhile. */
function page(path: string, load: () => Promise<ComponentType>): RouteObject {
  return { path, lazy: async () => ({ Component: await load() }), HydrateFallback: PageSkeleton }
}

export function createRoutes(dataMode: DataMode): RouteObject[] {
  return [
    {
      element: <AppShell dataMode={dataMode} />,
      errorElement: <RouteError />,
      children: [
        {
          // A second boundary inside the shell, so a broken page keeps the navigation around it.
          errorElement: <RouteError />,
          children: [
            { index: true, element: <Navigate to="/today" replace /> },
            page('today', () => import('../features/today/TodayPage.tsx').then((m) => m.TodayPage)),
            page('jobs', () => import('../features/jobs/JobsPage.tsx').then((m) => m.JobsPage)),
            page('jobs/:id', () => import('../features/jobs/JobDetailPage.tsx').then((m) => m.JobDetailPage)),
            page('board', () => import('../features/board/BoardPage.tsx').then((m) => m.BoardPage)),
            page('apply/:applicationId', () => import('../features/apply/ApplyPage.tsx').then((m) => m.ApplyPage)),
            page('practice', () => import('../features/practice/PracticePage.tsx').then((m) => m.PracticePage)),
            page('practice/:deckId', () => import('../features/practice/DeckPage.tsx').then((m) => m.DeckPage)),
            page('insights', () => import('../features/insights/InsightsPage.tsx').then((m) => m.InsightsPage)),
            page('profile', () => import('../features/profile/ProfilePage.tsx').then((m) => m.ProfilePage)),
            page('import', () => import('../features/import/ImportPage.tsx').then((m) => m.ImportPage)),
            page('settings', () => import('../features/settings/SettingsPage.tsx').then((m) => m.SettingsPage)),
            { path: '*', element: <NotFoundPage /> },
          ],
        },
      ],
    },
  ]
}
