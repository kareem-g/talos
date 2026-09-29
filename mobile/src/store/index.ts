/**
 * Application store (React Native).
 *
 * A port of the web `store/index.ts` built on the same invariant: an incoming
 * token must not re-render the whole app. Conversations live in a plain `Map`
 * outside zustand, mutated in place by the shared `@/lib/events` reducer; a
 * per-session `revisions` counter is what signals React, so only components
 * subscribed to that session re-render.
 *
 * What differs from the web store is the data source: this loads through the
 * authenticated `/api/mobile/*` surface (snapshot, per-session detail) rather
 * than the desktop `/api/*`, and persists prefs to MMKV instead of localStorage.
 * The frame-routing logic (`handleFrame`) is ported verbatim — it is pure and
 * platform-neutral, and keeping it identical means the mobile timeline behaves
 * exactly like the desktop one.
 */

import { create } from 'zustand'
import {
  addOptimisticUserMessage,
  appendTerminal,
  applyAgentEvent,
  applyMessage,
  sealConversation,
} from '@/lib/events'
import { readableAgentError } from '@/lib/errors'
import {
  emptyConversation,
  type AttachmentRef,
  type Conversation,
  type QueuedMessage,
} from '@/types/conversation'
import type { ApprovalMeta, ConnectionState, IncomingFrame } from '@/types/protocol'
import type { SessionConfig } from '@/types/provider'
import type { Session, SessionStatus } from '@/types/session'
import { mobileApi, type MobileTask } from '../lib/api'
import { socket } from '../lib/socket'
import { storage } from '../lib/storage'

/** Conversations, keyed by session id. Mutated in place; see the module docs. */
const conversations = new Map<string, Conversation>()

export function getConversation(sessionId: string): Conversation {
  let conversation = conversations.get(sessionId)
  if (!conversation) {
    conversation = emptyConversation(sessionId)
    conversations.set(sessionId, conversation)
  }
  return conversation
}

/** Subscribe to one session's conversation. Re-renders only on its own changes. */
export function useConversation(sessionId: string): Conversation {
  useStore((state) => state.revisions[sessionId] ?? 0)
  return getConversation(sessionId)
}

/** Append attached-file paths to a prompt so the agent can read them. */
export function withAttachmentBlock(text: string, attachments: AttachmentRef[]): string {
  if (attachments.length === 0) return text
  const lines = attachments.map(
    (a) => `- ${a.path} (${a.fileName}${a.contentType ? `, ${a.contentType}` : ''})`,
  )
  const block = `<attached_files>\n${lines.join('\n')}\n</attached_files>`
  return text.trim() ? `${text.trim()}\n\n${block}` : block
}

/** A runnable agent, as the mobile snapshot/agents endpoint reports it. */
export interface MobileAgent {
  id: string
  name: string
  available: boolean
  protocol?: string
  models?: unknown
  reasoningLevels?: unknown
  capabilities?: Record<string, boolean>
  [key: string]: unknown
}

const STARRED_KEY = 'agentdeck-starred'

/** Map a mobile snapshot task onto the shared `Session` row shape. */
function taskToSession(task: MobileTask): Session {
  return {
    id: task.id,
    name: task.name || task.title || 'Session',
    agent: task.agent,
    project: task.project ?? null,
    branch: task.branch ?? null,
    status: (task.status as SessionStatus) ?? 'idle',
    worktree_path: null,
    created_at: task.created_at,
    updated_at: task.updated_at,
    cost: task.cost ?? null,
    tokens_used: task.tokens_used ?? null,
    resume_command: null,
    parent_id: task.parent_id ?? null,
  }
}

interface StoreState {
  connection: ConnectionState
  sessions: Session[]
  sessionsLoading: boolean
  agents: MobileAgent[]
  desktopName: string
  configs: Record<string, SessionConfig>
  /** Per-session re-render counter; see the module docs. */
  revisions: Record<string, number>
  notices: Record<string, string | undefined>
  queues: Record<string, QueuedMessage[]>
  starred: string[]

