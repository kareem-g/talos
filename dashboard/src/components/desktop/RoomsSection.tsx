/**
 * RoomsSection — the Rooms channel block of the left sidebar.
 *
 * Each room reads as a chat channel: a large worker avatar stack (the roster
 * is its face), a name, a one-line preview of the latest message, and a live
 * pulse while a run is in flight. Clicking a room opens its channel as a
 * NATIVE session chat in the center — from there you dispatch with
 * `/orchestrator`, @ a worker to narrow the run, or just talk to the lead —
 * and the merged result streams back into that chat.
 *
 * Actions sit in a proper toolbar under each row (run, roster, edit, delete)
 * instead of tiny hover-only dots, so they are thumb-sized and discoverable.
 */

import { useEffect, useState } from 'react'
import { ChevronDown, Crown, Pencil, Plus, Trash2, Users, X, Zap } from 'lucide-react'
import { cn, relativeTime } from '@/lib/format'
import {
  type PanelStatus,
  type Room,
  type RoomWorker,
  addWorkerToRoom,
  backfillRoomProjects,
  createRoom,
  deleteRoom,
  ensureRoomSession,
  ensureSessionLoaded,
  normalizeWorker,
  refreshRoomPanels,
  roomInWorkspace,
  runRoomTask,
  roomOpenApproval,
  setActiveRoom,
  updateRoom,
  useActiveRoomId,
  useRooms,
  type NewWorkerDetails,
  type WorkerAvatarSpec,
} from '@/lib/rooms'
import { RoomAvatarStack, WorkerAvatar, nameHue } from './RoomAvatars'
import { RunTaskModal } from './RunTaskModal'
import { WorkerModal } from './WorkerModal'
import { getConversation, useStore } from '@/store'

export function RoomsSection({
  session,
  onSelect,
}: {
  session: { id: string; agent?: string; project?: string | null }
  onSelect: (sessionId: string) => void
}) {
  // Rooms belong to the workspace that created them — only those surface
  // here. Legacy rooms without a known workspace stay global. The project
  // falls back to the store row so a bare `{ id }` caller can't hide
  // everything.
  const sessions = useStore((s) => s.sessions)
  const project = session.project ?? sessions.find((s) => s.id === session.id)?.project ?? null
  const rooms = useRooms().filter((room) => roomInWorkspace(room, project))
  // Adopt workspaces for legacy rooms, then subscribe so previews refresh
  // as room conversations stream.
  useEffect(() => {
    backfillRoomProjects()
  }, [sessions])
  useStore((s) => s.revisions)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<Room | null>(null)

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
    if (!room.sessionId) return room.workers.length > 0 ? `${room.workers.length} workers · ready` : 'No workers yet'
    const messages = getConversation(room.sessionId).messages
    for (let i = messages.length - 1; i >= 0; i--) {
      const message = messages[i]
      // Lifecycle notices (engine switch, config change) aren't room chatter.
      if (message.role === 'system') continue
      const text = message.parts
        .filter((p) => p.kind === 'text')
        .map((p) => (p as { text: string }).text)
        .join(' ')
        .trim()
      if (text) return text
    }
    return room.workers.length > 0 ? `${room.workers.length} workers · ready` : 'No workers yet'
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
    <div className="shrink-0 border-b border-white/[0.07] bg-white/[0.015]">
      <div className="flex items-center gap-2 px-3 pb-1.5 pt-2.5">
        <Users size={13} className="shrink-0 text-zinc-400" />
        <p className="min-w-0 flex-1 text-[12px] font-semibold text-zinc-200">
          Rooms
          {rooms.length > 0 ? (
            <span className="ml-1.5 rounded-full bg-white/[0.07] px-1.5 py-px font-mono text-[10px] font-medium text-zinc-400">
              {rooms.length}
            </span>
          ) : null}
        </p>
        <button
          type="button"
          onClick={() => setCreating(true)}
          title="New room"
          className="flex shrink-0 items-center gap-1 rounded-lg bg-white/[0.06] px-2 py-1 text-[11px] font-medium text-zinc-200 transition hover:bg-white/[0.1] hover:text-white active:scale-[0.97]"
        >
          <Plus size={12} /> New
        </button>
      </div>

      <div className="scroll-thin max-h-[340px] overflow-y-auto px-2 pb-2">
        {rooms.length === 0 && !creating ? (
          <div className="rounded-xl border border-dashed border-white/[0.09] px-3 py-4 text-center">
            <p className="text-[11.5px] font-medium text-zinc-400">No rooms yet</p>
            <p className="mx-auto mt-1 max-w-[30ch] text-[10.5px] leading-relaxed text-zinc-600">
              Channels of workers that run tasks together. Try{' '}
              <span className="font-mono text-zinc-500">/orchestrator</span> in the chat.
            </p>
            <button
              type="button"
              onClick={() => setCreating(true)}
              className="mx-auto mt-2.5 flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[11px] font-semibold text-accent-ink transition hover:bg-accent-hover active:scale-[0.98]"
            >
              <Plus size={12} /> Create a room
            </button>
          </div>
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
            onDelete={(target) => setPendingDelete(target)}
          />
        ))}
        {creating ? (
          <RoomEditor
            title="New room"
            saveLabel="Create room"
            onCancel={() => setCreating(false)}
            onSave={async (name, workers, chief, skipPermissions) => {
              setCreating(false)
              await saveRoster(session.id, null, name, workers, chief, skipPermissions)
            }}
          />
        ) : null}
      </div>

      {/* Delete confirmation */}
      {pendingDelete ? (
        <DeleteRoomModal
          room={pendingDelete}
          onClose={() => setPendingDelete(null)}
          onConfirm={() => {
            deleteRoom(pendingDelete.id)
            setPendingDelete(null)
          }}
        />
      ) : null}
    </div>
  )
}

