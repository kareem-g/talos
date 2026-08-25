/**
 * Application store.
 *
 * One store, subscribed to by slice. The design constraint that shapes
 * everything here: **an incoming token must not re-render the app.**
 *
 * The old code kept a growing `messages` array in a hook, which was a `useMemo`
 * dependency, which rebuilt the entire timeline on every frame — and its 500-item
 * cap silently dropped the oldest frames from that rebuild. Here, a frame mutates
 * one message via the reducer and bumps a per-session revision counter. Only
 * components subscribed to that session re-render.
 *
 * Conversations live in a plain `Map` outside zustand's reactive object on
 * purpose: mutating a message in place is O(1), and the revision counter is what
 * signals React. Cloning the conversation per token would reintroduce the
 * original cost.
 */

import { create } from 'zustand'
import {
  addOptimisticUserMessage,
  appendTerminal,
  applyAgentEvent,
  applyMessage,
  sealConversation,
} from '@/lib/events'
import { configApi, providersApi, sessionsApi } from '@/lib/api'
import { socket } from '@/lib/socket'
import { emptyConversation, type Conversation } from '@/types/conversation'
import type { ConnectionState, IncomingFrame } from '@/types/protocol'
import type { Provider, SessionConfig, ConfigApplied } from '@/types/provider'
import type { Session, SessionStatus, DiscoverResponse, SyncResponse } from '@/types/session'

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

interface StoreState {
  connection: ConnectionState

  providers: Provider[]
  providersLoading: boolean
  providersError?: string

  sessions: Session[]
  sessionsLoading: boolean

  /** Per-session config, as last reported. */
  configs: Record<string, SessionConfig>

  /**
   * Bumped when a session's conversation changes. Components subscribe to their
   * own session's counter, so an unrelated session streaming does not re-render
   * them.
   */
  revisions: Record<string, number>

  /** Transient per-session notices (a declined model change, an agent error). */
  notices: Record<string, string | undefined>

  /** Starred session ids (local-only, persisted to localStorage). */
  starred: string[]

  loadProviders: (refresh?: boolean) => Promise<void>
  loadSessions: () => Promise<void>
  /** Sessions in each CLI's own history that this app does not have yet. */
  discoverSessions: () => Promise<DiscoverResponse>
  /** Adopt discovered sessions. Omitted `only` imports everything. */
  syncSessions: (only?: Array<{ agent: string; externalId: string }>) => Promise<SyncResponse>
  openSession: (sessionId: string) => Promise<void>
  createSession: (input: {
    agent: string
    project?: string
    prompt?: string
    name?: string
    model?: string
  }) => Promise<Session>
  sendPrompt: (sessionId: string, text: string) => void
  stopSession: (sessionId: string) => Promise<void>
  /** Restart the agent so a stopped or imported session can continue. */
  resumeSession: (sessionId: string) => Promise<boolean>
  deleteSession: (sessionId: string) => Promise<void>
  setConfig: (sessionId: string, configId: string, value: string) => Promise<ConfigApplied>
  respondToApproval: (sessionId: string, requestId: string, decision: string) => void
  dismissNotice: (sessionId: string) => void
  /** Toggle star for a session (local-only). */
  toggleStar: (sessionId: string) => void
  /** Check if a session is starred. */
  isStarred: (sessionId: string) => boolean
  start: () => void
}

