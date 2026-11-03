import {
  closestCenter,
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type Announcements,
  type CollisionDetection,
  type DragEndEvent,
  type DragStartEvent,
  type KeyboardCoordinateGetter,
  type UniqueIdentifier,
} from '@dnd-kit/core'
import { useMemo, useState, type ReactNode } from 'react'
import { Link } from 'react-router'
import { defaultTimeZone, localDay, localDaysBetween, toMillis } from '../../engine/dates.ts'
import { followUpDue } from '../../engine/followups.ts'
import { APP_STATUSES, AWAITING_REPLY } from '../../engine/states.ts'
import type { AppStatus, Application } from '../../engine/types.ts'
import { useRepo, useRepoData } from '../../data/data-context.ts'
import { cx } from '../../ui/cx.ts'
import { EmptyState } from '../../ui/EmptyState.tsx'
import { PageHeader } from '../../ui/PageHeader.tsx'
import { Select } from '../../ui/Select.tsx'
import { Skeleton } from '../../ui/Skeleton.tsx'
import { APP_STATUS_DISPLAY } from '../../ui/status.ts'
import { buttonClass } from '../../ui/styles.ts'
import { useToast } from '../../ui/toast-context.ts'
import { formatDay } from '../jobs/format.ts'
import { GripIcon } from '../jobs/icons.tsx'
import { LoadProblem } from '../jobs/LoadProblem.tsx'
import { useNow } from '../jobs/useNow.ts'
import { allowedMoves, applyMove, moveProblem } from './moves.ts'

const COLUMNS: readonly AppStatus[] = APP_STATUSES

function label(status: AppStatus): string {
  return APP_STATUS_DISPLAY[status].label
}

function cardName(app: Pick<Application, 'company' | 'title'>): string {
  return `${app.company}, ${app.title}`
}

interface CardData {
  status: AppStatus
  name: string
}

/** Arrow keys move a picked-up card one column left or right; the card keeps its height on the page. */
const columnCoordinates: KeyboardCoordinateGetter = (event, { context, currentCoordinates }) => {
  const step = event.code === 'ArrowRight' ? 1 : event.code === 'ArrowLeft' ? -1 : 0
  const own = context.collisionRect
  if (step === 0 || !own) return undefined
  const from = (context.over?.id ?? (context.active?.data.current as CardData | undefined)?.status) as AppStatus | undefined
  const target = from ? COLUMNS[COLUMNS.indexOf(from) + step] : undefined
  const rect = target ? context.droppableRects.get(target) : undefined
  if (!rect) return undefined
  return { x: rect.left + (rect.width - own.width) / 2, y: currentCoordinates.y }
}

/** The column under the pointer, else the column under the card's center, else the nearest. */
const columnCollision: CollisionDetection = (args) => {
  const pointer = pointerWithin(args)
  if (pointer.length > 0) return pointer
  const center = args.collisionRect.left + args.collisionRect.width / 2
  const under = args.droppableContainers.filter((container) => {
    const rect = args.droppableRects.get(container.id)
    return rect !== undefined && center >= rect.left && center <= rect.right
  })
  return under.length > 0
    ? under.map((container) => ({ id: container.id, data: { droppableContainer: container, value: 0 } }))
    : closestCenter(args)
}

function lastActivity(app: Application): number {
  return Math.max(0, ...[app.appliedAt, ...app.history.map((entry) => entry.at)].map((at) => toMillis(at) ?? 0))
}

