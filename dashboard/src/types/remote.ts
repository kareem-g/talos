/**
 * Remote control domain — provider-agnostic normalized model for the Zcode-style UX.
 *
 * The UI consumes these normalized objects. Provider-specific behavior stays behind
 * backend adapters (`providers/*`, `agents/*`). Nothing here branches on provider id.
 *
 * Hierarchy mirrors the spec:
 *   Project → Session → {AgentState, Conversation, ToolCalls, Terminal, Model, Reasoning, Approvals, Connection}
 */

import type { Activity } from './conversation'
import type { ConnectionState } from './protocol'
import type { Provider, SessionConfig } from './provider'
import type { Session, SessionStatus } from './session'

/** Immediate human-readable agent status. See spec § Agent status UI. */
export type AgentState =
  | 'ready'
  | 'thinking'
  | 'planning'
  | 'working'
  | 'editing'
  | 'running_command'
  | 'waiting_for_approval'
  | 'waiting_for_input'
  | 'completed'
  | 'failed'
  | 'stopped'
  | 'reconnecting'
  | 'offline'

export interface RemoteSession {
  session: Session
  provider?: Provider
  config?: SessionConfig
  activity?: Activity
  agentState: AgentState
  connectionState: ConnectionState
}

/** Reachable endpoint for pairing — filled by the resolver in phase 8. */
export type EndpointSource =
  | 'explicit'
  | 'cloudflare'
  | 'tailnet_magic_dns'
  | 'tailnet_ipv4'
  | 'tailnet_ipv6'
  | 'lan'
  | 'localhost'

export interface ReachableEndpoint {
  baseUrl: string
  source: EndpointSource
  host: string
  port: number
  secure: boolean
  reachable: boolean
}

export interface AgentStateDisplay {
  label: string
  detail?: string
  tone: 'green' | 'orange' | 'red' | 'dim'
  pulse: boolean
}

/** Single source for status copy — no duplication in components. */
export function agentStateDisplay(state: AgentState, detail?: string): AgentStateDisplay {
  switch (state) {
    case 'ready':
      return { label: 'Ready', tone: 'dim', pulse: false }
    case 'thinking':
      return { label: 'Thinking', detail, tone: 'orange', pulse: true }
    case 'planning':
      return { label: 'Planning', detail, tone: 'orange', pulse: true }
    case 'working':
      return { label: 'Working', detail, tone: 'green', pulse: true }
    case 'editing':
      return { label: 'Editing files', detail, tone: 'green', pulse: true }
    case 'running_command':
      return { label: 'Running', detail, tone: 'green', pulse: true }
    case 'waiting_for_approval':
      return { label: 'Waiting for approval', tone: 'orange', pulse: false }
    case 'waiting_for_input':
      return { label: 'Waiting for input', tone: 'orange', pulse: false }
    case 'completed':
      return { label: 'Completed', tone: 'dim', pulse: false }
    case 'failed':
      return { label: 'Failed', tone: 'red', pulse: false }
    case 'stopped':
      return { label: 'Stopped', tone: 'dim', pulse: false }
    case 'reconnecting':
      return { label: 'Reconnecting', tone: 'orange', pulse: true }
    case 'offline':
      return { label: 'Offline', tone: 'red', pulse: false }
  }
}

/**
 * Derive the prominent agent state from backend truth.
 *
 * Priority: connection overrides everything (reconnecting/offline) → blocked session
 * statuses → live activity → active/finished fallback.
 */
export function deriveAgentState(
  session: Session,
  activity: Activity | undefined,
  connection: ConnectionState,
): AgentState {
  if (connection === 'reconnecting' || connection === 'connecting') return 'reconnecting'
  if (connection === 'disconnected' || connection === 'error' || connection === 'idle')
    return 'offline'
  // unauthorized is pairing issue, not agent offline — keep session truth but surface via connection UI
  if (session.status === 'waiting_for_approval') return 'waiting_for_approval'
  if (session.status === 'waiting_for_input') return 'waiting_for_input'
  if (session.status === 'error') return 'failed'
  if (session.status === 'exited' || session.status === 'archived') return 'completed'
  if (session.status === 'needs_resume') return 'stopped'
  if (session.status === 'idle') return 'ready'

  // running / starting with live activity
  if (activity) {
    const label = activity.label.toLowerCase()
    if (label.includes('thinking')) return 'thinking'
    if (label.includes('planning')) return 'planning'
    if (label.includes('editing') || label.includes('file')) return 'editing'
    if (label.includes('running')) return 'running_command'
    if (label.includes('waiting') && label.includes('approval')) return 'waiting_for_approval'
    return 'working'
  }

  if (session.status === 'running' || session.status === 'starting') return 'working'
  return 'ready'
}

export function sessionStatusToAgentState(status: SessionStatus): AgentState {
  switch (status) {
    case 'starting':
    case 'running':
      return 'working'
    case 'waiting_for_approval':
      return 'waiting_for_approval'
    case 'waiting_for_input':
      return 'waiting_for_input'
    case 'idle':
      return 'ready'
    case 'needs_resume':
      return 'stopped'
    case 'error':
      return 'failed'
    case 'archived':
    case 'exited':
      return 'completed'
  }
}

/** Whether this agent state counts as “working” for send→stop morphing. */
export function isWorkingState(state: AgentState): boolean {
  return (
    state === 'working' ||
    state === 'thinking' ||
    state === 'planning' ||
    state === 'editing' ||
    state === 'running_command'
  )
}

/** Group sessions for Project → Session hierarchy used by snapshot workspaces. */
export interface ProjectGroup {
  id: string
  name: string
  path: string
  sessions: Session[]
}

export function groupSessionsByProject(sessions: Session[]): ProjectGroup[] {
  const groups = new Map<string, ProjectGroup>()
  for (const session of sessions) {
    const path = session.project ?? 'No project'
    const key = path
    const existing = groups.get(key)
    if (existing) existing.sessions.push(session)
    else
      groups.set(key, {
        id: key,
        name: key === 'No project' ? 'No project' : key.split('/').pop() ?? key,
        path,
        sessions: [session],
      })
  }
  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name))
}