export const useStore = create<StoreState>((set, get) => ({
  connection: 'idle',
  providers: [],
  providersLoading: false,
  sessions: [],
  sessionsLoading: false,
  configs: {},
  revisions: {},
  notices: {},
  starred: (() => {
    try {
      const raw = localStorage.getItem('agentdeck-starred')
      if (!raw) return []
      return JSON.parse(raw) as string[]
    } catch {
      return []
    }
  })(),

  async loadProviders(refresh = false) {
    set({ providersLoading: true, providersError: undefined })
    try {
      const response = refresh ? await providersApi.refresh() : await providersApi.list()
      set({ providers: response.providers, providersLoading: false })
    } catch (error) {
      set({
        providersLoading: false,
        providersError: error instanceof Error ? error.message : 'Could not load providers',
      })
    }
  },

  async loadSessions() {
    set({ sessionsLoading: true })
    try {
      const listed = await sessionsApi.list()
      // The list is authoritative, but a session created locally moments ago may
      // not be in it yet. Merge rather than replace so a just-created session
      // does not blink out, and dedupe by id in case it appears in both.
      set((state) => {
        const byId = new Map(listed.map((session) => [session.id, session]))
        for (const session of state.sessions) {
          if (!byId.has(session.id)) byId.set(session.id, session)
        }
        return { sessions: [...byId.values()], sessionsLoading: false }
      })
    } catch {
      set({ sessionsLoading: false })
    }
  },

  discoverSessions() {
    return sessionsApi.discover()
  },

  /**
   * Adopt sessions from CLI history.
   *
   * The imported rows are merged in directly rather than waiting for a refetch,
   * so the list updates immediately. The backend also broadcasts
   * `SessionUpdate` for each, which `upsertSession` deduplicates.
   */
  async syncSessions(only) {
    const result = await sessionsApi.sync(only)
    if (result.sessions.length > 0) {
      set((state) => {
        let sessions = state.sessions
        for (const session of result.sessions) sessions = upsertSession(sessions, session)
        return { sessions }
      })
    }
    return result
  },

  /**
   * Hydrate a session from persisted history, then let live frames continue it.
   *
   * History replays through the same reducer as live events, so there is exactly
   * one code path that builds a conversation — and reopening a session cannot
   * produce a different result than watching it live.
   */
  async openSession(sessionId) {
    const conversation = getConversation(sessionId)
    try {
      const [history, config] = await Promise.all([
        sessionsApi.history(sessionId),
        configApi.get(sessionId).catch(() => undefined),
      ])

      // Clear any stale state before replay — handles refresh and
      // switching sessions where the Map entry already exists but is
      // from a previous (maybe partial) load. Without this, a second
      // openSession would append duplicates and keep the old mis-ordered
      // 7-user-then-4-assistant layout seen in the screenshot.
      conversation.messages.length = 0
      conversation.seenEvents.clear()
      conversation.lastEventId = 0
      conversation.terminal = ''
      conversation.activity = undefined
      conversation.commands = []
      conversation.mode = undefined

      // Merge messages (user) and events (assistant deltas) into a single
      // chronological stream. The backend stores them in two tables ordered
      // separately (messages by timestamp, events by sequence), so replaying
      // them in two separate loops loses interleaving and produces the
      // "all user bubbles first, then all assistant" bug.
      type HistoryItem =
        | { kind: 'message'; timestamp: string; message: (typeof history.messages)[number] }
        | { kind: 'event'; timestamp: string; event: (typeof history.events)[number] }
      const merged: HistoryItem[] = [
        ...history.messages.map((m) => ({
          kind: 'message' as const,
          timestamp: m.timestamp,
          message: m,
        })),
        ...history.events.map((e) => ({
          kind: 'event' as const,
          timestamp: e.timestamp,
          event: e,
        })),
      ]
      merged.sort((a, b) => {
        const ta = new Date(a.timestamp).getTime()
        const tb = new Date(b.timestamp).getTime()
        if (ta !== tb) return ta - tb
        // Same timestamp: keep user messages before assistant events for that turn
        if (a.kind !== b.kind) return a.kind === 'message' ? -1 : 1
        return 0
      })

      for (const item of merged) {
        if (item.kind === 'message') applyMessage(conversation, item.message)
        else applyAgentEvent(conversation, item.event)
      }
      for (const chunk of history.terminal_output) appendTerminal(conversation, chunk.data)

      // A turn left streaming by history (the agent stopped while we were away)
      // would spin forever. The session status is the authority on whether work
      // is still happening.
      const session = get().sessions.find((candidate) => candidate.id === sessionId)
      if (session && session.status !== 'running' && session.status !== 'starting') {
        const last = conversation.messages[conversation.messages.length - 1]
        if (last?.streaming) {
          last.streaming = false
          for (const part of last.parts) {
            if ('streaming' in part) part.streaming = false
          }
        }
        conversation.activity = undefined
      }

      if (config) set((state) => ({ configs: { ...state.configs, [sessionId]: config } }))
      bump(set, sessionId)
    } catch (error) {
      setNotice(set, sessionId, error instanceof Error ? error.message : 'Could not open session')
    }
  },

  async createSession(input) {
    const session = await sessionsApi.create(input)
    set((state) => ({ sessions: upsertSession(state.sessions, session) }))
    // Optimistically seed the model so the chip doesn't flash "Not set" while
    // the flag-driven provider (claude/codex) returns a descriptor with
    // current_value: null. The authoritative value arrives via configApi.get
    // or the session_config_changed broadcast and replaces this.
    if (input.model) {
      const optimistic = get().providers.find((p) => p.id === input.agent)
      const descriptor = optimistic?.configOptions.find((o) => o.id === 'model' || o.category === 'model')
      if (descriptor) {
        const existing = get().configs[session.id]
        if (!existing) {
          const patched: SessionConfig = {
            sessionId: session.id,
            agent: input.agent,
            transport: 'acp',
            options: [
              { ...descriptor, currentValue: input.model },
              ...((optimistic?.configOptions.filter((o) => o.id !== 'model' && o.category !== 'model') ?? []) as SessionConfig['options']),
            ],
            live: false,
            interactiveTerminal: false,
          }
          set((state) => ({ configs: { ...state.configs, [session.id]: patched } }))
        }
      }
    }
    // A brand-new session has no history to fetch, but it does have config the
    // agent just reported at handshake.
    configApi
      .get(session.id)
      .then((config) => {
        // Merge the creation-time model when the backend descriptor still has
        // currentValue: null (flag providers). Otherwise the chip would flip
        // back to "Not set" one frame after creation.
        if (input.model) {
          const modelOpt = config.options.find((o) => o.id === 'model' || o.category === 'model')
          if (modelOpt && !modelOpt.currentValue) modelOpt.currentValue = input.model
        }
        set((state) => ({ configs: { ...state.configs, [session.id]: config } }))
      })
      .catch(() => undefined)
    return session
  },

  /**
   * Send a prompt. The message appears immediately; the server echo reconciles
   * it rather than duplicating it.
   */
  sendPrompt(sessionId, text) {
    const trimmed = text.trim()
    if (!trimmed) return
    const conversation = getConversation(sessionId)
    addOptimisticUserMessage(conversation, trimmed)
    bump(set, sessionId)
    socket.sendInput(sessionId, trimmed)
  },

  /** Stop the agent for real, then reflect what the backend reports. */
  async stopSession(sessionId) {
    socket.stopSession(sessionId)
    try {
      await sessionsApi.kill(sessionId)
    } catch (error) {
      setNotice(set, sessionId, error instanceof Error ? error.message : 'Could not stop the agent')
    }
  },

  /**
   * Restart the agent for a stopped or imported session.
   *
   * Returns whether the agent is now starting. Optimistically sets status to
   * 'resuming' to prevent double-clicks, then the authoritative status arrives
   * via `SessionUpdate`. On error, reverts to 'needs_resume' with a notice.
   */
  async resumeSession(sessionId) {
    const session = get().sessions.find((s) => s.id === sessionId)
    if (!session) {
      setNotice(set, sessionId, 'Session not found')
      return false
    }
    
    // Guard: if already resuming or running, no-op
    if (session.status === 'resuming' || session.status === 'running' || session.status === 'starting') {
      return false
    }

    // Optimistically set to 'resuming'
    set((state) => ({
      sessions: state.sessions.map((s) =>
        s.id === sessionId ? { ...s, status: 'resuming' as SessionStatus } : s
      ),
    }))

    try {
      const result = await sessionsApi.resume(sessionId);
      if (result.status === 'already_active') {
        setNotice(set, sessionId, result.message ?? 'This session is already running.')
        // Backend says already running, update to running
        set((state) => ({
          sessions: state.sessions.map((s) =>
            s.id === sessionId ? { ...s, status: 'running' as SessionStatus } : s
          ),
        }))
        return true
      }
      // The backend moved the session to `idle`/`running`, but the store still
      // holds the `exited` we loaded at page open — so the UI would keep showing
      // a Resume button for a session that is already going. Replace the row so
      // the composer returns immediately, without waiting for a WS frame.
      if (result.success) {
        set((state) => ({
          sessions: state.sessions.map((s) =>
            s.id === sessionId
              ? {
                  ...s,
                  status: (result.status === 'running' ? 'running' : 'idle') as SessionStatus,
                }
              : s,
          ),
        }));
      } else {
        // Resume failed, revert to needs_resume
        set((state) => ({
          sessions: state.sessions.map((s) =>
            s.id === sessionId ? { ...s, status: 'needs_resume' as SessionStatus } : s
          ),
        }))
      }
      return result.success
    } catch (error) {
      // The backend explains refusals in the body; `request` surfaces that as
      // the error message. Revert to needs_resume on error.
      set((state) => ({
        sessions: state.sessions.map((s) =>
          s.id === sessionId ? { ...s, status: 'needs_resume' as SessionStatus } : s
        ),
      }))
      setNotice(
        set,
        sessionId,
        error instanceof Error ? error.message : 'Could not resume this session',
      )
      return false
    }
  },


  async deleteSession(sessionId) {
    await sessionsApi.delete(sessionId)
    conversations.delete(sessionId)
    set((state) => ({
      sessions: state.sessions.filter((session) => session.id !== sessionId),
    }))
  },

  /**
   * Change a config dimension.
   *
   * The response's `applied` is the truth. A declined change surfaces the
   * provider's reason as a notice — the picker must not relabel itself on a
   * change that did not happen.
   */
  async setConfig(sessionId, configId, value) {
    try {
      const response = await configApi.update(sessionId, configId, value)
      set((state) => ({ configs: { ...state.configs, [sessionId]: response.config } }))
      if (response.applied.applied !== 'immediate') {
        setNotice(set, sessionId, response.applied.reason)
      }
      return response.applied
    } catch (error) {
      const reason = error instanceof Error ? error.message : 'Could not change the setting'
      setNotice(set, sessionId, reason)
      return { applied: 'unsupported', reason }
    }
  },

  respondToApproval(sessionId, requestId, decision) {
    socket.respondToApproval(sessionId, requestId, decision)
  },

  dismissNotice(sessionId) {
    set((state) => ({ notices: { ...state.notices, [sessionId]: undefined } }))
  },

  toggleStar(sessionId) {
    set((state) => {
      const starred = new Set(state.starred)
      if (starred.has(sessionId)) {
        starred.delete(sessionId)
      } else {
        starred.add(sessionId)
      }
      try {
        localStorage.setItem('agentdeck-starred', JSON.stringify([...starred]))
      } catch {
      /* storage may be unavailable */
    }
      return { starred: [...starred] }
    })
  },

  isStarred(sessionId) {
    return get().starred.includes(sessionId)
  },

  /** Connect the socket and wire frames into the store. Idempotent. */
  start() {
    let previous: ConnectionState = 'idle'
    socket.onState((connection) => {
      const wasOffline = previous === 'reconnecting' || previous === 'disconnected' || previous === 'offline' || previous === 'error'
      previous = connection
      set({ connection })
      if (connection === 'connected' && wasOffline) {
        // Resynchronize with backend truth after interruption — replay covers events but
        // Session rows may have changed (status, new sessions) while we were away.
        void get().loadSessions()
      }
    })
    socket.onFrame((frame) => handleFrame(frame, set, get))
    socket.connect()
    void get().loadProviders()
    void get().loadSessions()
  },
}))