  start: () => void
  loadSnapshot: () => Promise<void>
  openSession: (sessionId: string) => Promise<void>
  createSession: (input: {
    agent: string
    project?: string
    prompt?: string
    name?: string
    model?: string
    thought?: string
  }) => Promise<Session | undefined>
  /** Change a live session dimension (model, permission mode, thought, …). */
  setConfig: (sessionId: string, configId: string, value: string) => void
  sendPrompt: (sessionId: string, text: string, attachments?: AttachmentRef[]) => void
  queueMessage: (sessionId: string, text: string, attachments?: AttachmentRef[]) => void
  removeQueued: (sessionId: string, id: string) => void
  steerQueued: (sessionId: string, id: string) => void
  flushQueue: (sessionId: string) => void
  respondToApproval: (
    sessionId: string,
    requestId: string,
    decision: string,
    meta?: ApprovalMeta,
  ) => void
  answerQuestion: (questionId: string, selectedOptions: string[], customText?: string) => void
  stopSession: (sessionId: string) => Promise<void>
  interruptSession: (sessionId: string) => void
  ensureSessionRow: (sessionId: string) => Promise<void>
  dismissNotice: (sessionId: string) => void
  toggleStar: (sessionId: string) => void
  isStarred: (sessionId: string) => boolean
  removeSession: (sessionId: string) => Promise<boolean>
  resumeSession: (sessionId: string) => Promise<boolean>
  forkSession: (sessionId: string) => Promise<Session | undefined>
  archiveSession: (sessionId: string, restore?: boolean) => Promise<boolean>
  switchEngine: (sessionId: string, agent: string, model?: string) => Promise<boolean>
  pendingActions: import('../lib/api').PendingAction[]
  loadPending: () => Promise<void>
  theme: 'dark' | 'midnight' | 'oled'
  setTheme: (theme: 'dark' | 'midnight' | 'oled') => void
}

