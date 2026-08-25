/**
 * Home deep module — small interface, large implementation.
 *
 * One function, `deriveHomeView`, hides all the ranking, headline,
 * preview, and count logic that previously lived scattered across
 * StationHome. Callers learn one shape; tests hit one seam.
 *
 * Depth via:
 *  - 1 public function (vs 7 helpers before)
 *  - All conversation-derived helpers are internal
 *  - Pure: no hooks, no store reads — `getConversation` is injected
 *
 * The module is provider-agnostic: it never mentions "model" or "effort".
 */

import { sessionUIState, uiStateRank, type UIState } from './sessionState'
import { describeApproval } from './approvals'
import type { Conversation } from '@/types/conversation'
import type { Session } from '@/types/session'
import type { ConnectionState } from '@/types/protocol'

export type HomeFilter = 'all' | 'active' | 'attention' | 'starred'

export interface HomeCounts {
  running: number
  attention: number
  paused: number
  total: number
}

export interface AttentionEntry {
  session: Session
  uiState: UIState
  headline: string
  providerName: string
  idleFor?: string
}

export interface ActiveEntry {
  session: Session
  uiState: UIState
  task?: string
  runtime: string
}

export interface WorkspaceGroup {
  id: string
  name: string
  project: string | null
  sessions: Array<{ session: Session; uiState: UIState }>
  counts: { total: number; attention: number; running: number }
}

export interface HomeView {
  counts: HomeCounts
  attention: AttentionEntry[]
  active: ActiveEntry[]
  filtered: Array<{ session: Session; uiState: UIState }>
  workspaces: WorkspaceGroup[]
  hasLive: boolean
}

function previewFor(sessionId: string, getConversation: (id: string) => Conversation): string | undefined {
  const conversation = getConversation(sessionId)
  for (let i = conversation.messages.length - 1; i >= 0; i--) {
    const msg = conversation.messages[i]
    for (const part of msg.parts) {
      if (part.kind === 'text' && part.text.trim()) return part.text.trim().slice(0, 88)
      if (part.kind === 'reasoning' && part.text.trim()) return part.text.trim().slice(0, 72)
    }
  }
  return undefined
}

function taskFor(sessionId: string, getConversation: (id: string) => Conversation): string | undefined {
  const conversation = getConversation(sessionId)
  for (const msg of conversation.messages) {
    if (msg.role !== 'user') continue
    for (const part of msg.parts) {
      if (part.kind === 'text' && part.text.trim()) {
        const t = part.text.trim()
        if (t.startsWith('/')) continue
        return t.slice(0, 96)
      }
    }
  }
  return undefined
}

function lastErrorOf(conv: Conversation): string | undefined {
  for (let i = conv.messages.length - 1; i >= 0; i--) {
    for (let p = conv.messages[i].parts.length - 1; p >= 0; p--) {
      const part = conv.messages[i].parts[p]
      if (part.kind === 'error') return part.message
    }
  }
  return undefined
}

function openApprovalOf(conv: Conversation) {
  for (let i = conv.messages.length - 1; i >= 0; i--) {
    for (let p = conv.messages[i].parts.length - 1; p >= 0; p--) {
      const part = conv.messages[i].parts[p]
      if (part.kind === 'approval' && (part as { decision?: string }).decision === undefined) return part as { requestId: string; prompt: string; options: string[] }
    }
  }
  return undefined
}

function formatRuntime(ms: number): string {
  if (ms < 0) ms = 0
  const mins = Math.floor(ms / 60000)
  if (mins < 1) return '<1m'
  if (mins < 60) return `${mins}m`
  const hrs = Math.floor(mins / 60)
  return `${hrs}h ${mins % 60}m`
}

