/**
 * Rooms — named channels of same-configuration workers the orchestrator fans
 * tasks out to, OpenMausBot-style.
 *
 * A room has a roster of worker NAMES (not CLI types). Every dispatch spawns
 * one hidden child session per worker, all on the *current session's agent id
 * and model* — a room is a set of workers over one configuration, never a mix
 * of CLIs. The room itself is backed by a hidden channel session: its
 * transcript carries the seeded task, the orchestration cards, and the merged
 * reply, and it renders in the right rail's Rooms tab. Workers are children of
 * that channel, so killing it cancels the whole run.
 *
 * Rosters persist to localStorage; panels (one per worker of the latest run)
 * live in memory. Children are hidden from the workspace session lists.
 */

import { useSyncExternalStore } from 'react'
import { orchestrationApi, roomsApi, sessionsApi, type RoomRecord } from '@/lib/api'
import { addOptimisticUserMessage } from '@/lib/events'
import { getConversation, useStore } from '@/store'
import type { Session } from '@/types/session'

export type PanelStatus = 'working' | 'done' | 'failed' | 'blocked'

/** A standing member of a room: a named worker backed by a hidden session. */
export interface RoomWorker {
  name: string
  /** The hidden worker session created for this workspace, when spawned. */
  sessionId?: string
}

/** One worker of a room's latest run, tracked by its real child-session id. */
export interface RoomPanel {
  id: string
  name: string
  status: PanelStatus
}

export interface Room {
  id: string
  name: string
  /** Worker roster. Every dispatch fans out one same-config child per worker. */
  workers: RoomWorker[]
  /** The worker designated Chief of Staff — it leads the merge step. */
  chief?: string
  /** The hidden channel session carrying this room's transcript. */
  sessionId?: string
  /** Workers of the latest run, in request order. Empty until the first run. */
  panels: RoomPanel[]
}

const ROOMS_KEY = 'agentdeck-rooms'
const ACTIVE_KEY = 'agentdeck-rooms-active'
/** Fallback fan-out width for /orchestrator when no room is set up. */
const FALLBACK_WORKERS = 3

/**
 * Local rooms are a migration seed only: rooms created before backend sync
 * are pushed to the daemon once, then the server is the sole source of truth.
 */
function loadLocalSeed(): Room[] {
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(ROOMS_KEY) ?? '[]')
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter(
        (room): room is Room & { agents?: string[]; workers?: (RoomWorker | string)[] } =>
          typeof room === 'object' &&
          room !== null &&
          typeof (room as Room).id === 'string' &&
          typeof (room as Room).name === 'string',
      )
      .map((room) => ({
        ...room,
        // Migration: pre-worker rooms stored provider ids in `agents`; earlier
        // worker rooms stored plain name strings. Both become RoomWorker.
        workers: Array.isArray(room.workers)
          ? room.workers.map((worker) =>
              typeof worker === 'string' ? { name: worker } : worker,
            )
          : (room.agents ?? []).map((name) => ({ name })),
        panels: Array.isArray(room.panels) ? room.panels : [],
      }))
  } catch {
    return []
  }
}

let rooms: Room[] = loadLocalSeed()

let activeRoomId: string | null = (() => {
  try {
    const id = localStorage.getItem(ACTIVE_KEY)
    return id && rooms.some((room) => room.id === id) ? id : null
  } catch {
    return null
  }
})()

const listeners = new Set<() => void>()

/** Update the in-memory roster + mirror to localStorage (offline fallback). */
function setRooms(next: Room[]): void {
  rooms = next
  try {
    localStorage.setItem(
      ROOMS_KEY,
      JSON.stringify(rooms.map(({ panels, ...rest }) => ({ ...rest, panels: [] }))),
    )
  } catch {
    // Storage may be unavailable (private mode); memory still works.
  }
  emit()
}

function emit(): void {
  for (const listener of listeners) listener()
}

/** Strip volatile fields before persisting a room to the daemon. */
function toRecord(room: Room): RoomRecord {
  return {
    id: room.id,
    name: room.name,
    workers: room.workers,
    chief: room.chief ?? null,
    sessionId: room.sessionId ?? null,
  }
}

