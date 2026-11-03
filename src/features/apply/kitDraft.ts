import { useCallback, useState } from 'react'

/**
 * Work in progress in the apply kit that is not part of the application record yet: whether the
 * posting was opened, the answers you edited or marked as used, questions you added, and "no
 * cover letter". Kept in this browser's localStorage per application so a reload keeps it; it is
 * a convenience, so the kit works the same when storage is blocked.
 */
export interface KitDraft {
  opened: boolean
  answers: Record<string, { value: string; used: boolean }>
  custom: string[]
  noCover: boolean
}

const EMPTY: KitDraft = { opened: false, answers: {}, custom: [], noCover: false }
const VERSION = 1

function storageKey(applicationId: string): string {
  return `shortlist:apply-kit:v${VERSION}:${applicationId}`
}

function read(applicationId: string): KitDraft {
  try {
    const raw = localStorage.getItem(storageKey(applicationId))
    if (!raw) return EMPTY
    const parsed = JSON.parse(raw) as Partial<KitDraft>
    return {
      opened: parsed.opened === true,
      answers: parsed.answers && typeof parsed.answers === 'object' ? parsed.answers : {},
      custom: Array.isArray(parsed.custom) ? parsed.custom.filter((entry): entry is string => typeof entry === 'string') : [],
      noCover: parsed.noCover === true,
    }
  } catch {
    return EMPTY
  }
}

function write(applicationId: string, draft: KitDraft | null) {
  try {
    if (draft) localStorage.setItem(storageKey(applicationId), JSON.stringify(draft))
    else localStorage.removeItem(storageKey(applicationId))
  } catch {
    // Storage is blocked (private window, previews): the draft lasts until the page closes.
  }
}

export function useKitDraft(applicationId: string) {
  const [draft, setDraft] = useState(() => read(applicationId))

  const update = useCallback(
    (change: (current: KitDraft) => KitDraft) => {
      setDraft((current) => {
        const next = change(current)
        write(applicationId, next)
        return next
      })
    },
    [applicationId],
  )

  const clear = useCallback(() => {
    write(applicationId, null)
    setDraft(EMPTY)
  }, [applicationId])

  return { draft, update, clear }
}
