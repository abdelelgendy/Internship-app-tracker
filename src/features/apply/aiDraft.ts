import type { AiStatus, DraftCoverRequest } from '../../data/ai-middleware.ts'
import { LOCAL_API_BASE, LOCAL_API_HEADER } from '../../data/localApi.ts'
import type { Job, Profile } from '../../engine/types.ts'

/**
 * The page's side of "Draft with Claude". It only runs against the dev server (local mode); the
 * public demo never calls it. Paths match AI_BASE in src/data/ai-middleware.ts, which is not
 * imported here so the browser bundle never pulls in server code.
 */
const AI_PATH = `${LOCAL_API_BASE}/ai`

/**
 * Exactly what is sent: the posting and the approved facts, plus the style rules. Never the
 * name, email, phone, links, answers, authorization or application history.
 */
export function draftRequest(job: Pick<Job, 'company' | 'title' | 'jdText'>, profile: Profile): DraftCoverRequest {
  return {
    company: job.company,
    title: job.title,
    jdText: job.jdText ?? '',
    facts: profile.facts.map((fact) => ({ label: fact.label, value: fact.value })),
    style: {
      maxWords: profile.coverLetter.maxWords || 150,
      voiceNotes: profile.coverLetter.voiceNotes,
      bannedPhrases: profile.coverLetter.bannedPhrases,
    },
  }
}

async function call(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers)
  headers.set(LOCAL_API_HEADER, '1')
  return fetch(`${AI_PATH}/${path}`, { ...init, headers })
}

/** True when the dev server has an API key. Any failure (an older dev server, no key) means off. */
export async function fetchDraftAvailable(): Promise<boolean> {
  try {
    const response = await call('status')
    if (!response.ok) return false
    const status = (await response.json()) as Partial<AiStatus>
    return status.draftCover === true
  } catch {
    return false
  }
}

export async function requestCoverDraft(request: DraftCoverRequest): Promise<string> {
  const response = await call('draft-cover', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(request),
  })
  const body = (await response.json().catch(() => ({}))) as { draft?: unknown; error?: unknown }
  if (!response.ok || typeof body.draft !== 'string') {
    throw new Error(typeof body.error === 'string' ? body.error : `The draft request failed with status ${response.status}.`)
  }
  return body.draft
}