export function deriveHomeView(params: {
  sessions: Session[]
  connection: ConnectionState
  search: string
  filter: HomeFilter
  starredSet: Set<string>
  getConversation: (id: string) => Conversation
  providerNameFor: (agentId: string) => string
  notices: Record<string, string | undefined>
  now: number
}): HomeView {
  const { sessions, connection, search, filter, starredSet, getConversation, providerNameFor, notices, now } = params

  const withStates = sessions
    .filter((s) => s.status !== 'archived')
    .map((session) => ({
      session,
      uiState: sessionUIState(session, getConversation(session.id), connection) as UIState,
    }))

  let running = 0
  let attention = 0
  let paused = 0
  for (const { uiState: u } of withStates) {
    if (u === 'working' || u === 'starting' || u === 'resuming') running++
    if (u === 'approval' || u === 'input' || u === 'failed' || u === 'paused') attention++
    if (u === 'paused') paused++
  }

  const hasLive = withStates.some(({ uiState: u }) => u === 'working' || u === 'starting' || u === 'resuming' || u === 'paused' || u === 'failed')

  const attentionEntries: AttentionEntry[] = withStates
    .filter(({ uiState: u }) => u === 'approval' || u === 'failed' || u === 'input' || u === 'paused')
    .sort((a, b) => {
      const rank = (s: string) => (s === 'failed' || s === 'approval' ? 0 : s === 'input' ? 1 : 2)
      const ra = rank(a.uiState)
      const rb = rank(b.uiState)
      if (ra !== rb) return ra - rb
      return b.session.updated_at.localeCompare(a.session.updated_at)
    })
    .map(({ session, uiState }) => {
      const conv = getConversation(session.id)
      const providerName = providerNameFor(session.agent)
      let headline: string
      if (uiState === 'failed') headline = notices[session.id] ?? lastErrorOf(conv) ?? 'The agent hit an error'
      else if (uiState === 'input') headline = 'Waiting for your reply'
      else if (uiState === 'paused') {
        headline = session.resume_command ? `Paused · ${session.resume_command.slice(0, 56)}` : `Paused — tap Resume to continue with ${providerName}`
      } else {
        const approval = openApprovalOf(conv)
        const view = approval ? describeApproval(approval.prompt, approval.options as unknown as string[]) : undefined
        // describeApproval expects ApprovalPart, but we have raw; fallback
        headline = (view as { context?: string; question?: string } | undefined)?.context ?? (view as { context?: string; question?: string } | undefined)?.question ?? 'Approval requested'
      }
      const updatedMs = new Date(session.updated_at).getTime()
      const idleFor = !Number.isNaN(updatedMs) ? formatRuntime(now - updatedMs) : undefined
      return { session, uiState, headline, providerName, idleFor }
    })

  const activeEntries: ActiveEntry[] = withStates
    .filter(({ uiState: u }) => u === 'working' || u === 'starting' || u === 'resuming')
    .sort((a, b) => b.session.updated_at.localeCompare(a.session.updated_at))
    .map(({ session, uiState }) => {
      const startedMs = new Date(session.created_at).getTime()
      return {
        session,
        uiState,
        task: taskFor(session.id, getConversation),
        runtime: formatRuntime(now - startedMs),
      }
    })

  let filtered = [...withStates]
  if (filter === 'active') {
    filtered = filtered.filter(({ uiState: u }) => u === 'working' || u === 'starting' || u === 'resuming' || u === 'approval' || u === 'input' || u === 'paused')
  } else if (filter === 'attention') {
    filtered = filtered.filter(({ uiState: u }) => u === 'approval' || u === 'failed' || u === 'input' || u === 'paused')
  } else if (filter === 'starred') filtered = filtered.filter(({ session }) => starredSet.has(session.id))

  const needle = search.trim().toLowerCase()
  if (needle) {
    filtered = filtered.filter(
      ({ session: s }) =>
        s.name.toLowerCase().includes(needle) ||
        s.agent.toLowerCase().includes(needle) ||
        (s.project ?? '').toLowerCase().includes(needle) ||
        (previewFor(s.id, getConversation) ?? '').toLowerCase().includes(needle),
    )
  }

  filtered.sort((a, b) => uiStateRank(a.uiState) - uiStateRank(b.uiState) || b.session.updated_at.localeCompare(a.session.updated_at))

  // Workspaces: group filtered sessions by project (the user's "workspace")
  const byProject = new Map<string, Array<{ session: Session; uiState: UIState }>>()
  for (const entry of filtered) {
    const key = entry.session.project ?? '__inbox__'
    const list = byProject.get(key)
    if (list) list.push(entry)
    else byProject.set(key, [entry])
  }
  const workspaces: WorkspaceGroup[] = [...byProject.entries()]
    .map(([project, list]) => {
      const name = project === '__inbox__' ? 'Inbox' : project.split('/').pop() ?? project
      let wAttention = 0
      let wRunning = 0
      for (const { uiState: u } of list) {
        if (u === 'approval' || u === 'failed' || u === 'input' || u === 'paused') wAttention++
        if (u === 'working' || u === 'starting' || u === 'resuming') wRunning++
      }
      // Sort sessions inside workspace by rank
      list.sort((a, b) => uiStateRank(a.uiState) - uiStateRank(b.uiState) || b.session.updated_at.localeCompare(a.session.updated_at))
      return {
        id: project,
        name,
        project: project === '__inbox__' ? null : project,
        sessions: list,
        counts: { total: list.length, attention: wAttention, running: wRunning },
      }
    })
    .sort((a, b) => {
      // Workspaces with attention first, then most recent session
      if (a.counts.attention !== b.counts.attention) return b.counts.attention - a.counts.attention
      const aLatest = a.sessions[0]?.session.updated_at ?? ''
      const bLatest = b.sessions[0]?.session.updated_at ?? ''
      return bLatest.localeCompare(aLatest)
    })

  return {
    counts: { running, attention, paused, total: withStates.length },
    attention: attentionEntries,
    active: activeEntries,
    filtered,
    workspaces,
    hasLive,
  }
}
