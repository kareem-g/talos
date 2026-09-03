/**
 * RoomsSection — the Rooms block of the left sidebar, Grok-channel style.
 *
 * Each room reads as a chat channel: an avatar stack of its workers (the
 * roster is its face), a name, a one-line preview of the latest message, and
 * a live pulse while a run is in flight. Clicking a room opens its channel as
 * a NATIVE session chat in the center — from there you dispatch with
 * `/orchestrator`, @ a worker to narrow the run, or just talk to the lead —
 * and the merged result streams back into that chat. Run/expand/edit/delete
 * live on hover so rows stay clean at rest.
 */

import { useEffect, useState } from 'react'
import { Check, ChevronDown, Crown, Loader2, Plus, Trash2, Users, X, Zap } from 'lucide-react'
import { cn, relativeTime } from '@/lib/format'
import {
  type PanelStatus,
  type Room,
  type RoomWorker,
  addWorkerToRoom,
  createRoom,
  deleteRoom,
  ensureRoomSession,
  ensureSessionLoaded,
  refreshRoomPanels,
  runRoomTask,
  setActiveRoom,
  updateRoom,
  useActiveRoomId,
  useRooms,
} from '@/lib/rooms'
import { RoomAvatarStack, WorkerAvatar, nameHue } from './RoomAvatars'
import { getConversation, useStore } from '@/store'

export function RoomsSection({
  session,
  onSelect,
}: {
  session: { id: string; agent?: string; project?: string | null }
  onSelect: (sessionId: string) => void
}) {
  const rooms = useRooms()
  const sessions = useStore((s) => s.sessions)
  // Subscribe so previews refresh as room conversations stream.
  useStore((s) => s.revisions)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)

  // Panel dots track the child sessions' statuses, which arrive over WS.
  useEffect(() => {
    const unsubscribe = useStore.subscribe(refreshRoomPanels)
    return unsubscribe
  }, [])

  const lastActivity = (room: Room): string | null => {
    if (!room.sessionId) return null
    const channel = sessions.find((s) => s.id === room.sessionId)
    return channel ? relativeTime(channel.updated_at).replace(' ago', '') : null
  }

  const preview = (room: Room): string => {
    if (!room.sessionId) return room.workers.length > 0 ? `${room.workers.length} workers, ready` : 'No workers yet'
    const messages = getConversation(room.sessionId).messages
    for (let i = messages.length - 1; i >= 0; i--) {
      const text = messages[i].parts
        .filter((p) => p.kind === 'text')
        .map((p) => (p as { text: string }).text)
        .join(' ')
        .trim()
      if (text) return text
    }
    return room.workers.length > 0 ? `${room.workers.length} workers, ready` : 'No workers yet'
  }

  /**
   * Open a room as a native center chat: create its hidden channel session if
   * needed, then navigate there. `/orchestrator` and @-mentions typed in that
   * chat fan out through the room, and the merged reply lands in place.
   */
  const openRoom = async (room: Room): Promise<void> => {
    setActiveRoom(room.id)
    if (room.workers.length === 0) return
    try {
      const channelId = await ensureRoomSession(session.id, room)
      onSelect(channelId)
    } catch {
      /* session not creatable — the sidebar roster still works */
    }
  }

  /** Open a worker/child session: register it (it may be hidden) then route. */
  const openWorkerSession = async (id: string): Promise<void> => {
    if (!id) return
    try {
      const loaded = await ensureSessionLoaded(id)
      if (loaded) onSelect(id)
    } catch {
      /* session unreachable — keep the roster open */
    }
  }

  return (
    <div className="shrink-0 border-t border-white/[0.07]">
      <div className="flex items-center justify-between px-3 pb-1 pt-2">
        <p className="flex items-center gap-1.5 font-mono text-[10px] uppercase tracking-[0.12em] text-zinc-600">
          <Users size={11} className="text-zinc-500" />
          Rooms{rooms.length ? ` · ${rooms.length}` : ''}
        </p>
        <button
          type="button"
          onClick={() => setCreating(true)}
          title="New room"
          aria-label="New room"
          className="rounded-md p-1 text-zinc-500 transition hover:bg-white/[0.06] hover:text-zinc-200"
        >
          <Plus size={11} />
        </button>
      </div>

      <div className="scroll-thin max-h-[300px] overflow-y-auto px-2 pb-2">
        {rooms.length === 0 && !creating ? (
          <p className="px-2 pb-1 text-[10px] leading-relaxed text-zinc-600">
            Channels of workers that run tasks together. Try{' '}
            <span className="font-mono">/orchestrator</span> or{' '}
            <span className="font-mono">#RoomName</span> in the chat.
          </p>
        ) : null}
        {rooms.map((room) => (
          <RoomRow
            key={room.id}
            room={room}
            sessionId={session.id}
            time={lastActivity(room)}
            preview={preview(room)}
            expanded={expandedId === room.id}
            onToggle={() => setExpandedId(expandedId === room.id ? null : room.id)}
            onOpen={() => void openRoom(room)}
            onOpenSession={openWorkerSession}
          />
        ))}
        {creating ? (
          <RoomEditor
            onCancel={() => setCreating(false)}
            onSave={async (name, workers, chief) => {
              setCreating(false)
              await saveRoster(session.id, null, name, workers, chief)
            }}
          />
        ) : null}
      </div>
    </div>
  )
}

