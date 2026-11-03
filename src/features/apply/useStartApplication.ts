import { useState } from 'react'
import { useNavigate } from 'react-router'
import type { Application, Job } from '../../engine/types.ts'
import { useRepo } from '../../data/data-context.ts'
import { useToast } from '../../ui/toast-context.ts'
import { newApplication, openApplicationFor } from './applyModel.ts'

/**
 * "Start application": continues an open application for the job, or creates a draft, then
 * opens the apply kit. A queued job moves to shortlisted, since you chose it.
 */
export function useStartApplication() {
  const repo = useRepo()
  const navigate = useNavigate()
  const toast = useToast()
  const [startingId, setStartingId] = useState<string | null>(null)

  async function start(job: Job, applications: readonly Application[]) {
    const open = openApplicationFor(job.id, applications)
    if (open) {
      navigate(`/apply/${open.id}`)
      return
    }
    setStartingId(job.id)
    try {
      const at = new Date().toISOString()
      const app = newApplication(job, `app-${crypto.randomUUID()}`, at)
      await repo.saveApplication(app)
      if (job.status === 'queued') await repo.saveJob({ ...job, status: 'shortlisted' })
      navigate(`/apply/${app.id}`)
    } catch (error) {
      toast.show({
        title: "Couldn't start the application",
        description: error instanceof Error ? error.message : String(error),
        tone: 'danger',
      })
    } finally {
      setStartingId(null)
    }
  }

  return { start, startingId }
}
