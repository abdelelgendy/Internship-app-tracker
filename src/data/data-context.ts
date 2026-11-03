import { createContext, useCallback, useContext, useEffect, useEffectEvent, useState } from 'react'
import type { DataMode } from './mode.ts'
import type { Repo } from './repo.ts'

export interface DataContextValue {
  mode: DataMode
  repo: Repo
  /** Goes up after every save and every reset, so views that read data load it again. */
  version: number
  /** Sample modes only. */
  resetSampleData?: () => Promise<void>
}

export const DataContext = createContext<DataContextValue | null>(null)

export function useData(): DataContextValue {
  const value = useContext(DataContext)
  if (!value) throw new Error('useData needs a <DataProvider> above it (App.tsx renders one).')
  return value
}

export function useRepo(): Repo {
  return useData().repo
}

export interface RepoData<T> {
  /** The last loaded value for this key. While a reload runs it keeps the previous value. */
  data: T | undefined
  error: Error | null
  loading: boolean
  reload: () => void
}

interface Loaded<T> {
  key: string
  request: string
  data: T | undefined
  error: Error | null
}

/**
 * Loads data from the repo and loads it again after any save. `key` names what is loaded,
 * including its parameters (for example `deck:${id}`); data loaded for another key is never
 * returned, so a page never shows the previous deck while the next one loads.
 *
 *   const { data: jobs, loading, error } = useRepoData('jobs', (repo) => repo.listJobs())
 */
export function useRepoData<T>(key: string, load: (repo: Repo) => Promise<T>): RepoData<T> {
  const { repo, version } = useData()
  const [reloads, setReloads] = useState(0)
  const [loaded, setLoaded] = useState<Loaded<T> | null>(null)
  const request = `${version}:${reloads}:${key}`
  const run = useEffectEvent(() => load(repo))

  useEffect(() => {
    let current = true
    run().then(
      (data) => {
        if (current) setLoaded({ key, request, data, error: null })
      },
      (error: unknown) => {
        if (!current) return
        setLoaded((previous) => ({
          key,
          request,
          data: previous?.key === key ? previous.data : undefined,
          error: error instanceof Error ? error : new Error(String(error)),
        }))
      },
    )
    return () => {
      current = false
    }
  }, [key, request])

  const reload = useCallback(() => setReloads((count) => count + 1), [])
  return {
    data: loaded?.key === key ? loaded.data : undefined,
    error: loaded?.request === request ? loaded.error : null,
    loading: loaded?.request !== request,
    reload,
  }
}