/** Persist a roster, creating hidden worker sessions for new members. */
export async function saveRoster(
  sessionId: string,
  room: Room | null,
  name: string,
  workerNames: string[],
  chief?: string,
): Promise<void> {
  try {
    if (!room) {
      const created = createRoom(name, workerNames)
      setActiveRoom(created.id)
      for (const workerName of workerNames) {
        await addWorkerToRoom(sessionId, created.id, workerName)
      }
      if (chief && workerNames.includes(chief)) updateRoom(created.id, { chief })
      return
    }
    const workers = room.workers
      .filter((worker) => workerNames.includes(worker.name))
      .map((worker) => ({ ...worker }))
    updateRoom(room.id, { name, workers })
    for (const workerName of workerNames) {
      if (!workers.some((worker) => worker.name === workerName)) {
        await addWorkerToRoom(sessionId, room.id, workerName)
      }
    }
    updateRoom(room.id, { chief: chief && workerNames.includes(chief) ? chief : undefined })
  } catch (error) {
    useStore.setState((state) => ({
      notices: {
        ...state.notices,
        [sessionId]: error instanceof Error ? error.message : 'Could not save the room',
      },
    }))
  }
}

function RoomRow({
  room,
  sessionId,
  time,
  preview,
  expanded,
  onToggle,
  onOpen,
  onOpenSession,
}: {
  room: Room
  sessionId: string
  time: string | null
  preview: string
  expanded: boolean
  onToggle: () => void
  onOpen: () => void
  /** Open an arbitrary (possibly hidden) worker/child session safely. */
  onOpenSession: (id: string) => void
}) {
  const activeRoomId = useActiveRoomId()
  const active = activeRoomId === room.id
  const sessions = useStore((s) => s.sessions)
  const [editing, setEditing] = useState(false)
  const [runningTask, setRunningTask] = useState(false)
  const [task, setTask] = useState('')
  const [addingWorker, setAddingWorker] = useState(false)
  const [newWorker, setNewWorker] = useState('')
  const [creatingWorker, setCreatingWorker] = useState(false)
  const hue = nameHue(room.name)
  const channelSession = room.sessionId ? sessions.find((s) => s.id === room.sessionId) : undefined
  const channelRunning =
    channelSession !== undefined &&
    ['running', 'starting', 'resuming'].includes(channelSession.status)
  const running = room.panels.some((panel) => panel.status === 'working') || channelRunning
  const activePanels = room.panels.filter((panel) => panel.status === 'working')
  const blockedPanels = room.panels.filter((panel) => panel.status === 'blocked')
  const panelStatuses: Record<string, PanelStatus> = Object.fromEntries(
    room.panels.map((panel) => [panel.name, panel.status]),
  )
  const workerNames = room.workers.map((worker) => worker.name)

  if (editing) {
    return (
      <RoomEditor
        initialName={room.name}
        initialWorkers={workerNames}
        initialChief={room.chief}
        onCancel={() => setEditing(false)}
        onSave={async (name, workers, chief) => {
          setEditing(false)
          await saveRoster(sessionId, room, name, workers, chief)
        }}
      />
    )
  }

  const dispatch = (text: string) => {
    // Run the task on the room channel, then take the user there so they see
    // the fan-out and wait for the merged result in the native chat.
    void runRoomTask(sessionId, room, text).then((channelId) => {
      if (channelId) onOpen()
    })
  }

  return (
    <div className="group/room relative mb-0.5 rounded-xl">
      {/* Channel row */}
      <button
        type="button"
        onClick={onOpen}
        aria-current={active ? 'true' : undefined}
        className={cn(
          'relative flex w-full items-start gap-2 rounded-xl py-1.5 pl-2 pr-16 text-left transition',
          active ? 'bg-white/[0.09] ring-1 ring-inset ring-white/10' : 'hover:bg-white/[0.05]',
        )}
      >
        {active ? (
          <span
            className="absolute left-0 top-1.5 bottom-1.5 w-[3px] rounded-full"
            style={{ backgroundColor: `hsl(${hue} 60% 55%)` }}
            aria-hidden
          />
        ) : null}
        <RoomAvatarStack
          names={workerNames}
          size={28}
          statuses={running ? panelStatuses : undefined}
        />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className={cn('min-w-0 flex-1 truncate text-[12px] font-semibold', active ? 'text-zinc-50' : 'text-zinc-200')}>
              {room.name}
            </span>
            {room.chief ? (
              <span className="flex shrink-0 items-center gap-0.5 rounded-full bg-amber-400/10 px-1.5 py-0.5 text-[9px] font-medium text-amber-300/90">
                <Crown size={8} /> {room.chief}
              </span>
            ) : null}
            {running ? (
              <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-emerald-400" aria-hidden />
            ) : (
              <span className="shrink-0 font-mono text-[9px] text-zinc-600">{time}</span>
            )}
          </span>
          <span
            className={cn(
              'mt-0.5 block truncate text-[10.5px] leading-[1.4]',
              active ? 'text-zinc-400' : 'text-zinc-500',
            )}
          >
            {preview}
          </span>
          {/* Presence line — who is actually on the task right now. */}
          {activePanels.length > 0 ? (
            <span className="mt-1 flex items-center gap-1">
              {activePanels.slice(0, 3).map((panel) => (
                <WorkerAvatar key={panel.name} name={panel.name} size={12} status="working" />
              ))}
              <span className="truncate font-mono text-[9px] text-emerald-300/90">
                {activePanels.length > 3
                  ? `${activePanels.slice(0, 3).map((panel) => panel.name).join(', ')} +${activePanels.length - 3}`
                  : activePanels.map((panel) => panel.name).join(', ')}
                {' '}working
              </span>
            </span>
          ) : blockedPanels.length > 0 ? (
            <span className="mt-1 flex items-center gap-1">
              {blockedPanels.slice(0, 2).map((panel) => (
                <WorkerAvatar key={panel.name} name={panel.name} size={12} status="blocked" />
              ))}
              <span className="truncate font-mono text-[9px] text-orange-300/90">
                {blockedPanels.map((panel) => panel.name).join(', ')} need{blockedPanels.length === 1 ? 's' : ''} review
              </span>
            </span>
          ) : channelRunning && activePanels.length === 0 ? (
            <span className="mt-1 flex items-center gap-1">
              <WorkerAvatar name={room.workers[0]?.name ?? 'channel'} size={12} status="working" />
              <span className="truncate font-mono text-[9px] text-emerald-300/90">running…</span>
            </span>
          ) : null}
        </span>
      </button>

      {/* Hover actions */}
      <div className="absolute right-1 top-1/2 hidden -translate-y-1/2 items-center gap-0.5 rounded-md bg-[#141417]/95 p-0.5 group-hover/room:flex">
        <button
          type="button"
          onClick={() => setRunningTask((v) => !v)}
          title="Run task in this room"
          aria-label={`Run task in ${room.name}`}
          className="rounded p-1 text-zinc-500 transition hover:text-emerald-400"
        >
          <Zap size={11} />
        </button>
        <button
          type="button"
          onClick={onToggle}
          title="Roster"
          aria-label={`Roster of ${room.name}`}
          aria-expanded={expanded}
          className="rounded p-1 text-zinc-500 transition hover:text-zinc-200"
        >
          <ChevronDown size={11} className={cn('transition-transform', !expanded && '-rotate-90')} />
        </button>
        <button
          type="button"
          onClick={() => setEditing(true)}
          title="Edit room"
          aria-label={`Edit ${room.name}`}
          className="rounded p-1 text-zinc-500 transition hover:text-zinc-200"
        >
          <Plus size={11} />
        </button>
        <button
          type="button"
          onClick={() => deleteRoom(room.id)}
          title="Delete room"
          aria-label={`Delete ${room.name}`}
          className="rounded p-1 text-zinc-500 transition hover:text-red-400"
        >
          <Trash2 size={10} />
        </button>
      </div>

      {/* Roster drawer */}
      {expanded ? (
        <div className="ml-3 mr-1 mt-0.5 rounded-lg border border-white/[0.05] bg-white/[0.02] p-1">
          {room.workers.length === 0 ? (
            <p className="px-2 py-1 text-[10px] text-zinc-600">
              No workers yet — open the editor (＋) to add team members.
            </p>
          ) : (
            room.workers.map((worker: RoomWorker) => {
              const panel = room.panels.find((p) => p.name === worker.name)
              const workerSession = worker.sessionId
                ? sessions.find((s) => s.id === worker.sessionId)
                : undefined
              const live =
                workerSession &&
                (workerSession.status === 'running' ||
                  workerSession.status === 'starting' ||
                  workerSession.status === 'resuming')
              const status: PanelStatus =
                panel?.status ?? (live ? 'working' : workerSession?.status === 'waiting_for_approval' ? 'blocked' : 'done')
              const isChief = room.chief === worker.name
              const linkId = worker.sessionId ?? panel?.id
              return (
                <div key={worker.name} className="flex items-center gap-2 rounded-md px-1.5 py-1">
                  <WorkerAvatar name={worker.name} size={20} status={status} ring />
                  <span
                    className={cn(
                      'min-w-0 flex-1 truncate text-[11px]',
                      isChief ? 'font-medium text-amber-200' : 'text-zinc-300',
                    )}
                  >
                    {worker.name}
                    {isChief ? <Crown size={9} className="ml-1 inline text-amber-300" /> : null}
                  </span>
                  <button
                    type="button"
                    onClick={() => updateRoom(room.id, { chief: isChief ? undefined : worker.name })}
                    title={isChief ? 'Remove Chief of Staff' : 'Make Chief of Staff'}
                    aria-label={
                      isChief
                        ? `Remove ${worker.name} as Chief of Staff`
                        : `Make ${worker.name} Chief of Staff`
                    }
                    className={cn(
                      'rounded p-0.5 transition',
                      isChief ? 'text-amber-300' : 'text-zinc-700 hover:text-amber-300',
                    )}
                  >
                    <Crown size={11} />
                  </button>
                  {linkId ? (
                    <button
                      type="button"
                      onClick={() => onOpenSession(linkId)}
                      title="Open worker session"
                      className="rounded p-0.5 font-mono text-[9px] text-zinc-600 hover:text-zinc-300"
                    >
                      open
                    </button>
                  ) : null}
                </div>
              )
            })
          )}
          {addingWorker ? (
            <form
              className="flex items-center gap-1 px-1.5 py-1"
              onSubmit={async (event) => {
                event.preventDefault()
                const name = newWorker.trim()
                if (!name || creatingWorker) return
                setCreatingWorker(true)
                await addWorkerToRoom(sessionId, room.id, name)
                setCreatingWorker(false)
                setNewWorker('')
                setAddingWorker(false)
              }}
            >
              <input
                autoFocus
                value={newWorker}
                onChange={(event) => setNewWorker(event.target.value)}
                placeholder="New worker name…"
                aria-label={`Add worker to ${room.name}`}
                className="h-6 min-w-0 flex-1 rounded-md border border-white/[0.08] bg-black/40 px-2 text-[10.5px] text-zinc-200 outline-none placeholder:text-zinc-600"
              />
              <button
                type="submit"
                disabled={!newWorker.trim() || creatingWorker}
                title="Create worker"
                aria-label="Create worker"
                className="rounded p-1 text-emerald-400 disabled:opacity-40"
              >
                {creatingWorker ? <Loader2 size={11} className="animate-spin" /> : <Check size={11} />}
              </button>
              <button
                type="button"
                onClick={() => {
                  setAddingWorker(false)
                  setNewWorker('')
                }}
                className="rounded p-1 text-zinc-600 hover:text-zinc-200"
                aria-label="Cancel adding worker"
              >
                <X size={11} />
              </button>
            </form>
          ) : (
            <button
              type="button"
              onClick={() => setAddingWorker(true)}
              className="flex w-full items-center gap-1.5 rounded-md px-1.5 py-1 text-[10px] text-zinc-500 transition hover:bg-white/[0.05] hover:text-zinc-200"
            >
              <Plus size={10} /> Add worker
            </button>
          )}
        </div>
      ) : null}

      {/* Inline dispatch */}
      {runningTask ? (
        <form
          className="mt-1 flex items-center gap-1 pr-1 pl-1.5"
          onSubmit={(event) => {
            event.preventDefault()
            if (!task.trim()) return
            dispatch(task)
            setTask('')
            setRunningTask(false)
          }}
        >
          <input
            autoFocus
            value={task}
            onChange={(event) => setTask(event.target.value)}
            placeholder={`Task for ${room.name}…`}
            aria-label={`Task for ${room.name}`}
            className="h-6 min-w-0 flex-1 rounded-md border border-white/[0.08] bg-black/40 px-2 text-[10.5px] text-zinc-200 outline-none placeholder:text-zinc-600"
          />
          <button
            type="submit"
            disabled={!task.trim() || room.workers.length === 0}
            title="Dispatch"
            aria-label="Dispatch task"
            className="rounded p-1 text-emerald-400 disabled:opacity-40"
          >
            <Zap size={11} />
          </button>
          <button
            type="button"
            onClick={() => setRunningTask(false)}
            aria-label="Cancel task"
            className="rounded p-1 text-zinc-600 hover:text-zinc-200"
          >
            <X size={11} />
          </button>
        </form>
      ) : null}
    </div>
  )
}