/** Confirm deleting a room. Worker sessions are kept — only the room is gone. */
function DeleteRoomModal({
  room,
  onClose,
  onConfirm,
}: {
  room: Room
  onClose: () => void
  onConfirm: () => void
}) {
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={`Delete ${room.name}`}>
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
      <div className="relative w-full max-w-xs overflow-hidden rounded-2xl border border-line/60 bg-surface p-5 shadow-overlay animate-sheet">
        <h2 className="text-[14px] font-semibold text-white">Delete room?</h2>
        <p className="mt-1.5 text-[12px] leading-relaxed text-zinc-400">
          <span className="font-medium text-zinc-200">{room.name}</span> and its roster
          {room.workers.length > 0 ? ` (${room.workers.length} worker${room.workers.length === 1 ? '' : 's'})` : ''} will
          be removed. Worker sessions are kept.
        </p>
        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="min-h-9 flex-1 rounded-xl border border-white/10 text-[12.5px] font-medium text-zinc-300 transition hover:bg-white/[0.05]"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            className="min-h-9 flex-1 rounded-xl bg-red-500/[0.15] text-[12.5px] font-semibold text-red-300 ring-1 ring-inset ring-red-500/30 transition hover:bg-red-500/[0.25] active:scale-[0.99]"
          >
            Delete
          </button>
        </div>
      </div>
    </div>
  )
}

