/**
 * Session chat command dispatch — ONE implementation shared by desktop
 * (`SessionWorkspace`) and mobile (`SessionView`) so `/orchestrator`,
 * `#RoomName`, `@worker`, `/side`, and `/btw` behave identically everywhere.
 *
 * A draft is either:
 *   - a dispatch command → handled here (room run, side session, own fan-out);
 *   - plain text → sent to the session's agent (with `# Name (id)` context
 *     expansion), or queued while the agent is busy.
 *
 * The handler returns `false` for an incomplete command (e.g. `/orchestrator`
 * with no task) so the composer keeps what was typed instead of swallowing it.
 */

import { useStore } from '@/store'
import { sessionsApi } from '@/lib/api'
import { haptic } from '@/lib/nativeUX'
import {
  findRoomMention,
  getActiveRoom,
  getRooms,
  mentionedWorkers,
  roomInWorkspace,
  runOrchestrator,
  runRoomTask,
} from '@/lib/rooms'
import { getSideSessionId, setSideSessionId } from '@/lib/sideSession'
import type { AttachmentRef } from '@/types/conversation'
import type { Session } from '@/types/session'

export interface SessionSendDeps {
  /** Navigate to a session the dispatch used (a room channel or side thread). */
  openSessionView: (sessionId: string) => void
  /** Reveal the project's side thread after /side or /btw. */
  revealSideSession: (sideId: string | null) => void
}

export interface SessionSendHandlers {
  /** Idle path: dispatch commands now, else send to the agent. */
  send: (text: string, attachments?: AttachmentRef[]) => boolean
  /**
   * Busy path: dispatch commands (independent of the busy agent) fire now;
   * plain text waits in the session's follow-up queue.
   */
  queue: (text: string, attachments?: AttachmentRef[]) => boolean
}

function seedNotice(sessionId: string, message: string): void {
  useStore.setState((state) => ({
    notices: { ...state.notices, [sessionId]: message },
  }))
}

/**
 * Open `/side <prompt>` or ping `/btw <note>`: route to the project's side
 * session, creating it (same agent + project as the current session) when it
 * does not exist yet, resuming it when it went idle, then sending. Resolves to
 * the side session id (null when it could not be reached) so the shell can
 * reveal it in whatever way fits — the desktop opens the right-rail tab,
 * mobile navigates to the thread.
 */
async function deliverToSideSession(session: Session, prompt: string): Promise<string | null> {
  const store = useStore.getState()
  const sideId = getSideSessionId(session.project)
  if (!sideId) {
    try {
      const created = await store.createSession({
        agent: session.agent,
        project: session.project ?? undefined,
        prompt,
      })
      setSideSessionId(session.project, created.id)
      return created.id
    } catch {
      seedNotice(session.id, 'Could not start a side session for this workspace.')
      return null
    }
  }
  const existing = store.sessions.find((candidate) => candidate.id === sideId)
  const live =
    existing !== undefined &&
    ['running', 'starting', 'resuming'].includes(existing.status)
  if (live) {
    store.sendPrompt(sideId, prompt)
    return sideId
  }
  const resumed = await store.resumeSession(sideId)
  if (resumed) store.sendPrompt(sideId, prompt)
  return sideId
}