/** Create/edit form for a room: name + named worker roster + chief. */
function RoomEditor({
  initialName = '',
  initialWorkers = [],
  initialChief,
  onSave,
  onCancel,
}: {
  initialName?: string
  initialWorkers?: string[]
  initialChief?: string
  onSave: (name: string, workers: string[], chief?: string) => void
  onCancel: () => void
}) {
  const [name, setName] = useState(initialName)
  const [workers, setWorkers] = useState<string[]>(initialWorkers)
  const [chief, setChief] = useState<string | undefined>(initialChief)
  const [draft, setDraft] = useState('')

  const addWorker = () => {
    const trimmed = draft.trim()
    if (!trimmed || workers.includes(trimmed)) return
    setWorkers((current) => [...current, trimmed])
    setDraft('')
  }

  return (
    <form
      className="my-1 rounded-lg border border-white/[0.08] bg-white/[0.03] p-2"
      onSubmit={(event) => {
        event.preventDefault()
        if (!name.trim() || workers.length === 0) return
        onSave(name, workers, chief && workers.includes(chief) ? chief : undefined)
      }}
    >
      <div className="flex items-center gap-1.5">
        <input
          autoFocus
          value={name}
          onChange={(event) => setName(event.target.value)}
          placeholder="Room name"
          aria-label="Room name"
          className="h-6 min-w-0 flex-1 rounded-md border border-white/[0.08] bg-black/40 px-2 text-[11px] text-zinc-200 outline-none placeholder:text-zinc-600"
        />
        <button
          type="submit"
          disabled={!name.trim() || workers.length === 0}
          title="Save room"
          aria-label="Save room"
          className="rounded p-1 text-emerald-400 disabled:opacity-40"
        >
          <Check size={13} />
        </button>
        <button
          type="button"
          onClick={onCancel}
          aria-label="Cancel"
          className="rounded p-1 text-zinc-600 hover:text-zinc-200"
        >
          <X size={13} />
        </button>
      </div>
      <div className="mt-1.5 space-y-0.5">
        {workers.map((worker) => {
          const isChief = chief === worker
          return (
            <div key={worker} className="flex items-center gap-1.5 rounded px-1 py-0.5">
              <WorkerAvatar name={worker} size={16} />
              <span className={cn('min-w-0 flex-1 truncate text-[10.5px]', isChief ? 'text-amber-200' : 'text-zinc-300')}>
                {worker}
              </span>
              <button
                type="button"
                onClick={() => setChief(isChief ? undefined : worker)}
                title={isChief ? 'Remove Chief of Staff' : 'Make Chief of Staff'}
                aria-label={isChief ? `Remove ${worker} as Chief of Staff` : `Make ${worker} Chief of Staff`}
                className={cn('rounded p-0.5 transition', isChief ? 'text-amber-300' : 'text-zinc-700 hover:text-amber-300')}
              >
                <Crown size={11} />
              </button>
              <button
                type="button"
                onClick={() => {
                  setWorkers((current) => current.filter((w) => w !== worker))
                  if (chief === worker) setChief(undefined)
                }}
                title={`Remove ${worker}`}
                aria-label={`Remove ${worker}`}
                className="rounded p-0.5 text-zinc-600 hover:text-red-400"
              >
                <X size={10} />
              </button>
            </div>
          )
        })}
        <div className="flex items-center gap-1.5 px-1">
          <input
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault()
                addWorker()
              }
            }}
            placeholder="Add worker…"
            aria-label="Add worker"
            className="h-6 min-w-0 flex-1 rounded-md border border-white/[0.08] bg-black/40 px-2 text-[10.5px] text-zinc-200 outline-none placeholder:text-zinc-600"
          />
          <button
            type="button"
            onClick={addWorker}
            disabled={!draft.trim()}
            title="Add worker"
            aria-label="Add worker"
            className="rounded p-0.5 text-zinc-500 hover:text-zinc-200 disabled:opacity-40"
          >
            <Plus size={11} />
          </button>
        </div>
      </div>
      {workers.length === 0 ? (
        <p className="mt-1 text-[9.5px] text-zinc-600">
          Add at least one worker — each becomes a hidden session in this workspace.
        </p>
      ) : null}
    </form>
  )
}