/** Persist a roster, creating hidden worker sessions for new members. */
export async function saveRoster(
  sessionId: string,
  room: Room | null,
  name: string,
  workerInputs: Array<string | NewWorkerDetails>,
  chief?: string,
  skipPermissions?: boolean,
): Promise<void> {
  // Workers carry their customization (avatar, skills): brand-new names get
  // a session plus their details; kept names merge details onto the existing
  // worker so its standing session survives.
  const details: NewWorkerDetails[] = workerInputs.map((input) =>
    typeof input === 'string' ? { name: input } : input,
  )
  const names = details.map((d) => d.name.trim()).filter(Boolean)
  try {
    const contextProject = useStore.getState().sessions.find((s) => s.id === sessionId)?.project ?? null
    if (!room) {
      const created = createRoom(name, names, contextProject)
      setActiveRoom(created.id)
      for (const detail of details) {
        if (detail.name.trim()) await addWorkerToRoom(sessionId, created.id, detail)
      }
      if (chief && names.includes(chief)) updateRoom(created.id, { chief })
      if (skipPermissions !== undefined) updateRoom(created.id, { skipPermissions })
      return
    }
    const workers = details.flatMap((detail) => {
      const trimmed = detail.name.trim()
      if (!trimmed) return []
      const existing = room.workers.find((worker) => worker.name === trimmed)
      if (!existing) {
        return [
          normalizeWorker({
            name: trimmed,
            ...(detail.avatar ? { avatar: detail.avatar } : {}),
            ...(detail.skills?.length ? { skills: detail.skills } : {}),
          }),
        ]
      }
      const merged: RoomWorker = { ...existing }
      if (detail.avatar) merged.avatar = detail.avatar
      if (detail.skills !== undefined) {
        if (detail.skills.length > 0) merged.skills = detail.skills
        else delete merged.skills
      }
      return [merged]
    })
    updateRoom(room.id, {
      name,
      workers,
      // Adopt the workspace for legacy rooms that predate scoping.
      ...(room.project ? {} : contextProject ? { project: contextProject } : {}),
    })
    for (const detail of details) {
      const trimmed = detail.name.trim()
      if (!trimmed) continue
      const has = room.workers.some((worker) => worker.name === trimmed && worker.sessionId)
      if (!has) {
        await addWorkerToRoom(sessionId, room.id, detail)
      }
    }
    updateRoom(room.id, {
      chief: chief && names.includes(chief) ? chief : undefined,
      ...(skipPermissions !== undefined ? { skipPermissions } : {}),
    })
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
  onDelete,
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
  /** Ask for confirmation, then delete the room. */
  onDelete: (room: Room) => void
}) {
  const activeRoomId = useActiveRoomId()
  const active = activeRoomId === room.id
  const sessions = useStore((s) => s.sessions)
  const [editing, setEditing] = useState(false)
  const [taskModal, setTaskModal] = useState(false)
  const [workerModal, setWorkerModal] = useState(false)
  const [editingWorker, setEditingWorker] = useState<string | null>(null)
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
  // An open approval card anywhere on the channel or a worker timeline takes
  // over the presence line: one tap opens the session holding the card.
  const openApproval = roomOpenApproval(room)
  const avatarsByName = Object.fromEntries(
    room.workers.filter((worker) => worker.avatar).map((worker) => [worker.name, worker.avatar as WorkerAvatarSpec]),
  )

  if (editing) {
    return (
      <RoomEditor
        title={`Edit ${room.name}`}
        saveLabel="Save changes"
        initialName={room.name}
        initialWorkers={room.workers.map((w) => ({ name: w.name, avatar: w.avatar, skills: w.skills }))}
        initialChief={room.chief}
        initialSkip={room.skipPermissions ?? false}
        onCancel={() => setEditing(false)}
        onSave={async (name, workers, chief, skipPermissions) => {
          setEditing(false)
          await saveRoster(sessionId, room, name, workers, chief, skipPermissions)
        }}
      />
    )
  }

  const dispatch = (text: string, only?: string[], merge?: boolean) => {
    // Run the task on the room channel, then take the user there so they see
    // the fan-out and wait for the merged result in the native chat.
    void runRoomTask(sessionId, room, text, only, { merge }).then((channelId) => {
      if (channelId) onOpen()
    })
  }

  return (
    <div className="group/room relative mb-1 overflow-hidden rounded-xl border border-transparent transition-colors has-[>button[aria-current='true']]:border-white/[0.08] has-[>button[aria-current='true']]:bg-white/[0.05]">
      {/* Channel row — full-size channel button */}
      <button
        type="button"
        onClick={onOpen}
        aria-current={active ? 'true' : undefined}
        title={`Open ${room.name}`}
        className="relative flex w-full items-center gap-2.5 rounded-xl px-2 py-2 text-left transition-colors hover:bg-white/[0.05]"
      >
        {active ? (
          <span
            className="absolute bottom-2 left-0 top-2 w-[3px] rounded-full"
            style={{ backgroundColor: `hsl(${hue} 60% 55%)` }}
            aria-hidden
          />
        ) : null}
        <RoomAvatarStack
          names={workerNames}
          avatars={avatarsByName}
          size={36}
          statuses={running ? panelStatuses : undefined}
        />
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1.5">
            <span className={cn('min-w-0 flex-1 truncate text-[13px] font-semibold leading-tight', active ? 'text-zinc-50' : 'text-zinc-200')}>
              {room.name}
            </span>
            {running ? (
              <span className="flex shrink-0 items-center gap-1 rounded-full bg-emerald-400/10 px-1.5 py-px font-mono text-[9px] font-medium text-emerald-300" aria-hidden>
                <span className="size-1 animate-pulse rounded-full bg-emerald-400" /> live
              </span>
            ) : (
              <span className="shrink-0 font-mono text-[10px] tabular-nums text-zinc-600">{time}</span>
            )}
          </span>
          {room.chief ? (
            <span className="mt-0.5 flex items-center gap-1 text-[10px] font-medium text-accent/90">
              <Crown size={9} /> {room.chief} leads
            </span>
          ) : null}
          <span className={cn('mt-0.5 block truncate text-[11px] leading-[1.45]', active ? 'text-zinc-400' : 'text-zinc-500')}>
            {preview}
          </span>
          {/* Presence line — who is actually on the task right now. */}
          {activePanels.length > 0 ? (
            <span className="mt-1.5 flex items-center gap-1">
              {activePanels.slice(0, 4).map((panel) => (
                <WorkerAvatar key={panel.name} name={panel.name} avatar={avatarsByName[panel.name]} size={15} status="working" />
              ))}
              <span className="truncate font-mono text-[10px] text-emerald-300/90">
                {activePanels.length > 4
                  ? `${activePanels.slice(0, 4).map((panel) => panel.name).join(', ')} +${activePanels.length - 4}`
                  : activePanels.map((panel) => panel.name).join(', ')}
                {' '}working
              </span>
            </span>
          ) : blockedPanels.length > 0 ? (
            <span className="mt-1.5 flex items-center gap-1">
              {blockedPanels.slice(0, 3).map((panel) => (
                <WorkerAvatar key={panel.name} name={panel.name} avatar={avatarsByName[panel.name]} size={15} status="blocked" />
              ))}
              <span className="truncate font-mono text-[10px] text-orange/90">
                {blockedPanels.map((panel) => panel.name).join(', ')} need{blockedPanels.length === 1 ? 's' : ''} review
              </span>
            </span>
          ) : channelRunning && activePanels.length === 0 ? (
            <span className="mt-1.5 flex items-center gap-1">
              <WorkerAvatar name={room.workers[0]?.name ?? 'channel'} size={15} status="working" />
              <span className="truncate font-mono text-[10px] text-emerald-300/90">running…</span>
            </span>
          ) : null}
        </span>
      </button>

      {/* Open approval — one tap opens the session holding the card. Hidden
          sessions never appear in the workspace lists, so without this the
          card is unreachable. */}
      {openApproval ? (
        <div className="px-2 pb-1.5">
          <button
            type="button"
            onClick={() => onOpenSession(openApproval.sessionId)}
            className="flex w-full items-center gap-1.5 rounded-lg border border-orange/25 bg-orange-tint px-2 py-1.5 text-left transition hover:bg-orange-tint active:scale-[0.99]"
          >
            <span className="size-1.5 shrink-0 animate-pulse rounded-full bg-orange" aria-hidden />
            <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-orange">
              Needs review
            </span>
            <span className="shrink-0 font-mono text-[9.5px] uppercase tracking-wide text-orange/80">
              Review →
            </span>
          </button>
        </div>
      ) : null}

      {/* Action toolbar — real buttons, always reachable by keyboard */}
      <div className="flex items-center gap-1 px-2 pb-1.5">
        {room.skipPermissions ? (
          <span
            title="This room skips permission prompts — runs unattended"
            className="flex h-7 shrink-0 items-center gap-1 rounded-lg border border-accent/25 bg-accent/[0.07] px-2 font-mono text-[9.5px] font-medium uppercase tracking-wide text-accent-ink"
          >
            <Zap size={10} /> auto
          </span>
        ) : null}
        <button
          type="button"
          onClick={() => setTaskModal(true)}
          title={`Run task in ${room.name}`}
          aria-label={`Run task in ${room.name}`}
          className="flex h-7 flex-1 items-center justify-center gap-1.5 rounded-lg border border-white/[0.07] bg-white/[0.04] text-[11px] font-medium text-zinc-300 transition hover:bg-white/[0.08] hover:text-white active:scale-[0.98]"
        >
          <Zap size={12} /> Run task
        </button>
        <button
          type="button"
          onClick={onToggle}
          title="Roster"
          aria-label={`Roster of ${room.name}`}
          aria-expanded={expanded}
          className={cn(
            'flex h-7 items-center gap-1 rounded-lg border px-2 text-[11px] text-zinc-400 transition hover:bg-white/[0.06] hover:text-zinc-200',
            expanded ? 'border-white/[0.12] bg-white/[0.06] text-zinc-200' : 'border-white/[0.07] bg-white/[0.03]',
          )}
        >
          <Users size={12} />
          {room.workers.length}
          <ChevronDown size={11} className={cn('transition-transform', !expanded && '-rotate-90')} />
        </button>
        <button
          type="button"
          onClick={() => setEditing(true)}
          title={`Edit ${room.name}`}
          aria-label={`Edit ${room.name}`}
          className="flex size-7 items-center justify-center rounded-lg border border-white/[0.07] bg-white/[0.03] text-zinc-500 transition hover:bg-white/[0.06] hover:text-zinc-200"
        >
          <Pencil size={12} />
        </button>
        <button
          type="button"
          onClick={() => onDelete(room)}
          title={`Delete ${room.name}`}
          aria-label={`Delete ${room.name}`}
          className="flex size-7 items-center justify-center rounded-lg border border-transparent text-zinc-600 transition hover:border-red-500/20 hover:bg-red-500/10 hover:text-red-400"
        >
          <Trash2 size={12} />
        </button>
      </div>

      {/* Roster drawer */}
      {expanded ? (
        <div className="mx-2 mb-2 rounded-lg border border-white/[0.06] bg-black/30 p-1">
          {room.workers.length === 0 ? (
            <p className="px-2 py-1.5 text-[11px] text-zinc-600">
              No workers yet — edit the room to add team members.
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
              const skillCount = worker.skills?.length ?? 0
              return (
                <div key={worker.name} className="flex h-8 items-center gap-2 rounded-md px-1.5">
                  <WorkerAvatar name={worker.name} avatar={worker.avatar} size={22} status={status} ring />
                  <span
                    className={cn(
                      'min-w-0 flex-1 truncate text-[12px]',
                      isChief ? 'font-medium text-accent' : 'text-zinc-300',
                    )}
                    title={skillCount > 0 ? `Skills: ${worker.skills!.join(', ')}` : undefined}
                  >
                    {worker.name}
                    {isChief ? <Crown size={10} className="ml-1 inline text-accent" /> : null}
                  </span>
                  {skillCount > 0 ? (
                    <span
                      title={`Skills: ${worker.skills!.join(', ')}`}
                      className="shrink-0 rounded-full bg-purple-400/10 px-1.5 py-px font-mono text-[9px] font-medium text-purple-300"
                    >
                      {skillCount} skill{skillCount === 1 ? '' : 's'}
                    </span>
                  ) : null}
                  <button
                    type="button"
                    onClick={() => setEditingWorker(worker.name)}
                    title={`Edit ${worker.name}`}
                    aria-label={`Edit ${worker.name}`}
                    className="rounded p-1 text-zinc-600 transition hover:bg-white/[0.06] hover:text-zinc-200"
                  >
                    <Pencil size={12} />
                  </button>
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
                      'rounded p-1 transition',
                      isChief ? 'text-accent' : 'text-zinc-700 hover:text-accent',
                    )}
                  >
                    <Crown size={12} />
                  </button>
                  {linkId ? (
                    <button
                      type="button"
                      onClick={() => onOpenSession(linkId)}
                      title="Open worker session"
                      className="rounded px-1.5 py-0.5 font-mono text-[10px] text-zinc-600 hover:bg-white/[0.06] hover:text-zinc-300"
                    >
                      open
                    </button>
                  ) : null}
                </div>
              )
            })
          )}
          <button
            type="button"
            onClick={() => setWorkerModal(true)}
            className="flex h-8 w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-white/[0.1] text-[11.5px] font-medium text-zinc-400 transition hover:border-white/20 hover:bg-white/[0.04] hover:text-zinc-100 active:scale-[0.99]"
          >
            <Plus size={12} /> Add worker
          </button>
        </div>
      ) : null}

      {/* Run-task popup: task text + worker targets + merge */}
      {taskModal ? (
        <RunTaskModal
          room={room}
          onClose={() => setTaskModal(false)}
          onRun={(text, only, merge) => dispatch(text, only, merge)}
        />
      ) : null}

      {/* Worker creation popup */}
      {workerModal ? (
        <WorkerModal
          roomName={room.name}
          existingNames={workerNames}
          onClose={() => setWorkerModal(false)}
          onCreate={(details) => addWorkerToRoom(sessionId, room.id, details).then(() => undefined)}
        />
      ) : null}

      {/* Worker edit popup — avatar, name, and skills; the standing session is kept. */}
      {editingWorker ? (
        (() => {
          const target = room.workers.find((w) => w.name === editingWorker)
          if (!target) return null
          return (
            <WorkerModal
              roomName={room.name}
              existingNames={workerNames}
              initial={{ name: target.name, avatar: target.avatar, skills: target.skills }}
              title={`Edit ${target.name}`}
              saveLabel="Save worker"
              onClose={() => setEditingWorker(null)}
              onCreate={async (details) => {
                const trimmed = details.name.trim()
                updateRoom(room.id, {
                  workers: room.workers.map((w) => {
                    if (w.name !== target.name) return w
                    const next: RoomWorker = { ...w, name: trimmed }
                    if (details.avatar) next.avatar = details.avatar
                    if (details.skills && details.skills.length > 0) next.skills = details.skills
                    else delete next.skills
                    return next
                  }),
                  ...(room.chief === target.name && trimmed !== target.name ? { chief: trimmed } : {}),
                })
              }}
            />
          )
        })()
      ) : null}
    </div>
  )
}

