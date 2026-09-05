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
import { readableAgentError } from '@/lib/errors'
import { socket } from '@/lib/socket'
import { emptyConversation, type AttachmentRef, type Conversation, type QueuedMessage } from '@/types/conversation'
import type { ApprovalMeta, ConnectionState, IncomingFrame } from '@/types/protocol'
import type { Provider, SessionConfig, ConfigApplied } from '@/types/provider'
import type { Session, SessionStatus, DiscoverResponse, SyncResponse } from '@/types/session'

/** Conversations, keyed by session id. Mutated in place; see the module docs. */
const conversations = new Map<string, Conversation>()

/** Live AI-cursor position on the mirrored browser page. */
export interface BrowserCursor {
  x: number
  y: number
  button: string
  pressed: boolean
}

export function getConversation(sessionId: string): Conversation {
  let conversation = conversations.get(sessionId)
  if (!conversation) {
    conversation = emptyConversation(sessionId)
    conversations.set(sessionId, conversation)
  }
  return conversation
}

/**
 * Append the attached-file paths to a prompt so the agent can read them.
 *
 * The daemon stores uploads under the session's scratch dir and returns the
 * paths; there is no native attachment channel to the CLIs, so the paths ride
 * in the prompt text — the agent Reads them like any other file.
 */
export function withAttachmentBlock(text: string, attachments: AttachmentRef[]): string {
  if (attachments.length === 0) return text
  const lines = attachments.map(
    (a) => `- ${a.path} (${a.fileName}${a.contentType ? `, ${a.contentType}` : ''})`,
  )
  const block = `<attached_files>\n${lines.join('\n')}\n</attached_files>`
  return text.trim() ? `${text.trim()}\n\n${block}` : block
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

  /**
   * Live AI-cursor position per session, driven by `browser_cursor_*` WS
   * events so the dashboard can animate a pointer over the mirrored page.
   */
  browserCursors: Record<string, BrowserCursor>

  /** Starred session ids (local-only, persisted to localStorage). */
  starred: string[]

  /**
   * Follow-up messages typed while the agent is working, per session. They
   * render as editable rows above the composer and auto-send one-per-turn as
   * the agent goes idle — or immediately via Steer.
   */
  queues: Record<string, QueuedMessage[]>

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
  sendPrompt: (sessionId: string, text: string, attachments?: AttachmentRef[]) => void
  /** Queue a follow-up message (typed while the agent is working). */
  queueMessage: (sessionId: string, text: string, attachments?: AttachmentRef[]) => void
  /** Drop a queued message without sending it. */
  removeQueued: (sessionId: string, id: string) => void
  /** Send a queued message immediately, without waiting for the turn to end. */
  steerQueued: (sessionId: string, id: string) => void
  /** Pull a queued message back into the composer for editing. Returns it. */
  editQueued: (sessionId: string, id: string) => QueuedMessage | undefined
  /** Reorder the queue by dragging a row. */
  reorderQueued: (sessionId: string, from: number, to: number) => void
  /** Send the head of the queue — called when the agent goes idle. */
  flushQueue: (sessionId: string) => void
  /** Resend the last user message to re-run the agent from that point. */
  resendLastUserPrompt: (sessionId: string) => boolean
  stopSession: (sessionId: string) => Promise<void>
  /**
   * Stop only the running response. The session stays alive (resumable), so
   * the next message or a steer lands in the same conversation instead of
   * killing the whole session.
   */
  interruptSession: (sessionId: string) => void
  /**
   * Re-fetch configs for every session currently holding one. Used after
   * reconnect so config chips reflect fresh provider descriptors.
   */
  refreshConfigs: () => Promise<void>
  /** Restart the agent so a stopped or imported session can continue. */
  resumeSession: (sessionId: string) => Promise<boolean>
  /**
   * Switch the engine backing a session to another ready CLI/API provider,
   * keeping the same session row and transcript. Returns whether the switch
   * succeeded; failures surface as a session notice.
   */
  switchSessionEngine: (sessionId: string, agent: string, model?: string) => Promise<boolean>
  deleteSession: (sessionId: string) => Promise<void>
  /**
   * Archive a session: stops it first (the backend refuses live sessions),
   * then marks it archived. Only drops the local row on server confirm.
   */
  archiveSession: (sessionId: string) => Promise<void>
  /** Restore an archived session back to the workspace lists. */
  restoreSession: (sessionId: string) => Promise<void>
  /**
   * Register a session row the list never carried (hidden room channels and
   * workers): fetches it by id and upserts so approval cards and statuses
   * have a session to attach to. No-op when already known. Never throws.
   */
  ensureSessionRow: (sessionId: string) => Promise<void>
  setConfig: (sessionId: string, configId: string, value: string) => Promise<ConfigApplied>
  respondToApproval: (sessionId: string, requestId: string, decision: string, meta?: ApprovalMeta) => void
  dismissNotice: (sessionId: string) => void
  /** Update the live AI-cursor position for a session (from WS cursor events). */
  setBrowserCursor: (sessionId: string, cursor: BrowserCursor) => void
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
  browserCursors: {},
  queues: {},
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

      // Hydrate pending questions/approvals that were still open when the
      // session was last active. Live ones arrive via question_started frames
      // (handled in events.ts); these are the ones that would otherwise be lost
      // on replay because question_started is not persisted to the event log.
      if (history.questions?.length) {
        const { messages } = conversation
        const turn = messages[messages.length - 1]
        if (turn) {
          for (const q of history.questions) {
            if (turn.parts.some((p) => p.kind === 'approval' && p.requestId === q.question_id)) continue
            const optionData = q.options.map((o) => ({
              value: o.id,
              label: o.label,
              description: o.description,
              allowsCustomText: o.allows_custom_text,
            }))
            turn.parts.push({
              kind: 'approval',
              requestId: q.question_id,
              prompt: q.question || q.title || 'The agent is asking a question.',
              options: optionData.map((o) => o.label),
              optionData,
              multiSelect: q.selection_mode === 'multiple',
              allowsCustomText: optionData.some((o) => o.allowsCustomText),
              header: q.title,
              isQuestion: true,
            })
          }
        }
      }

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
   *
   * A prompt sent to a stopped-but-resumable session (the user hit Stop on the
   * running response, or the session was imported) resumes it first — stopping
   * the current turn must not leave the session dead, and the next message or
   * steer should just work.
   */
  sendPrompt(sessionId, text, attachments = []) {
    const trimmed = text.trim()
    if (!trimmed) return
    const wireText = withAttachmentBlock(trimmed, attachments)
    const conversation = getConversation(sessionId)
    addOptimisticUserMessage(conversation, wireText, attachments)
    bump(set, sessionId)
    const session = get().sessions.find((s) => s.id === sessionId)
    const resumable = Boolean(
      session && (session.status === 'needs_resume' || session.status === 'paused' || session.status === 'exited'),
    )
    if (resumable) {
      void get()
        .resumeSession(sessionId)
        .then(() => socket.sendInput(sessionId, wireText))
      return
    }
    socket.sendInput(sessionId, wireText)
  },

  /** Queue a follow-up typed while the agent is working. */
  queueMessage(sessionId, text, attachments = []) {
    const trimmed = text.trim()
    if (!trimmed && attachments.length === 0) return
    const message: QueuedMessage = {
      id: `q-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      text: trimmed,
      attachments,
      createdAt: new Date().toISOString(),
    }
    set((state) => ({
      queues: { ...state.queues, [sessionId]: [...(state.queues[sessionId] ?? []), message] },
    }))
  },

  removeQueued(sessionId, id) {
    set((state) => ({
      queues: {
        ...state.queues,
        [sessionId]: (state.queues[sessionId] ?? []).filter((m) => m.id !== id),
      },
    }))
  },

  /** Inject a queued message now, without waiting for the turn to end. */
  steerQueued(sessionId, id) {
    const message = (get().queues[sessionId] ?? []).find((m) => m.id === id)
    if (!message) return
    get().removeQueued(sessionId, id)
    get().sendPrompt(sessionId, message.text, message.attachments)
  },

  /** Pull a queued message back into the composer for editing. */
  editQueued(sessionId, id) {
    const message = (get().queues[sessionId] ?? []).find((m) => m.id === id)
    if (!message) return undefined
    get().removeQueued(sessionId, id)
    return message
  },

  reorderQueued(sessionId, from, to) {
    set((state) => {
      const queue = [...(state.queues[sessionId] ?? [])]
      if (from < 0 || from >= queue.length || to < 0 || to >= queue.length) return {}
      const [moved] = queue.splice(from, 1)
      queue.splice(to, 0, moved)
      return { queues: { ...state.queues, [sessionId]: queue } }
    })
  },

  /**
   * Send the head of the queue. Called when the agent goes idle, so a queue
   * drains one message per turn rather than flooding the agent.
   */
  flushQueue(sessionId) {
    const queue = get().queues[sessionId] ?? []
    if (queue.length === 0) return
    const [head, ...rest] = queue
    set((state) => ({ queues: { ...state.queues, [sessionId]: rest } }))
    get().sendPrompt(sessionId, head.text, head.attachments)
  },

  /**
   * Re-run the agent from the last user prompt. Finds the most recent user
   * message in the conversation and resends its text — equivalent to the user
   * re-typing it. No-ops (returns false) when there is nothing to resend.
   */
  resendLastUserPrompt(sessionId) {
    const conversation = getConversation(sessionId)
    for (let i = conversation.messages.length - 1; i >= 0; i--) {
      const message = conversation.messages[i]
      if (message.role !== 'user') continue
      const text = message.parts
        .map((part) => (part.kind === 'text' ? part.text : ''))
        .join('')
        .trim()
      if (!text) return false
      addOptimisticUserMessage(conversation, text)
      bump(set, sessionId)
      socket.sendInput(sessionId, text)
      return true
    }
    return false
  },

  async stopSession(sessionId) {
    socket.stopSession(sessionId)
    try {
      await sessionsApi.kill(sessionId)
    } catch (error) {
      setNotice(set, sessionId, error instanceof Error ? error.message : 'Could not stop the agent')
    }
  },

  /** Stop the running response only — the session stays resumable. */
  interruptSession(sessionId) {
    socket.interruptSession(sessionId)
  },

  async refreshConfigs() {
    const ids = Object.keys(get().configs)
    if (ids.length === 0) return
    const results = await Promise.all(
      ids.map((sessionId) =>
        configApi
          .get(sessionId)
          .then((config) => ({ sessionId, config }) as const)
          .catch(() => null),
      ),
    )
    set((state) => {
      const configs = { ...state.configs }
      for (const result of results) {
        if (result) configs[result.sessionId] = result.config
      }
      return { configs }
    })
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
    // Delete is stop-then-remove: a session blocked on approval must end
    // first, otherwise the backend refuses (live PTY/ACP) or the orphaned
    // turn resurrects the row. Only drop the local copy once the server
    // confirms — removing it optimistically is what made "deleted" sessions
    // reappear on the next reload with no way to kill them.
    try {
      await get().stopSession(sessionId)
    } catch {
      /* best effort — delete still attempts the server-side teardown */
    }
    try {
      await sessionsApi.delete(sessionId)
    } catch (error) {
      setNotice(set, sessionId, error instanceof Error ? error.message : 'Could not delete this session')
      throw error
    }
    conversations.delete(sessionId)
    set((state) => ({
      sessions: state.sessions.filter((session) => session.id !== sessionId),
    }))
  },

  async archiveSession(sessionId) {
    try {
      await get().stopSession(sessionId)
    } catch {
      /* best effort — archive still attempts the server-side move */
    }
    try {
      await sessionsApi.archive(sessionId)
    } catch (error) {
      setNotice(set, sessionId, error instanceof Error ? error.message : 'Could not archive this session')
      throw error
    }
    set((state) => ({
      sessions: state.sessions.map((session) =>
        session.id === sessionId ? { ...session, status: 'archived' as SessionStatus } : session,
      ),
    }))
  },

  async restoreSession(sessionId) {
    try {
      await sessionsApi.restore(sessionId)
    } catch (error) {
      setNotice(set, sessionId, error instanceof Error ? error.message : 'Could not restore this session')
      throw error
    }
    // The backend returns the row to needs_resume/idle — reload it so the
    // local copy (and every list) reflects the live status, not `archived`.
    try {
      const session = await sessionsApi.get(sessionId)
      set((state) => ({ sessions: upsertSession(state.sessions, session) }))
    } catch {
      /* row stays archived locally until the next refresh */
    }
  },

  async ensureSessionRow(sessionId) {
    if (get().sessions.some((session) => session.id === sessionId)) return
    try {
      const session = await sessionsApi.get(sessionId)
      set((state) => ({ sessions: upsertSession(state.sessions, session) }))
    } catch {
      /* unreachable session — the card still renders from events alone */
    }
  },

  async switchSessionEngine(sessionId, agent, model) {
    try {
      const result = await sessionsApi.switchEngine(sessionId, agent, model)
      if (!result.switched || !result.session) {
        setNotice(set, sessionId, result.error ?? `Could not switch this session to ${agent}`)
        return false
      }
      set((state) => ({ sessions: upsertSession(state.sessions, result.session as Session) }))
      // The new engine brings its own config surface — refresh so chips show
      // the right model/mode/effort instead of the previous provider's.
      try {
        const config = await configApi.get(sessionId)
        set((state) => ({ configs: { ...state.configs, [sessionId]: config } }))
      } catch {
        /* next openSession refreshes the config */
      }
      return true
    } catch (error) {
      const reason = error instanceof Error ? error.message : `Could not switch this session to ${agent}`
      setNotice(set, sessionId, reason)
      return false
    }
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

  respondToApproval(sessionId, requestId, decision, meta) {
    // Question cards (AskUserQuestion) are answered via QuestionAnswer, not the
    // permission broker. Detect the card by its requestId and route accordingly.
    const conversation = getConversation(sessionId)
    const isQuestion = conversation.messages.some((message) =>
      message.parts.some((part) => part.kind === 'approval' && part.requestId === requestId && part.isQuestion),
    )
    if (isQuestion) {
      // Multi-select submits a JSON array; single select submits a bare string.
      let selectedOptions = [decision]
      try {
        const parsed = JSON.parse(decision)
        if (Array.isArray(parsed)) selectedOptions = parsed.map((v) => String(v))
      } catch {
        /* decision is a bare string — keep the single-element list */
      }
      socket.answerQuestion(requestId, selectedOptions, meta?.customText)
    } else {
      socket.respondToApproval(sessionId, requestId, decision, meta)
    }
  },

  dismissNotice(sessionId) {
    set((state) => ({ notices: { ...state.notices, [sessionId]: undefined } }))
  },

  setBrowserCursor(sessionId, cursor) {
    set((state) => ({
      browserCursors: { ...state.browserCursors, [sessionId]: cursor },
    }))
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
        // Provider descriptors and per-session configs go stale the same way
        // (e.g. daemon restarted with new probe results), so refresh those
        // too — otherwise chips keep showing yesterday's choices.
        void get().loadSessions()
        void get().loadProviders()
        void get().refreshConfigs()
        void import('@/lib/rooms').then(({ syncRooms }) => syncRooms())
      }
    })
    socket.onFrame((frame) => handleFrame(frame, set, get))
    socket.connect()
    void get().loadProviders()
    void get().loadSessions()
    // Adopt the daemon's room roster (and push up any local-only rooms) once
    // the socket is connecting; WS RoomUpsert/RoomDeleted keep it live.
    void import('@/lib/rooms').then(({ syncRooms }) => syncRooms())
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
      // An approval for a session the list never carried (hidden room
      // channel/worker): register the row so the card is navigable — hidden
      // rows stay out of the workspace lists, but rooms and the pager find
      // them through the roster.
      if (
        event.kind === 'permission_required' &&
        !get().sessions.some((session) => session.id === event.session_id)
      ) {
        void get().ensureSessionRow(event.session_id)
      }
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
      // `browser_cursor_moved` / `browser_cursor_clicked` drive the live
      // pointer overlay over the mirrored page — transient UI, not timeline.
      if (event.kind === 'browser_cursor_moved' || event.kind === 'browser_cursor_clicked') {
        const payload = event.payload as Record<string, unknown>
        const x = typeof payload['x'] === 'number' ? payload['x'] : undefined
        const y = typeof payload['y'] === 'number' ? payload['y'] : undefined
        if (x !== undefined && y !== undefined) {
          set((state) => ({
            browserCursors: {
              ...state.browserCursors,
              [event.session_id]: {
                x,
                y,
                button: typeof payload['button'] === 'string' ? payload['button'] : 'left',
                pressed: payload['pressed'] === true,
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
          // The turn ended: apply the next queued follow-up, if any.
          get().flushQueue(frame.payload.session.id)
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

    // Room rosters sync through the daemon: another client (or this one)
    // created/edited/deleted a room. Dynamic import — rooms.ts depends on the
    // store, so a static cycle is avoided.
    case 'RoomUpsert': {
      void import('@/lib/rooms').then(({ applyRoomUpsert }) =>
        applyRoomUpsert(frame.payload.room),
      )
      return
    }
    case 'RoomDeleted': {
      void import('@/lib/rooms').then(({ applyRoomDeleted }) =>
        applyRoomDeleted(frame.payload.room_id),
      )
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
        // Idle (not merely terminal): the agent is waiting — apply the next
        // queued follow-up.
        if (status === 'idle') get().flushQueue(frame.payload.session_id)
      }
      return
    }

    case 'SessionError': {
      setNotice(set, frame.payload.session_id, readableAgentError(frame.payload.message))
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
