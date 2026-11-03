import { useMemo, useState, type ReactNode } from 'react'
import { DataContext, type DataContextValue } from './data-context.ts'
import type { DataSource } from './mode.ts'
import { isWriteMethod, wrapRepo } from './repo.ts'

/** Gives pages the repo, the data mode, and a version that changes after every save. */
export function DataProvider({ source, children }: { source: DataSource; children: ReactNode }) {
  const [version, setVersion] = useState(0)

  const repo = useMemo(
    () =>
      wrapRepo(source.repo, async (name, call) => {
        const result = await call()
        if (isWriteMethod(name)) setVersion((current) => current + 1)
        return result
      }),
    [source.repo],
  )
  const reset = source.resetSampleData
  const resetSampleData = useMemo(
    () =>
      reset &&
      (async () => {
        await reset()
        setVersion((current) => current + 1)
      }),
    [reset],
  )

  const value = useMemo<DataContextValue>(
    () => ({ mode: source.mode, repo, version, resetSampleData }),
    [source.mode, repo, version, resetSampleData],
  )
  return <DataContext value={value}>{children}</DataContext>
}