function fromRecord(record: RoomRecord): Room {
  const existing = rooms.find((room) => room.id === record.id)
  return {
    id: record.id,
    name: record.name,
    workers: Array.isArray(record.workers)
      ? record.workers.map((worker) =>
          typeof worker === 'string' ? { name: worker } : worker,
        )
      : [],
    chief: record.chief ?? undefined,
    sessionId: record.sessionId ?? undefined,
    // Keep this client's live run panels for its own renders.
    panels: existing?.panels ?? [],
  }
}

/**
 * Pull the daemon's roster and adopt it. Local-only rooms (created before
 * sync, or offline) are pushed up once; the merge is keyed by id, server
 * wins on conflict.
 */
export async function syncRooms(): Promise<void> {
  try {
    const serverRooms = await roomsApi.list()
    const serverIds = new Set(serverRooms.map((room) => recordIdOf(room)))
    const localOnly = rooms.filter((room) => !serverIds.has(room.id))
    for (const room of localOnly) {
      await roomsApi.create(toRecord(room)).catch(() => undefined)
    }
    const merged = [
      ...serverRooms.map((record) => fromRecord(record)),
      ...localOnly.map((room) => ({ ...room })),
    ]
    setRooms(merged)
    if (activeRoomId && !merged.some((room) => room.id === activeRoomId)) {
      activeRoomId = null
    }
    emit()
  } catch {
    // Daemon unreachable — keep the local roster; retry on next call.
  }
}

function recordIdOf(record: RoomRecord): string {
  return record.id
}

/** Called by the socket layer on RoomUpsert frames (any client's write). */
export function applyRoomUpsert(record: Record<string, unknown>): void {
  if (typeof record.id !== 'string' || typeof record.name !== 'string') return
  const typed = record as unknown as RoomRecord
  const merged = rooms.some((room) => room.id === typed.id)
    ? rooms.map((room) => (room.id === typed.id ? fromRecord(typed) : room))
    : [...rooms, fromRecord(typed)]
  setRooms(merged)
}

/** Called by the socket layer on RoomDeleted frames. */
export function applyRoomDeleted(roomId: string): void {
  setRooms(rooms.filter((room) => room.id !== roomId))
  if (activeRoomId === roomId) {
    activeRoomId = null
    try { localStorage.removeItem(ACTIVE_KEY) } catch { /* noop */ }
  }
  emit()
}

/** Push one room's state to the daemon (and thus to every other client). */
async function persistRoom(room: Room): Promise<void> {
  try {
    const record = await roomsApi.upsert(toRecord(room))
    setRooms(rooms.map((candidate) => (candidate.id === room.id ? fromRecord(record) : candidate)))
  } catch {
    // Offline: local state already updated; server catches up on next edit.
  }
}

