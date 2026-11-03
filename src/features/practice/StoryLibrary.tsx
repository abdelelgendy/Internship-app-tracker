import { useDeferredValue, useState } from 'react'
import { Link } from 'react-router'
import type { StarStory } from '@/engine/types.ts'
import { Badge } from '@/ui/Badge.tsx'
import { EmptyState } from '@/ui/EmptyState.tsx'
import { ChevronDownIcon } from '@/ui/icons.tsx'
import { Input } from '@/ui/Input.tsx'
import { plural } from './labels.ts'

const STAR: readonly { key: keyof Pick<StarStory, 'situation' | 'task' | 'action' | 'result'>; label: string }[] = [
  { key: 'situation', label: 'Situation' },
  { key: 'task', label: 'Task' },
  { key: 'action', label: 'Action' },
  { key: 'result', label: 'Result' },
]

/** Stories whose title, skills, questions or text contain every word of the query. */
function filterStories(stories: readonly StarStory[], query: string): StarStory[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean)
  if (words.length === 0) return [...stories]
  return stories.filter((story) => {
    const haystack = [story.title, story.situation, story.task, story.action, story.result, ...story.skills, ...story.questions]
      .join(' ')
      .toLowerCase()
    return words.every((word) => haystack.includes(word))
  })
}

export function StoryLibrary({ stories }: { stories: StarStory[] }) {
  const [query, setQuery] = useState('')
  const deferred = useDeferredValue(query)

  if (stories.length === 0) {
    return (
      <EmptyState
        title="No stories yet"
        description="STAR stories are true answers to behavioral questions: the situation, your task, what you did and how it ended. Import them from your job-hunter folder."
        action={
          <Link to="/import" className="text-sm font-medium text-fg underline underline-offset-2">
            Go to Import
          </Link>
        }
      />
    )
  }

  const shown = filterStories(stories, deferred)
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2">
        <Input
          type="search"
          aria-label="Search stories"
          placeholder="Search by skill, question or word"
          className="max-w-sm"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
        />
        <p className="text-[0.8125rem] text-fg-muted" aria-live="polite">
          {shown.length === stories.length ? plural(stories.length, 'story', 'stories') : `${shown.length} of ${stories.length} stories`}
        </p>
      </div>
      {shown.length === 0 ? (
        <EmptyState title="No story matches" description="Try one word, such as a skill or a word from the question." />
      ) : (
        <ul className="space-y-2">
          {shown.map((story) => (
            <li key={story.id}>
              <details className="group rounded-lg border border-line bg-surface open:border-line-strong">
                <summary className="relative flex cursor-pointer list-none flex-wrap items-baseline gap-x-3 gap-y-1.5 py-3 pr-10 pl-4 select-none">
                  <ChevronDownIcon className="absolute top-3.5 right-3.5 size-4 text-fg-subtle transition-transform group-open:rotate-180 motion-reduce:transition-none" />
                  <span className="min-w-0 font-medium break-words text-fg">{story.title}</span>
                  <span className="flex flex-wrap gap-1">
                    {story.skills.map((skill) => (
                      <Badge key={skill}>{skill}</Badge>
                    ))}
                  </span>
                </summary>
                <div className="border-t border-line px-4 py-4">
                  <dl className="space-y-3">
                    {STAR.map((part) => (
                      <div key={part.key} className="grid gap-1 sm:grid-cols-[6rem_minmax(0,1fr)]">
                        <dt className="text-xs font-semibold tracking-wide text-fg-muted uppercase">{part.label}</dt>
                        <dd className="break-words whitespace-pre-line text-fg">{story[part.key]}</dd>
                      </div>
                    ))}
                  </dl>
                  {story.questions.length > 0 ? (
                    <div className="mt-4">
                      <h4 className="text-xs font-semibold tracking-wide text-fg-muted uppercase">Answers questions like</h4>
                      <ul className="mt-1.5 list-disc space-y-0.5 pl-5 text-fg">
                        {story.questions.map((question) => (
                          <li key={question} className="break-words">
                            {question}
                          </li>
                        ))}
                      </ul>
                    </div>
                  ) : null}
                  <p className="mt-4 text-xs text-fg-muted">
                    Source: <span className="font-mono break-all text-fg">{story.source}</span>
                  </p>
                </div>
              </details>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