export function BoardPage() {
  const repo = useRepo()
  const toast = useToast()
  const now = useNow()
  const timeZone = defaultTimeZone()
  const applications = useRepoData('applications', (r) => r.listApplications())
  // Shows a move right away while the save and reload finish; ignored once newer data arrives.
  const [override, setOverride] = useState<{ base: Application[]; app: Application } | null>(null)
  const [active, setActive] = useState<Application | null>(null)
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: columnCoordinates }),
  )

  const apps = useMemo(() => {
    const data = applications.data ?? []
    return data.map((app) => (override && override.base === data && override.app.id === app.id ? override.app : app))
  }, [applications.data, override])

  const byStatus = useMemo(() => {
    const groups = new Map<AppStatus, Application[]>(COLUMNS.map((status) => [status, []]))
    for (const app of [...apps].sort((a, b) => lastActivity(b) - lastActivity(a))) groups.get(app.status)?.push(app)
    return groups
  }, [apps])

  async function move(app: Application, to: AppStatus) {
    if (to === app.status) return
    const result = applyMove(app, to, new Date().toISOString(), timeZone)
    if (!result.ok) {
      toast.show({ title: `Can't move to ${label(to)}`, description: result.reason, tone: 'danger' })
      return
    }
    if (applications.data) setOverride({ base: applications.data, app: result.app })
    try {
      await repo.saveApplication(result.app)
      toast.show({
        title: `Moved to ${label(to)}`,
        description: cardName(app),
        tone: 'success',
        action: { label: 'Undo', onAction: () => void repo.saveApplication(app) },
      })
    } catch (error) {
      setOverride(null)
      toast.show({ title: "Couldn't move it", description: error instanceof Error ? error.message : String(error), tone: 'danger' })
    }
  }

  function findApp(id: UniqueIdentifier): Application | undefined {
    return apps.find((app) => app.id === id)
  }

  function handleDragStart(event: DragStartEvent) {
    setActive(findApp(event.active.id) ?? null)
  }

  function handleDragEnd(event: DragEndEvent) {
    setActive(null)
    const app = findApp(event.active.id)
    if (app && event.over) void move(app, event.over.id as AppStatus)
  }

  const announcements: Announcements = {
    onDragStart: ({ active: item }) => {
      const data = item.data.current as CardData
      return `Picked up ${data.name}, in ${label(data.status)}. Use the left and right arrow keys to choose a column.`
    },
    onDragOver: ({ active: item, over }) => {
      const data = item.data.current as CardData
      if (!over) return `${data.name} is not over a column.`
      const problem = moveProblem(data.status, over.id as AppStatus)
      return problem ? `${label(over.id as AppStatus)}: not allowed. ${problem}` : `${data.name} is over ${label(over.id as AppStatus)}.`
    },
    onDragEnd: ({ active: item, over }) => {
      const data = item.data.current as CardData
      if (!over || over.id === data.status) return `${data.name} stays in ${label(data.status)}.`
      const problem = moveProblem(data.status, over.id as AppStatus)
      return problem
        ? `${data.name} can't move to ${label(over.id as AppStatus)}. ${problem}`
        : `Moved ${data.name} to ${label(over.id as AppStatus)}.`
    },
    onDragCancel: ({ active: item }) => {
      const data = item.data.current as CardData
      return `Move cancelled. ${data.name} stays in ${label(data.status)}.`
    },
  }

  const header = (
    <PageHeader
      title="Board"
      description="Every application by status. Drag a card by its handle, or focus the handle, press Space, and use the arrow keys."
    />
  )

  if (applications.error && !applications.data) {
    return (
      <>
        {header}
        <LoadProblem what="applications" error={applications.error} onRetry={applications.reload} />
      </>
    )
  }

  return (
    <>
      {header}
      {!applications.data ? (
        <BoardSkeleton />
      ) : apps.length === 0 ? (
        <EmptyState
          title="No applications yet"
          description="Start one from a job you like. It shows up here as a draft and moves along as you apply."
          action={
            <Link to="/jobs" className={buttonClass({ variant: 'primary' })}>
              Find a job
            </Link>
          }
        />
      ) : (
        <DndContext
          sensors={sensors}
          collisionDetection={columnCollision}
          onDragStart={handleDragStart}
          onDragEnd={handleDragEnd}
          onDragCancel={() => setActive(null)}
          accessibility={{
            announcements,
            screenReaderInstructions: {
              draggable:
                'To move this application, press Space or Enter, then the left and right arrow keys to choose a column. Press Space or Enter to drop it, or Escape to cancel.',
            },
          }}
        >
          <div className="overflow-x-auto pb-3" role="region" aria-label="Applications by status" tabIndex={0}>
            <div className="flex w-max items-stretch gap-3">
              {COLUMNS.map((status) => (
                <Column
                  key={status}
                  status={status}
                  apps={byStatus.get(status) ?? []}
                  active={active}
                  now={now}
                  timeZone={timeZone}
                  onMove={move}
                />
              ))}
            </div>
          </div>
          <DragOverlay dropAnimation={null}>{active ? <CardBody app={active} now={now} timeZone={timeZone} overlay /> : null}</DragOverlay>
        </DndContext>
      )}
    </>
  )
}