export const useStore = create<StoreState>((set, get) => ({
  connection: 'idle',
  sessions: [],
  sessionsLoading: false,
  agents: [],
  desktopName: 'Desktop',
  configs: {},
  revisions: {},
  notices: {},
  queues: {},
  starred: storage.getJSON<string[]>(STARRED_KEY) ?? [],
  pendingActions: [],
  theme: (storage.getString('agentdeck-theme') as 'dark' | 'midnight' | 'oled') || 'dark',

  /** Connect the socket and wire frames into the store. Idempotent. */
  start() {
    let previous: ConnectionState = 'idle'
    socket.onState((connection) => {
      const wasOffline =
        previous === 'reconnecting' ||
        previous === 'disconnected' ||
        previous === 'offline' ||
        previous === 'error'
      previous = connection
      set({ connection })
      // After an interruption, Session rows may have changed while we were away
      // (status, new sessions); replay covers events but not the row list.
      if (connection === 'connected' && wasOffline) void get().loadSnapshot()
    })
    socket.onFrame((frame) => handleFrame(frame, set, get))
    socket.connect()
    void get().loadSnapshot()
  },

  async loadSnapshot() {
    set({ sessionsLoading: true })
    try {
      const snapshot = await mobileApi.snapshot()
      const sessions: Session[] = []
      for (const workspace of snapshot.workspaces) {
        for (const task of workspace.tasks) sessions.push(taskToSession(task))
      }
      set({
        sessions,
        agents: (snapshot.agents ?? []) as MobileAgent[],
        desktopName: snapshot.desktop?.name ?? 'Desktop',
        sessionsLoading: false,
      })
    } catch {
      // Offline or unpaired: keep whatever we had; the socket reconnect resyncs.
      set({ sessionsLoading: false })
    }
  },

  async openSession(sessionId) {
    const conversation = getConversation(sessionId)
    try {
      const detail = await mobileApi.session(sessionId)
      // Clear stale state before replay (refresh / session switch).
      conversation.messages.length = 0
      conversation.seenEvents.clear()
      conversation.lastEventId = 0
      conversation.terminal = ''
      conversation.activity = undefined
      conversation.commands = []
      conversation.mode = undefined

      // Merge user messages and assistant events into one chronological stream;
      // replaying them in two loops loses interleaving.
      type Item =
        | { kind: 'message'; timestamp: string; message: (typeof detail.messages)[number] }
        | { kind: 'event'; timestamp: string; event: (typeof detail.events)[number] }
      const merged: Item[] = [
        ...detail.messages.map((m) => ({ kind: 'message' as const, timestamp: m.timestamp, message: m })),
        ...detail.events.map((e) => ({ kind: 'event' as const, timestamp: e.timestamp, event: e })),
      ]
      merged.sort((a, b) => {
        const ta = new Date(a.timestamp).getTime()
        const tb = new Date(b.timestamp).getTime()
        if (ta !== tb) return ta - tb
        if (a.kind !== b.kind) return a.kind === 'message' ? -1 : 1
        return 0
      })
      for (const item of merged) {
        if (item.kind === 'message') applyMessage(conversation, item.message)
        else applyAgentEvent(conversation, item.event)
      }
      if (detail.terminal_output) appendTerminal(conversation, detail.terminal_output)

      // Pending questions are not persisted as events, so hydrate them onto the
      // last turn (approvals ARE in the event log and replay above).
      const questions = (detail.questions ?? []) as Array<{
        question_id: string
        question?: string
        title?: string
        options?: Array<{ id: string; label?: string; description?: string; allows_custom_text?: boolean }>
        selection_mode?: string
      }>
      if (questions.length) {
        const turn = conversation.messages[conversation.messages.length - 1]
        if (turn) {
          for (const q of questions) {
            if (turn.parts.some((p) => p.kind === 'approval' && p.requestId === q.question_id)) continue
            const optionData = (q.options ?? []).map((o) => ({
              value: o.id,
              label: o.label,
              description: o.description,
              allowsCustomText: o.allows_custom_text,
            }))
            turn.parts.push({
              kind: 'approval',
              requestId: q.question_id,
              prompt: q.question || q.title || 'The agent is asking a question.',
              options: optionData.map((o) => o.label ?? o.value),
              optionData,
              multiSelect: q.selection_mode === 'multiple',
              allowsCustomText: optionData.some((o) => o.allowsCustomText),
              header: q.title,
              isQuestion: true,
            })
          }
        }
      }

      // Seal a turn the history left streaming if the session is not active.
      const session = detail.session
      set((state) => ({ sessions: upsertSession(state.sessions, session) }))
      if (!isActiveStatus(session.status)) sealConversation(conversation)
      bump(set, sessionId)
    } catch {
      // Leave the conversation as-is; the screen shows its own error state.
    }
  },

  async createSession(input) {
    try {
      const { session } = await mobileApi.createSession(input)
      set((state) => ({ sessions: upsertSession(state.sessions, session) }))
      return session
    } catch {
      return undefined
    }
  },

  sendPrompt(sessionId, text, attachments) {
    const finalText = withAttachmentBlock(text.trim(), attachments ?? [])
    if (!finalText) return
    addOptimisticUserMessage(getConversation(sessionId), finalText)
    bump(set, sessionId)
    socket.sendInput(sessionId, finalText)
  },

  queueMessage(sessionId, text, attachments) {
    const message: QueuedMessage = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      text,
      attachments: attachments ?? [],
      createdAt: new Date().toISOString(),
    }
    set((state) => ({ queues: { ...state.queues, [sessionId]: [...(state.queues[sessionId] ?? []), message] } }))
  },

  removeQueued(sessionId, id) {
    set((state) => ({
      queues: { ...state.queues, [sessionId]: (state.queues[sessionId] ?? []).filter((m) => m.id !== id) },
    }))
  },

  steerQueued(sessionId, id) {
    const message = (get().queues[sessionId] ?? []).find((m) => m.id === id)
    if (!message) return
    get().removeQueued(sessionId, id)
    get().sendPrompt(sessionId, message.text, message.attachments)
  },

  flushQueue(sessionId) {
    const queue = get().queues[sessionId] ?? []
    if (queue.length === 0) return
    const [head] = queue
    set((state) => ({ queues: { ...state.queues, [sessionId]: queue.slice(1) } }))
    get().sendPrompt(sessionId, head.text, head.attachments)
  },

  respondToApproval(sessionId, requestId, decision, meta) {
    socket.respondToApproval(sessionId, requestId, decision, meta)
  },

  setConfig(sessionId, configId, value) {
    socket.setConfig(sessionId, configId, value)
  },

  answerQuestion(questionId, selectedOptions, customText) {
    socket.answerQuestion(questionId, selectedOptions, customText)
  },

  async stopSession(sessionId) {
    try {
      await mobileApi.kill(sessionId)
    } catch {
      // The socket Command path is the fallback; ignore a REST failure here.
    }
    socket.stopSession(sessionId)
  },

  interruptSession(sessionId) {
    socket.interruptSession(sessionId)
  },

  async ensureSessionRow(sessionId) {
    if (get().sessions.some((session) => session.id === sessionId)) return
    try {
      const detail = await mobileApi.session(sessionId)
      set((state) => ({ sessions: upsertSession(state.sessions, detail.session) }))
    } catch {
      // A hidden/room session may not be fetchable; the card still renders.
    }
  },

  dismissNotice(sessionId) {
    set((state) => ({ notices: { ...state.notices, [sessionId]: undefined } }))
  },

  toggleStar(sessionId) {
    const starred = get().starred.includes(sessionId)
      ? get().starred.filter((id) => id !== sessionId)
      : [...get().starred, sessionId]
    storage.setJSON(STARRED_KEY, starred)
    set({ starred })
  },

  isStarred(sessionId) {
    return get().starred.includes(sessionId)
  },

  async removeSession(sessionId) {
    try {
      await mobileApi.remove(sessionId)
      conversations.delete(sessionId)
      set((state) => ({ sessions: state.sessions.filter((s) => s.id !== sessionId) }))
      return true
    } catch {
      return false
    }
  },

  async resumeSession(sessionId) {
    try {
      const res = await mobileApi.resume(sessionId)
      if (res.session) {
        set((state) => ({ sessions: upsertSession(state.sessions, res.session!) }))
      }
      return true
    } catch {
      return false
    }
  },

  async forkSession(sessionId) {
    try {
      const res = await mobileApi.fork(sessionId)
      if (res.session) {
        set((state) => ({ sessions: upsertSession(state.sessions, res.session!) }))
        return res.session
      }
      return undefined
    } catch {
      return undefined
    }
  },

  async archiveSession(sessionId, restore = false) {
    try {
      if (restore) {
        await mobileApi.restore(sessionId)
      } else {
        await mobileApi.archive(sessionId)
      }
      void get().loadSnapshot()
      return true
    } catch {
      return false
    }
  },

  async switchEngine(sessionId, agent, model) {
    try {
      const res = await mobileApi.switchEngine(sessionId, agent, model)
      if (res.switched) {
        void get().loadSnapshot()
        return true
      }
      return false
    } catch {
      return false
    }
  },

  async loadPending() {
    try {
      const res = await mobileApi.pending()
      set({ pendingActions: res.pending ?? [] })
    } catch {
      // offline or error
    }
  },

  setTheme(theme) {
    storage.set('agentdeck-theme', theme)
    set({ theme })
  },
}))