/** Expand `# Name (id)` references into the referenced sessions' context. */
export async function expandSessionMentions(sessionId: string, text: string): Promise<string> {
  const ids = Array.from(text.matchAll(/#[^#\n]*\(([0-9a-f-]{8,})\)/g))
    .map((match) => match[1])
    .filter((id) => id !== sessionId)
  if (ids.length === 0) return text
  const blocks: string[] = []
  for (const id of ids) {
    try {
      const history = await sessionsApi.history(id)
      const lines = history.messages
        .filter((m) => m.role !== 'system')
        .map((m) => `${m.role === 'user' ? 'You' : 'Agent'}: ${(m.content ?? '').slice(0, 400)}`)
        .filter((line) => line.length > 3)
      if (lines.length) blocks.push(`[Context from session ${id}:\n${lines.slice(-10).join('\n')}\n]`)
    } catch {
      /* skip unreachable sessions */
    }
  }
  return blocks.length ? `${blocks.join('\n\n')}\n\n${text}` : text
}

/** A room whose channel is this very session — the room you are chatting in. */
function roomOfSession(sessionId: string) {
  return getRooms().find((room) => room.sessionId === sessionId)
}

/** The room a dispatch targets: the room whose channel you are in wins, else
 * the active room when it belongs to this workspace. */
function dispatchTarget(sessionId: string) {
  const channelRoom = roomOfSession(sessionId)
  if (channelRoom) return channelRoom
  const session = useStore.getState().sessions.find((s) => s.id === sessionId)
  const active = getActiveRoom()
  if (active && active.workers.length > 0 && roomInWorkspace(active, session?.project ?? null)) {
    return active
  }
  return undefined
}

/**
 * Build the send + queue handlers for one session. Pure logic + store calls,
 * no React — safe to memoize and identical on every shell.
 */
export function createSessionSendHandlers(
  session: Session,
  deps: SessionSendDeps,
): SessionSendHandlers {
  const sendToRoomAndOpen = (room: Parameters<typeof runRoomTask>[1], task: string) => {
    void runRoomTask(session.id, room, task).then((channelId) => {
      if (channelId && channelId !== session.id) deps.openSessionView(channelId)
    })
  }

  const send = (text: string, attachments: AttachmentRef[] = []): boolean => {
    const trimmed = text.trim()
    // Confirms the tap physically on a phone; no-op in the browser.
    if (trimmed.length > 0) haptic('tap')
    const sideMatch = /^\/side\s+([\s\S]+)$/.exec(trimmed)
    const btwMatch = /^\/btw\s+([\s\S]+)$/.exec(trimmed)
    const orchestratorMatch = /^\/orchestrator(?:\s+([\s\S]+))?$/.exec(trimmed)
    if (sideMatch) {
      void deliverToSideSession(session, sideMatch[1].trim() || 'I opened a side session.').then(
        (sideId) => deps.revealSideSession(sideId),
      )
      return true
    }
    if (btwMatch) {
      void deliverToSideSession(session, btwMatch[1].trim()).then((sideId) =>
        deps.revealSideSession(sideId),
      )
      return true
    }
    const builtinMatch = /^\/(summarize|review|plan|worker)(?:\s+([\s\S]+))?$/.exec(trimmed)
    if (builtinMatch) {
      const command = builtinMatch[1]
      const task = builtinMatch[2]?.trim() ?? ''
      if (command === 'summarize') {
        seedNotice(
          session.id,
          '/summarize runs automatically when a session history gets long; it compresses context into project memory.',
        )
        return true
      }
      if (command === 'review') {
        const prompt =
          task ||
          'Review the current uncommitted changes in this repository (use git status and git diff to see them) and report concrete findings with file references.'
        seedNotice(session.id, 'Starting a code review…')
        void sessionsApi
          .spawnSubagent(session.id, { prompt, role: 'reviewer' })
          .catch(() => seedNotice(session.id, 'Could not start the reviewer agent.'))
        return true
      }
      if (!task) {
        seedNotice(
          session.id,
          `Give /${command} a task — e.g. "/${command} ${command === 'plan' ? 'add user auth to the API' : 'fix the flaky tests in ./tests'}".`,
        )
        return false
      }
      const role = command === 'plan' ? 'planner' : 'worker'
      seedNotice(session.id, `Starting the ${role}…`)
      void sessionsApi
        .spawnSubagent(session.id, { prompt: task, role })
        .catch(() => seedNotice(session.id, `Could not start the ${role} agent.`))
      return true
    }
    if (orchestratorMatch) {
      const task = orchestratorMatch[1]?.trim()
      const target = dispatchTarget(session.id)
      if (target && target.workers.length > 0) {
        if (!task) {
          seedNotice(
            session.id,
            `Give ${target.name} a task — e.g. "/orchestrator refactor the auth module".`,
          )
          return false
        }
        seedNotice(session.id, `Handing work to ${target.name} — ${task.slice(0, 80)}…`)
        sendToRoomAndOpen(target, task)
        return true
      }
      if (!task) {
        seedNotice(
          session.id,
          'Give /orchestrator a task — e.g. "/orchestrator refactor the auth module".',
        )
        return false
      }
      const error = runOrchestrator(session.id, task)
      if (error) {
        seedNotice(session.id, error)
        return false
      }
      return true
    }
    // #RoomName <task> passes the work to that room and opens its channel.
    const roomMention = findRoomMention(trimmed, session.project ?? null)
    if (roomMention) {
      seedNotice(
        session.id,
        `#${roomMention.room.name} — handing "${roomMention.task.slice(0, 60)}…" to the room.`,
      )
      sendToRoomAndOpen(roomMention.room, roomMention.task)
      return true
    }
    // Inside a room's own channel, @worker mentions narrow a dispatch to just
    // those workers (same addressing as the Rooms rail).
    const channelRoom = roomOfSession(session.id)
    if (channelRoom) {
      const mentioned = mentionedWorkers(trimmed, channelRoom.workers.map((w) => w.name))
      if (mentioned.length > 0) {
        void runRoomTask(session.id, channelRoom, trimmed, mentioned)
        return true
      }
    }
    void expandSessionMentions(session.id, text).then((augmented) =>
      useStore.getState().sendPrompt(session.id, augmented, attachments),
    )
    return true
  }

  const queue = (text: string, attachments: AttachmentRef[] = []): boolean => {
    const trimmed = text.trim()
    const dispatchesRoom =
      /^\/orchestrator(?:\s|$)/.test(trimmed) || findRoomMention(trimmed, session.project ?? null) !== null
    const dispatchesBuiltin = /^\/(review|plan|worker|summarize)(?:\s|$)/.test(trimmed)
    if (dispatchesRoom || dispatchesBuiltin || /^\/side\s+/.test(trimmed) || /^\/btw\s+/.test(trimmed)) {
      return send(text, attachments)
    }
    useStore.getState().queueMessage(session.id, text, attachments)
    return true
  }

  return { send, queue }
}