function Column({
  status,
  apps,
  active,
  now,
  timeZone,
  onMove,
}: {
  status: AppStatus
  apps: Application[]
  active: Application | null
  now: Date
  timeZone: string
  onMove: (app: Application, to: AppStatus) => void
}) {
  const { setNodeRef, isOver } = useDroppable({ id: status })
  const isSource = active?.status === status
  const blocked = active !== null && !isSource && moveProblem(active.status, status) !== null
  const allowed = active !== null && !isSource && !blocked
  const headingId = `board-column-${status}`

  return (
    <section
      ref={setNodeRef}
      data-board-column={status}
      aria-labelledby={headingId}
      className={cx(
        'flex w-[min(15rem,78vw)] shrink-0 flex-col rounded-lg border bg-surface-2/50 transition-colors',
        !active && 'border-line',
        isSource && 'border-line',
        allowed && (isOver ? 'border-fg bg-accent-soft' : 'border-dashed border-line-strong'),
        blocked && (isOver ? 'border-danger-ink bg-danger-soft' : 'border-line opacity-50'),
      )}
    >
      <header className="flex items-center justify-between gap-2 px-3 pt-3 pb-2">
        <h2 id={headingId} className="text-[0.8125rem] font-semibold text-fg">
          {label(status)}
        </h2>
        <span className="font-mono text-xs text-fg-subtle tabular-nums">{apps.length}</span>
      </header>
      {blocked && isOver ? <p className="px-3 pb-2 text-xs text-danger-ink">Not allowed from {label(active.status)}</p> : null}
      <ul className="flex min-h-24 flex-1 flex-col gap-2 px-2 pb-2">
        {apps.map((app) => (
          <DraggableCard key={app.id} app={app} now={now} timeZone={timeZone} onMove={onMove} />
        ))}
        {apps.length === 0 ? <li className="px-1 py-2 text-xs text-fg-subtle">None</li> : null}
      </ul>
    </section>
  )
}

function DraggableCard({
  app,
  now,
  timeZone,
  onMove,
}: {
  app: Application
  now: Date
  timeZone: string
  onMove: (app: Application, to: AppStatus) => void
}) {
  const data: CardData = { status: app.status, name: cardName(app) }
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, isDragging } = useDraggable({ id: app.id, data })
  return (
    <li ref={setNodeRef} className={cx(isDragging && 'opacity-40')}>
      <CardBody
        app={app}
        now={now}
        timeZone={timeZone}
        handle={
          <button
            ref={setActivatorNodeRef}
            type="button"
            aria-label={`Move ${cardName(app)}`}
            className="-ml-1 flex size-8 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-fg-subtle hover:bg-surface-2 hover:text-fg active:cursor-grabbing"
            {...attributes}
            {...listeners}
          >
            <GripIcon />
          </button>
        }
        statusControl={
          allowedMoves(app.status).length === 0 ? null : (
            <Select
              size="sm"
              aria-label={`Move ${cardName(app)} to another status`}
              value=""
              onChange={(event) => onMove(app, event.target.value as AppStatus)}
              className="w-36"
            >
              <option value="" disabled>
                Move to...
              </option>
              {allowedMoves(app.status).map((status) => (
                <option key={status} value={status}>
                  {label(status)}
                </option>
              ))}
            </Select>
          )
        }
      />
    </li>
  )
}