type SetState = (
  partial: Partial<StoreState> | ((state: StoreState) => Partial<StoreState>),
) => void

function bump(set: SetState, sessionId: string): void {
  set((state) => ({
    revisions: { ...state.revisions, [sessionId]: (state.revisions[sessionId] ?? 0) + 1 },
  }))
}

function setNotice(set: SetState, sessionId: string, message: string): void {
  set((state) => ({ notices: { ...state.notices, [sessionId]: message } }))
}

/**
 * Route one frame into the store.
 *
 * The broadcast hub is global — every client receives every session's frames —
 * so this filters by session id and only bumps the affected session.
 */
function handleFrame(frame: IncomingFrame, set: SetState, get: () => StoreState): void {
  switch (frame.type) {
    case 'AgentEvent': {
      const event = frame.payload.event
      const conversation = getConversation(event.session_id)
      // `session_config_changed` carries the authoritative option set after a
      // change made anywhere — including on another device. This is what keeps a
      // desktop in sync when the model is switched on a phone.
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
                // Not carried by this event; preserve what the session reported.
                interactiveTerminal: existing?.interactiveTerminal ?? false,
              },
            },
          }))
        }
        return
      }
      if (applyAgentEvent(conversation, event, frame.event_id)) {
        bump(set, event.session_id)
      }
      return
    }

    case 'Message': {
      const message = frame.payload.message
      if (applyMessage(getConversation(message.session_id), message)) {
        bump(set, message.session_id)
      }
      return
    }

    case 'TerminalOutput': {
      appendTerminal(getConversation(frame.payload.session_id), frame.payload.data)
      bump(set, frame.payload.session_id)
      return
    }

    case 'SessionUpdate': {
      set((state) => ({ sessions: upsertSession(state.sessions, frame.payload.session) }))
      // An update that marks a session terminal (imported as needs_resume,
      // agent exited, archived) must clear the activity line — StateChange
      // alone can lag or never arrive for imports.
      {
        const status = frame.payload.session.status
        if (status === 'exited' || status === 'error' || status === 'needs_resume' || status === 'archived') {
          const conversation = conversations.get(frame.payload.session.id)
          if (conversation) {
            sealConversation(conversation)
            bump(set, frame.payload.session.id)
          }
        } else if (status === 'idle') {
          const conversation = conversations.get(frame.payload.session.id)
          if (conversation) {
            // A turn finished and the agent is awaiting the next message — stop
            // the spinner, but don't lock the composer (idle still accepts input).
            sealConversation(conversation)
            bump(set, frame.payload.session.id)
          }
        }
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
      // A finished — or newly idle/terminal — session must not leave the
      // activity line and any open text part spinning forever.
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
      }
      return
    }

    case 'SessionError': {
      setNotice(set, frame.payload.session_id, frame.payload.message)
      return
    }

    default:
      // Unknown frames are ignored: the backend may add variants.
      return
  }
}