function isActiveStatus(status: SessionStatus): boolean {
  return status === 'running' || status === 'starting'
}

type SetState = (partial: Partial<StoreState> | ((state: StoreState) => Partial<StoreState>)) => void

function bump(set: SetState, sessionId: string): void {
  set((state) => ({ revisions: { ...state.revisions, [sessionId]: (state.revisions[sessionId] ?? 0) + 1 } }))
}

function setNotice(set: SetState, sessionId: string, message: string): void {
  set((state) => ({ notices: { ...state.notices, [sessionId]: message } }))
}

function upsertSession(sessions: Session[], incoming: Session): Session[] {
  const index = sessions.findIndex((session) => session.id === incoming.id)
  if (index === -1) return [incoming, ...sessions]
  const next = sessions.slice()
  next[index] = incoming
  return next
}

const SESSION_STATUSES: ReadonlySet<string> = new Set<SessionStatus>([
  'starting',
  'running',
  'waiting_for_input',
  'waiting_for_approval',
  'idle',
  'needs_resume',
  'error',
  'archived',
  'exited',
])

function asSessionStatus(value: string): SessionStatus | undefined {
  if (SESSION_STATUSES.has(value)) return value as SessionStatus
  if (value.startsWith('error')) return 'error'
  if (value === 'completed') return 'exited'
  return 'exited'
}