/** What the card says under the title: how long ago it went out, and the next follow-up or step. */
function cardNotes(app: Application, now: Date, timeZone: string): { text: string; urgent?: boolean }[] {
  const notes: { text: string; urgent?: boolean }[] = []
  if (app.appliedAt && toMillis(app.appliedAt) !== null) {
    const days = localDaysBetween(app.appliedAt, now, timeZone)
    notes.push({ text: days === 0 ? 'Applied today' : days === 1 ? 'Applied yesterday' : `Applied ${days} days ago` })
  } else if (app.status === 'draft' || app.status === 'prepared') {
    notes.push({ text: 'Not submitted yet' })
  }

  if (app.status === 'interview_scheduled') {
    const next = (app.interviews ?? [])
      .map((entry) => entry.at)
      .filter((at) => (toMillis(at) ?? 0) >= now.getTime())
      .sort()[0]
    if (next) notes.push({ text: `Interview ${formatDay(next, timeZone)}` })
  } else if (AWAITING_REPLY.includes(app.status)) {
    const due = app.followUp?.dueAt ?? followUpDue(app, timeZone)
    if (app.followUp?.sentAt) notes.push({ text: `Followed up ${formatDay(app.followUp.sentAt, timeZone)}` })
    else if (due && localDay(due, timeZone) < localDay(now, timeZone))
      notes.push({ text: `Follow-up overdue since ${formatDay(due, timeZone)}`, urgent: true })
    else if (due && localDay(due, timeZone) === localDay(now, timeZone)) notes.push({ text: 'Follow up today', urgent: true })
    else if (due) notes.push({ text: `Follow up ${formatDay(due, timeZone)}` })
  } else if (app.status === 'assessment_pending') {
    notes.push({ text: 'Assessment to complete', urgent: true })
  } else if (app.status === 'offer') {
    notes.push({ text: 'Reply to the offer', urgent: true })
  }
  return notes
}

function CardBody({
  app,
  now,
  timeZone,
  handle,
  statusControl,
  overlay = false,
}: {
  app: Application
  now: Date
  timeZone: string
  handle?: ReactNode
  statusControl?: ReactNode
  overlay?: boolean
}) {
  const notes = cardNotes(app, now, timeZone)
  const preparing = app.status === 'draft' || app.status === 'prepared'
  return (
    <article className={cx('rounded-md border border-line bg-surface p-2.5', overlay && 'shadow-pop ring-1 ring-fg')}>
      <div className="flex items-start gap-1.5">
        {handle ?? (
          <span className="-ml-1 flex size-8 shrink-0 items-center justify-center text-fg-subtle">
            <GripIcon />
          </span>
        )}
        <div className="min-w-0 flex-1 pt-1">
          <p className="text-[0.8125rem] font-semibold break-words text-fg">{app.company}</p>
          {overlay ? (
            <p className="text-[0.8125rem] break-words text-fg-muted">{app.title}</p>
          ) : (
            <Link
              to={`/jobs/${app.jobId}`}
              className="text-[0.8125rem] break-words text-fg-muted underline-offset-2 hover:text-fg hover:underline"
            >
              {app.title}
            </Link>
          )}
        </div>
      </div>
      {notes.length > 0 ? (
        <ul className="mt-2 space-y-0.5 text-xs">
          {notes.map((note) => (
            <li key={note.text} className={note.urgent ? 'font-medium text-warn-ink' : 'text-fg-muted'}>
              {note.text}
            </li>
          ))}
        </ul>
      ) : null}
      {!overlay ? (
        <div className="mt-2.5 flex flex-wrap items-center justify-between gap-2">
          {statusControl}
          {preparing ? (
            <Link to={`/apply/${app.id}`} className="text-xs font-medium text-fg underline underline-offset-2">
              Apply kit
            </Link>
          ) : null}
        </div>
      ) : null}
    </article>
  )
}

function BoardSkeleton() {
  return (
    <div aria-busy="true" className="flex gap-3 overflow-hidden">
      <span className="sr-only">Loading the board</span>
      {[3, 2, 1, 2].map((cards, index) => (
        <div key={index} className="w-[min(15rem,78vw)] shrink-0 space-y-2 rounded-lg border border-line p-2">
          <Skeleton className="mx-1 my-1.5 h-4 w-20" />
          {Array.from({ length: cards }, (_, card) => (
            <Skeleton key={card} className="h-24 w-full rounded-md" />
          ))}
        </div>
      ))}
    </div>
  )
}