/** Create/edit a room in a popup: name + worker roster + chief + permission skip. */
function RoomEditor({
  title,
  initialName = '',
  initialWorkers = [],
  initialChief,
  initialSkip = false,
  saveLabel,
  onSave,
  onCancel,
}: {
  title: string
  initialName?: string
  initialWorkers?: NewWorkerDetails[]
  initialChief?: string
  initialSkip?: boolean
  saveLabel: string
  onSave: (name: string, workers: NewWorkerDetails[], chief?: string, skipPermissions?: boolean) => void
  onCancel: () => void
}) {
  const [name, setName] = useState(initialName)
  const [workers, setWorkers] = useState<NewWorkerDetails[]>(initialWorkers)
  const [chief, setChief] = useState<string | undefined>(initialChief)
  const [skip, setSkip] = useState(initialSkip)
  const [addingWorker, setAddingWorker] = useState(false)
  const [editingWorker, setEditingWorker] = useState<string | null>(null)

  const workerNames = workers.map((w) => w.name)

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onCancel()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onCancel])

  const canSave = name.trim().length > 0 && workers.length > 0

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={title}>
      <button type="button" aria-label="Close" onClick={onCancel} className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
      <div className="relative flex max-h-[88vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-line/60 bg-surface shadow-overlay animate-sheet">
        <div className="flex shrink-0 items-center gap-2 border-b border-white/[0.08] px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2 className="text-[14px] font-semibold text-white">{title}</h2>
            <p className="font-mono text-[11px] text-zinc-500">Roster, lead & permissions</p>
          </div>
          <button
            type="button"
            onClick={onCancel}
            aria-label="Close"
            className="flex size-8 shrink-0 items-center justify-center rounded-lg text-zinc-500 transition hover:bg-white/[0.06] hover:text-zinc-200"
          >
            <X size={15} />
          </button>
        </div>
        <form
          className="scroll-thin min-h-0 flex-1 space-y-4 overflow-y-auto p-5"
          onSubmit={(event) => {
            event.preventDefault()
            if (!canSave) return
            onSave(name.trim(), workers, chief && workers.some((w) => w.name === chief) ? chief : undefined, skip)
          }}
        >
          <section>
            <label htmlFor="room-editor-name" className="mb-1.5 block font-mono text-[10.5px] font-medium uppercase tracking-[0.1em] text-zinc-400">
              Room name
            </label>
            <input
              id="room-editor-name"
              autoFocus
              value={name}
              onChange={(event) => setName(event.target.value)}
              placeholder="e.g. Code Crew"
              aria-label="Room name"
              className="h-9 w-full rounded-xl border border-white/10 bg-black/30 px-3 text-[13px] text-zinc-200 outline-none transition placeholder:text-zinc-600 focus:border-white/25"
            />
          </section>
      <section>
        <span className="mb-1.5 block font-mono text-[10.5px] font-medium uppercase tracking-[0.1em] text-zinc-400">
          Workers · {workers.length}
        </span>
        <div className="scroll-thin max-h-52 space-y-0.5 overflow-y-auto rounded-xl border border-white/[0.07] bg-black/20 p-1">
          {workers.map((worker) => {
            const isChief = chief === worker.name
            const skillCount = worker.skills?.length ?? 0
            return (
              <div key={worker.name} className="flex h-9 items-center gap-1.5 rounded-lg px-1.5 hover:bg-white/[0.03]">
                <WorkerAvatar name={worker.name} avatar={worker.avatar} size={22} />
                <span className="min-w-0 flex-1">
                  <span className={cn('block truncate text-[12.5px] leading-tight', isChief ? 'text-accent' : 'text-zinc-300')}>
                    {worker.name}
                  </span>
                  {skillCount > 0 ? (
                    <span className="block truncate font-mono text-[9.5px] leading-tight text-zinc-500">
                      {worker.skills!.join(', ')}
                    </span>
                  ) : null}
                </span>
                <button
                  type="button"
                  onClick={() => setEditingWorker(worker.name)}
                  title={`Customize ${worker.name}`}
                  aria-label={`Customize ${worker.name}`}
                  className="rounded p-1.5 text-zinc-600 transition hover:bg-white/[0.06] hover:text-zinc-200"
                >
                  <Pencil size={12} />
                </button>
                <button
                  type="button"
                  onClick={() => setChief(isChief ? undefined : worker.name)}
                  title={isChief ? 'Remove Chief of Staff' : 'Make Chief of Staff'}
                  aria-label={isChief ? `Remove ${worker.name} as Chief of Staff` : `Make ${worker.name} Chief of Staff`}
                  className={cn('rounded p-1.5 transition', isChief ? 'text-accent' : 'text-zinc-700 hover:text-accent')}
                >
                  <Crown size={12} />
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setWorkers((current) => current.filter((w) => w.name !== worker.name))
                    if (chief === worker.name) setChief(undefined)
                  }}
                  title={`Remove ${worker.name}`}
                  aria-label={`Remove ${worker.name}`}
                  className="rounded p-1.5 text-zinc-600 hover:text-red-400"
                >
                  <X size={11} />
                </button>
              </div>
            )
          })}
          {workers.length === 0 ? (
            <p className="px-2 py-3 text-center text-[11px] text-zinc-600">
              Add at least one worker — each becomes a hidden session in this workspace.
            </p>
          ) : null}
          <button
            type="button"
            onClick={() => setAddingWorker(true)}
            className="flex h-8 w-full items-center justify-center gap-1.5 rounded-lg border border-dashed border-white/[0.1] text-[11.5px] font-medium text-zinc-400 transition hover:border-white/20 hover:bg-white/[0.04] hover:text-zinc-100 active:scale-[0.99]"
          >
            <Plus size={12} /> Add worker — name, tile & skills
          </button>
        </div>
      </section>
      {addingWorker ? (
        <WorkerModal
          roomName={name.trim() || 'New room'}
          existingNames={workerNames}
          onClose={() => setAddingWorker(false)}
          onCreate={async (details) => {
            setWorkers((current) => [...current, details])
            setAddingWorker(false)
          }}
        />
      ) : null}
      {editingWorker ? (
        (() => {
          const target = workers.find((w) => w.name === editingWorker)
          if (!target) return null
          return (
            <WorkerModal
              roomName={name.trim() || 'New room'}
              existingNames={workerNames}
              initial={target}
              title={`Edit ${target.name}`}
              saveLabel="Save worker"
              onClose={() => setEditingWorker(null)}
              onCreate={async (details) => {
                setWorkers((current) =>
                  current.map((w) => (w.name === target.name ? details : w)),
                )
                if (chief === target.name && details.name.trim() !== target.name) {
                  setChief(details.name.trim())
                }
                setEditingWorker(null)
              }}
            />
          )
        })()
      ) : null}
      <section>
        <button
          type="button"
          role="switch"
          aria-checked={skip}
          aria-label="Skip permission prompts for this room's runs"
          onClick={() => setSkip((v) => !v)}
          className="flex w-full items-center gap-2.5 rounded-xl border border-white/[0.07] bg-black/20 px-3 py-2.5 text-left transition hover:bg-white/[0.04]"
        >
          <span
            aria-hidden
            className={cn(
              'relative h-4 w-7 shrink-0 rounded-full transition-colors duration-150',
              skip ? 'bg-accent' : 'bg-zinc-700',
            )}
          >
            <span
              className={cn(
                'absolute top-0.5 size-3 rounded-full bg-white transition-all duration-150',
                skip ? 'left-3.5' : 'left-0.5',
              )}
            />
          </span>
          <span className="min-w-0 flex-1">
            <span className="block text-[12px] font-medium text-zinc-200">Skip permission prompts</span>
            <span className="block text-[10.5px] leading-snug text-zinc-500">
              Workers run auto-approved, policy checks off — unattended runs.
            </span>
          </span>
        </button>
      </section>
        </form>
        <div className="flex shrink-0 gap-2 border-t border-white/[0.08] px-5 py-3.5">
          <button
            type="button"
            onClick={onCancel}
            className="min-h-10 flex-1 rounded-xl border border-white/10 text-[12.5px] font-medium text-zinc-300 transition hover:bg-white/[0.05]"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!canSave}
            onClick={() => {
              if (!canSave) return
              onSave(name.trim(), workers, chief && workers.some((w) => w.name === chief) ? chief : undefined, skip)
            }}
            className="min-h-10 flex-1 rounded-xl bg-accent text-[12.5px] font-semibold text-accent-ink transition hover:bg-accent-hover active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40"
          >
            {saveLabel}
          </button>
        </div>
      </div>
    </div>
  )
}