/**
 * Insert or replace a session by id.
 *
 * Deduplication is the point. `createSession` prepends the session it just
 * created, but the backend broadcasts `SessionUpdate` during spawn — which can
 * arrive *before* the POST resolves. The frame handler then finds no match and
 * prepends, and the POST prepends again, producing two rows with the same id and
 * React's duplicate-key warning.
 */
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

/**
 * Map a `StateChange.state` string onto a session status.
 *
 * The field is free-form server-side and carries values that are not
 * `SessionStatus`: `"completed"` when a process exits cleanly and `"error:<code>"`
 * when it does not. Ignoring those left a finished session displayed as
 * "Working" indefinitely, so they are mapped the same way the backend persists
 * them — unrecognized states are terminal.
 */
function asSessionStatus(value: string): SessionStatus | undefined {
  if (SESSION_STATUSES.has(value)) return value as SessionStatus
  if (value.startsWith('error')) return 'error'
  if (value === 'completed') return 'exited'
  // An unknown state from a newer backend is still an end state, not a reason to
  // keep a spinner running forever.
  return 'exited'
}

/** Subscribe to one session's conversation. Re-renders only on its own changes. */
export function useConversation(sessionId: string): Conversation {
  useStore((state) => state.revisions[sessionId] ?? 0)
  return getConversation(sessionId)
}
