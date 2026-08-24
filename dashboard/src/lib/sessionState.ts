/**
 * The UI session state machine.
 *
 * The backend reports a session status, but the status alone does not tell the
 * truth the user needs: a session can be `running` while an approval card sits
 * unanswered in its transcript, and `idle` just means "the agent process is
 * alive". This module merges the three sources of truth — connection, session
 * status, and the conversation itself (open approvals) — into one state the
 * whole UI renders from.
 *
 * Every screen answers the same three questions from this one value:
 *   What is happening?  Can I interact?  What should I do next?
 */

import type { Conversation } from '@/types/conversation'
import type { ConnectionState } from '@/types/protocol'
import type { Session } from '@/types/session'

/**
 * The states the UI can be in, in the order they matter:
 * connection problems override everything, then attention (the agent is
 * blocked on you), then liveness, then the end states.
 */
export type UIState =
  | 'reconnecting'
  | 'offline'
  | 'approval'
  | 'input'
  | 'starting'
  | 'working'
  | 'paused'
  | 'resuming'
  | 'failed'
  | 'ended'
  | 'archived'
  | 'ready'

export interface UIStateDisplay {
  /** Two-to-three word state name, sentence case. */
  label: string
  /** One line saying what to do next, or undefined when obvious. */
  hint?: string
  tone: 'green' | 'orange' | 'red' | 'dim'
  /** True only while something is genuinely in flight. */
  pulse: boolean
}

/** True when the transcript holds an approval the user has not answered. */
export function hasOpenApprovals(conversation: Conversation | undefined): boolean {
  if (!conversation) return false
  for (let index = conversation.messages.length - 1; index >= 0; index -= 1) {
    for (const part of conversation.messages[index].parts) {
      if (part.kind === 'approval' && part.decision === undefined) return true
    }
  }
  return false
}

/** The id of the newest unanswered approval, for scroll-to actions. */
export function firstOpenApprovalId(conversation: Conversation | undefined): string | undefined {
  if (!conversation) return undefined
  for (let index = conversation.messages.length - 1; index >= 0; index -= 1) {
    const message = conversation.messages[index]
    for (let partIndex = message.parts.length - 1; partIndex >= 0; partIndex -= 1) {
      const part = message.parts[partIndex]
      if (part.kind === 'approval' && part.decision === undefined) return part.requestId
    }
  }
  return undefined
}

/**
 * Merge the three sources of truth into one UI state.
 *
 * Priority order is the whole point:
 *   1. Connection trouble — nothing else matters if frames are not flowing.
 *   2. Open approvals — the agent says it is running, but it is blocked on you.
 *      Status frames lag the actual permission request, so the transcript wins.
 *   3. Session status — the backend's own state machine.
 */
export function sessionUIState(
  session: Session,
  conversation: Conversation | undefined,
  connection: ConnectionState,
): UIState {
  if (connection === 'reconnecting' || connection === 'connecting') return 'reconnecting'
  if (
    connection === 'disconnected' ||
    connection === 'error' ||
    connection === 'idle' ||
    connection === 'offline'
  ) {
    return 'offline'
  }

  const status = session.status
  if (status === 'waiting_for_approval' || hasOpenApprovals(conversation)) return 'approval'
  if (status === 'waiting_for_input') return 'input'
  if (status === 'resuming') return 'resuming'
  if (status === 'starting') return 'starting'
  if (status === 'running') return 'working'
  if (status === 'needs_resume') return 'paused'
  if (status === 'error') return 'failed'
  if (status === 'exited') return 'ended'
  if (status === 'archived') return 'archived'
  return 'ready'
}

/** Copy and tone for each state. Sentence case, active voice, no filler. */
export function uiStateDisplay(state: UIState): UIStateDisplay {
  switch (state) {
    case 'reconnecting':
      return { label: 'Reconnecting', hint: 'Connection lost — retrying', tone: 'orange', pulse: true }
    case 'offline':
      return { label: 'Offline', hint: 'Not connected to the station', tone: 'red', pulse: false }
    case 'approval':
      return { label: 'Needs approval', hint: 'Respond to the request above', tone: 'orange', pulse: false }
    case 'input':
      return { label: 'Waiting for you', hint: 'Type below to continue', tone: 'orange', pulse: false }
    case 'starting':
      return { label: 'Starting', tone: 'green', pulse: true }
    case 'working':
      return { label: 'Working', tone: 'green', pulse: true }
    case 'paused':
      return { label: 'Paused', hint: 'Resume to continue this session', tone: 'orange', pulse: false }
    case 'resuming':
      return { label: 'Resuming', tone: 'green', pulse: true }
    case 'failed':
      return { label: 'Failed', hint: 'Retry to restart the agent', tone: 'red', pulse: false }
    case 'ended':
      return { label: 'Ended', hint: 'Resume to pick this session back up', tone: 'dim', pulse: false }
    case 'archived':
      return { label: 'Archived', tone: 'dim', pulse: false }
    case 'ready':
      return { label: 'Ready', hint: 'Type below to start the next task', tone: 'dim', pulse: false }
  }
}

/**
 * Ranking for rosters and pagers: the sessions that need a human first, then
 * the ones making progress, then everything else. Lower sorts first.
 */
export function uiStateRank(state: UIState): number {
  switch (state) {
    case 'approval':
    case 'failed':
      return 0
    case 'input':
      return 1
    case 'working':
    case 'starting':
    case 'resuming':
      return 2
    case 'reconnecting':
    case 'offline':
      return 3
    case 'paused':
    case 'ready':
      return 4
    case 'ended':
    case 'archived':
      return 5
  }
}

/** States where the agent is alive and mid-turn. */
export function isLiveState(state: UIState): boolean {
  return state === 'working' || state === 'starting'
}