export function subscribeRooms(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function getRooms(): Room[] {
  return rooms
}

/** React binding for the room roster. */
export function useRooms(): Room[] {
  return useSyncExternalStore(subscribeRooms, getRooms)
}

/** React binding for the active room's id (null when no room is active). */
export function useActiveRoomId(): string | null {
  return useSyncExternalStore(subscribeRooms, () => activeRoomId)
}

export function createRoom(name: string, workerNames: string[]): Room {
  const room: Room = {
    id: `room-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    name: name.trim() || `Room ${rooms.length + 1}`,
    workers: workerNames.map((name) => ({ name })),
    panels: [],
  }
  setRooms([...rooms, room])
  if (!activeRoomId) activeRoomId = room.id
  void persistRoom(room)
  return room
}

/**
 * Create a standing worker for the room: a hidden session in the workspace
 * (same agent + project as the context session) named after the worker.
 * Workers are real team members — individually openable, status-tracked —
 * and every room dispatch fans out one child per worker.
 */
export async function addWorkerToRoom(
  contextSessionId: string,
  roomId: string,
  workerName: string,
): Promise<RoomWorker> {
  const room = rooms.find((candidate) => candidate.id === roomId)
  if (!room) throw new Error('Room not found')
  const trimmed = workerName.trim()
  const existing = room.workers.find((worker) => worker.name === trimmed)
  if (existing?.sessionId) return existing
  if (!trimmed) throw new Error('Worker name is empty')

  const context = useStore.getState().sessions.find((s) => s.id === contextSessionId)
  const created = await sessionsApi.create({
    agent: context?.agent ?? 'claude',
    project: context?.project ?? undefined,
    name: `${room.name}/${trimmed}`,
    hidden: true,
  })
  const worker: RoomWorker = { name: trimmed, sessionId: created.id }
  const current = rooms.find((candidate) => candidate.id === roomId)
  if (!current) throw new Error('Room not found')
  updateRoom(roomId, {
    workers: current.workers.some((w) => w.name === trimmed)
      ? current.workers.map((w) => (w.name === trimmed ? worker : w))
      : [...current.workers, worker],
  })
  return worker
}

export function updateRoom(
  roomId: string,
  patch: Partial<Pick<Room, 'name' | 'workers' | 'chief' | 'sessionId' | 'panels'>>,
): void {
  const next = rooms.map((room) => (room.id === roomId ? { ...room, ...patch } : room))
  // Panel-only updates stay local (volatile run state); anything else syncs.
  const structural = 'name' in patch || 'workers' in patch || 'chief' in patch || 'sessionId' in patch
  if (structural) {
    const room = next.find((candidate) => candidate.id === roomId)
    if (room) {
      setRooms(next)
      void persistRoom(room)
      return
    }
  }
  setRooms(next)
}

export function deleteRoom(roomId: string): void {
  setRooms(rooms.filter((room) => room.id !== roomId))
  if (activeRoomId === roomId) activeRoomId = null
  void roomsApi.remove(roomId).catch(() => undefined)
}

/** The room the Rooms tab and /orchestrator target; null when none is active. */
export function getActiveRoom(): Room | null {
  return rooms.find((room) => room.id === activeRoomId) ?? null
}

export function setActiveRoom(roomId: string | null): void {
  activeRoomId = roomId
  try {
    if (activeRoomId) localStorage.setItem(ACTIVE_KEY, activeRoomId)
    else localStorage.removeItem(ACTIVE_KEY)
  } catch {
    // Storage may be unavailable; active room stays per-session.
  }
  emit()
}

function setRoomPanels(roomId: string, panels: RoomPanel[]): void {
  updateRoom(roomId, { panels })
}

/**
 * Register a session in the store so the router can open it. The daemon's
 * session LIST excludes `hidden` rows (room channels and workers), so after a
 * reload those sessions are absent even though they still exist — navigating
 * to them used to hit the stale-id redirect back to the dashboard. Fetch the
 * session directly, upsert it, and hydrate its transcript. Returns null when
 * the id no longer exists (a ghost left over from an older database).
 */
export async function ensureSessionLoaded(sessionId: string): Promise<Session | null> {
  const store = useStore.getState()
  const known = store.sessions.find((s) => s.id === sessionId)
  if (known) {
    void store.openSession(sessionId)
    return known
  }
  try {
    const session = await sessionsApi.get(sessionId)
    useStore.setState((state) => {
      const exists = state.sessions.some((s) => s.id === session.id)
      return {
        sessions: exists
          ? state.sessions.map((s) => (s.id === session.id ? session : s))
          : [...state.sessions, session],
      }
    })
    void useStore.getState().openSession(sessionId)
    return session
  } catch {
    return null
  }
}

/**
 * The channel session backing a room — created on first use as a hidden
 * session on the same agent/project as the context session, so it never
 * appears in the workspace lists and its children share its configuration.
 * An existing-but-unreachable channel (created against an older daemon
 * database, or still hidden from the session list after a reload) is dropped
 * and recreated so the room always opens somewhere real.
 */
export async function ensureRoomSession(contextSessionId: string, room: Room): Promise<string> {
  if (room.sessionId) {
    const registered = await ensureSessionLoaded(room.sessionId)
    if (registered) return room.sessionId
    // Ghost channel: forget it and rebuild below.
    updateRoom(room.id, { sessionId: undefined })
  }
  const context = useStore.getState().sessions.find((s) => s.id === contextSessionId)
  const created = await sessionsApi.create({
    agent: context?.agent ?? 'claude',
    project: context?.project ?? undefined,
    name: room.name,
    hidden: true,
  })
  updateRoom(room.id, { sessionId: created.id })
  await useStore.getState().openSession(created.id)
  return created.id
}

/** The model the context session currently runs at (live config, if reported). */
function currentModelId(sessionId: string): string | undefined {
  const config = useStore.getState().configs[sessionId]
  return config?.options.find((o) => o.id === 'model' || o.category === 'model')?.currentValue ?? undefined
}

/** Push the task into a transcript as a user message (no turn is started). */
function seedTask(sessionId: string, task: string): void {
  const conversation = getConversation(sessionId)
  addOptimisticUserMessage(conversation, task)
  useStore.setState((state) => ({
    revisions: { ...state.revisions, [sessionId]: (state.revisions[sessionId] ?? 0) + 1 },
  }))
}

async function orchestrate(
  parentSessionId: string,
  task: string,
  agent: string,
  workers: string[],
  options: { roomId?: string; roomName?: string; chief?: string; model?: string } = {},
): Promise<void> {
  try {
    const result = await orchestrationApi.run(parentSessionId, {
      prompt: task,
      agents: workers.map(() => agent),
      names: workers,
      merge_agent: agent,
      model: options.model,
      // Room identity: workers are prompted as team members, the chief (when
      // set) leads the merge, and the run is distilled into room memory.
      room:
        options.roomId && options.roomName
          ? { id: options.roomId, name: options.roomName, chief: options.chief }
          : undefined,
    })
    if (options.roomId) {
      setRoomPanels(
        options.roomId,
        result.children.map((child, index) => ({
          id: child.session_id,
          name: workers[index] ?? child.agent,
          status: panelStatusFromChild(child.status),
        })),
      )
    }
  } catch (error) {
    if (options.roomId) {
      const failed = workers.map((name) => ({ id: '', name, status: 'failed' as const }))
      setRoomPanels(options.roomId, failed)
    }
    useStore.setState((state) => ({
      notices: {
        ...state.notices,
        [parentSessionId]: error instanceof Error ? error.message : 'Orchestration failed',
      },
    }))
  }
}

/**
 * Dispatch a task to a room from `contextSessionId`: spawn the channel if
 * needed, seed the task onto its timeline, and fan out one same-config child
 * per worker. `only` narrows the run to the @-mentioned workers (by name);
 * with no mentions the whole roster runs. Fire-and-forget — progress streams
 * as orchestration WS events on the channel, and the panels fill in when the
 * run's JSON resolves. Resolves to the channel session id so callers can open
 * it and wait for the result.
 */
export async function runRoomTask(
  contextSessionId: string,
  room: Room,
  task: string,
  only?: string[],
): Promise<string | null> {
  const trimmed = task.trim()
  const targets = only && only.length > 0
    ? room.workers.filter((worker) => only.includes(worker.name))
    : room.workers
  if (!trimmed || targets.length === 0) return null
  const context = useStore.getState().sessions.find((s) => s.id === contextSessionId)
  const agent = context?.agent ?? 'claude'
  let channelId: string
  try {
    channelId = await ensureRoomSession(contextSessionId, room)
  } catch (error) {
    useStore.setState((state) => ({
      notices: {
        ...state.notices,
        [contextSessionId]: error instanceof Error ? error.message : 'Could not create the room channel',
      },
    }))
    return null
  }
  // Mentioned workers stay visible in the seeded message — that IS the
  // addressing; everyone reading the channel sees who was asked for what.
  seedTask(channelId, trimmed)
  const workerNames = targets.map((worker) => worker.name)
  setRoomPanels(
    room.id,
    workerNames.map((name) => ({ id: '', name, status: 'working' as const })),
  )
  void orchestrate(channelId, trimmed, agent, workerNames, {
    roomId: room.id,
    roomName: room.name,
    chief: room.chief,
    model: currentModelId(contextSessionId),
  })
  return channelId
}

/**
 * `#RoomName <task>` — first # token matching a known room (with workers)
 * routes the rest of the message to that room as a dispatch.
 */
export function findRoomMention(text: string): { room: Room; task: string } | null {
  const match = /^#(\S+)\s+([\s\S]+)$/.exec(text)
  if (!match) return null
  const needle = match[1].toLowerCase()
  const room = rooms.find((candidate) => candidate.name.toLowerCase() === needle)
  if (!room || room.workers.length === 0) return null
  return { room, task: match[2].trim() }
}

/**
 * Worker names @-mentioned in a room message ("hey @Scout @Maven look at
 * this"), matched case-insensitively against the roster.
 */
export function mentionedWorkers(text: string, workers: string[]): string[] {
  const mentioned = new Set<string>()
  for (const match of text.matchAll(/@([\w-]+)/g)) {
    const token = match[1].toLowerCase()
    const worker = workers.find((candidate) => candidate.toLowerCase() === token)
    if (worker) mentioned.add(worker)
  }
  return [...mentioned]
}

/**
 * The /orchestrator command: fan the task out on the current session's own
 * timeline. The active room's workers name the children; without a room, a
 * fixed-width fan-out of the same configuration runs instead. Returns an
 * error message for the caller to surface, or null when the run started.
 */
export function runOrchestrator(sessionId: string, task: string): string | null {
  const trimmed = task.trim()
  if (!trimmed) return 'Give /orchestrator a task — e.g. "/orchestrator refactor the auth module".'
  const session = useStore.getState().sessions.find((s) => s.id === sessionId)
  const agent = session?.agent ?? 'claude'
  const room = getActiveRoom()
  const workerNames = room && room.workers.length > 0 ? room.workers.map((worker) => worker.name) : []
  const names = workerNames.length > 0 ? workerNames : undefined
  const width = workerNames.length > 0 ? workerNames.length : FALLBACK_WORKERS
  seedTask(sessionId, trimmed)
  if (room && workerNames.length > 0) {
    setRoomPanels(
      room.id,
      workerNames.map((name) => ({ id: '', name, status: 'working' as const })),
    )
  }
  void orchestrate(sessionId, trimmed, agent, names ?? Array.from({ length: width }, (_, i) => `${agent}-${i + 1}`), {
    roomId: room && workerNames.length > 0 ? room.id : undefined,
    roomName: room && workerNames.length > 0 ? room.name : undefined,
    chief: room?.chief,
    model: currentModelId(sessionId),
  })
  return null
}

function panelStatusFromChild(status: string): PanelStatus {
  if (status === 'completed') return 'done'
  if (status === 'failed' || status === 'timeout' || status === 'cancelled') return 'failed'
  return 'working'
}

/**
 * Re-derive panel statuses from the session store. Children are real sessions
 * whose statuses update over WS; the run's final JSON is authoritative but
 * this keeps the dots honest while it is in flight. Safe to call often.
 */
export function refreshRoomPanels(): void {
  const sessions = useStore.getState().sessions
  let changed = false
  const next = rooms.map((room) => {
    if (room.panels.length === 0) return room
    let roomChanged = false
    const panels = room.panels.map((panel) => {
      if (!panel.id) return panel
      const status = statusFromSession(sessions.find((session) => session.id === panel.id))
      if (status === panel.status) return panel
      roomChanged = true
      return { ...panel, status }
    })
    if (!roomChanged) return room
    changed = true
    return { ...room, panels }
  })
  if (changed) {
    setRooms(next)
  }
}

function statusFromSession(session: Session | undefined): PanelStatus {
  if (!session) return 'failed'
  if (session.status === 'starting' || session.status === 'running' || session.status === 'resuming') {
    return 'working'
  }
  if (session.status === 'waiting_for_approval' || session.status === 'waiting_for_input') {
    // A hidden worker is blocked on a card — surfaced in the room channel,
    // where the user can decide. Orange, not gray: this is not "done".
    return 'blocked'
  }
  if (session.status === 'error') return 'failed'
  return 'done'
}