/**
 * Route one frame into the store. Ported verbatim from the web store (minus the
 * desktop-only browser-cursor overlay and the rooms roster, which are deferred):
 * the hub is global, so this filters by session id and bumps only the affected
 * session.
 */
function handleFrame(frame: IncomingFrame, set: SetState, get: () => StoreState): void {
  switch (frame.type) {
    case 'AgentEvent': {
      const event = frame.payload.event
      if (
        event.kind === 'permission_required' &&
        !get().sessions.some((session) => session.id === event.session_id)
      ) {
        void get().ensureSessionRow(event.session_id)
      }
      const conversation = getConversation(event.session_id)
      if (event.kind === 'session_config_changed') {
        const options = event.payload.options
        if (Array.isArray(options)) {
          const existing = get().configs[event.session_id]
          const normalized = (options as SessionConfig['options']).map((o) => ({
            ...o,
            choices: o.choices ?? [],
            allowsCustomValue: o.allowsCustomValue ?? false,
            mutability: o.mutability ?? 'live',
          }))
          set((state) => ({
            configs: {
              ...state.configs,
              [event.session_id]: {
                sessionId: event.session_id,
                agent: existing?.agent ?? '',
                transport: existing?.transport ?? 'acp',
                options: normalized,
                live: event.payload.live === true,
                interactiveTerminal: existing?.interactiveTerminal ?? false,
              },
            },
          }))
        }
        return
      }
      if (applyAgentEvent(conversation, event, frame.event_id)) bump(set, event.session_id)
      return
    }

    case 'Message': {
      const message = frame.payload.message
      if (applyMessage(getConversation(message.session_id), message)) bump(set, message.session_id)
      return
    }

    case 'TerminalOutput': {
      appendTerminal(getConversation(frame.payload.session_id), frame.payload.data)
      bump(set, frame.payload.session_id)
      return
    }

    case 'SessionUpdate': {
      set((state) => ({ sessions: upsertSession(state.sessions, frame.payload.session) }))
      const status = frame.payload.session.status
      const conversation = conversations.get(frame.payload.session.id)
      if (
        status === 'exited' ||
        status === 'error' ||
        status === 'needs_resume' ||
        status === 'archived' ||
        status === 'idle'
      ) {
        if (conversation) {
          sealConversation(conversation)
          bump(set, frame.payload.session.id)
        }
        if (status === 'idle') get().flushQueue(frame.payload.session.id)
      }
      return
    }

    case 'SessionDeleted': {
      conversations.delete(frame.payload.session_id)
      set((state) => ({
        sessions: state.sessions.filter((session) => session.id !== frame.payload.session_id),
      }))
      return
    }

    case 'StateChange': {
      const status = asSessionStatus(frame.payload.state)
      if (!status) return
      set((state) => ({
        sessions: state.sessions.map((session) =>
          session.id === frame.payload.session_id ? { ...session, status } : session,
        ),
      }))
      if (
        status === 'exited' ||
        status === 'error' ||
        status === 'idle' ||
        status === 'needs_resume' ||
        status === 'archived'
      ) {
        const conversation = conversations.get(frame.payload.session_id)
        if (conversation) {
          sealConversation(conversation)
          bump(set, frame.payload.session_id)
        }
        if (status === 'idle') get().flushQueue(frame.payload.session_id)
      }
      return
    }

    case 'SessionError': {
      setNotice(set, frame.payload.session_id, readableAgentError(frame.payload.message))
      return
    }

    default:
      // Unknown frames (RoomUpsert/RoomDeleted, TunnelUpdate, …) are ignored for
      // now; rooms sync is a later phase.
      return
  }
}
