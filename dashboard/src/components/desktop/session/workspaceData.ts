/**
 * Data adapters for the right-pane Agent Workspace.
 *
 * Everything here derives from real daemon-backed state:
 *  - plan steps + live statuses from conversation `plan` parts
 *  - the agent/subagent roster from store sessions + providers
 *  - activity from conversation events (tools, commands, plans, approvals)
 *
 * Todos do not exist as a first-class agent event yet, so the todo list is
 * built from plan steps through `buildTodoList`, then layered with local
 * completion overrides (`useTodos`) — a clearly separated adapter that a real
 * todo event feed can replace later without touching the views.
 *
 * Pure functions take a `Conversation` / `Message[]` argument so they are
 * testable without the store; the `*FromSession` wrappers read live state.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { getConversation, useStore } from '@/store'
import { gitApi } from '@/lib/api'
import type { Conversation, FileChangePart, Message, ToolPart } from '@/types/conversation'
import type { Session } from '@/types/session'

/* ── Types ───────────────────────────────────────────────────────────────── */

export type TaskStatus = 'pending' | 'in_progress' | 'completed' | 'blocked' | 'failed'

export interface TaskItem {
  id: string
  title: string
  status: TaskStatus
  /** Message timestamp the plan lives in, when known. */
  createdAt?: string
}

export type TodoPriority = 'high' | 'medium' | 'low'

export interface TodoItem {
  id: string
  title: string
  status: TaskStatus
  priority: TodoPriority
  /** Agent responsible for the task. */
  assignee: string
  /** Created by the primary agent or a subagent. */
  source: 'primary' | 'subagent'
  /** Related file, when the data layer knows one. */
  relatedFile?: string
  createdAt?: string
  updatedAt?: string
}

export type TodoSort = 'priority' | 'created' | 'updated' | 'agent' | 'status'

export type ActivityKind =
  | 'started'
  | 'tool'
  | 'command'
  | 'plan'
  | 'approval'
  | 'file'
  | 'error'
  | 'completed'

export interface ActivityEvent {
  timestamp: string
  label: string
  detail?: string
  kind: ActivityKind
}

export type AgentStatus =
  | 'thinking'
  | 'working'
  | 'waiting'
  | 'completed'
  | 'blocked'
  | 'failed'
  | 'paused'
  | 'idle'

export interface AgentSummary {
  id: string
  name: string
  agentType: string
  primary: boolean
  status: AgentStatus
  /** What the agent is doing right now (conversation activity label). */
  currentTask?: string
  detail?: string
  startedAt: string
  lastActivityAt: string
}

/* ── Plan steps (pure, testable) ─────────────────────────────────────────── */

/**
 * Newest `plan` part in the conversation wins — agents replace their plan each
 * turn. A missing `entries` status renders as pending.
 *
 * When the agent does NOT emit a structured `plan` part (Claude/LongCat and
 * opencode/LongCat write plans as prose), we fall back to the agent's REAL
 * executed actions — the tool, command and file-change parts in the transcript —
 * so the todo list always reflects actual AI events, never parsed markdown.
 */
export function tasksFromPlanParts(messages: Message[]): TaskItem[] {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    for (const part of [...messages[i].parts].reverse()) {
      if (part.kind !== 'plan') continue
      const plan = part as { steps: string[]; entries?: Array<{ content: string; status?: string }> }
      return plan.steps.map((step, idx) => {
        const entry = plan.entries?.find((e) => e.content === step)
        const raw = entry?.status
        const status: TaskItem['status'] =
          raw === 'completed' ? 'completed' : raw === 'in_progress' ? 'in_progress' : 'pending'
        return { id: `${i}-${idx}`, title: step, status, createdAt: messages[i].createdAt }
      })
    }
  }
  return tasksFromEvents(messages)
}

/**
 * Derive working tasks from the agent's REAL executed actions — the tool,
 * command and file-change parts. Each entry reflects an actual AI event with a
 * live status, so "todos" mirrors what the agent is genuinely doing (like the
 * chat timeline), for any CLI.
 */
function tasksFromEvents(messages: Message[]): TaskItem[] {
  const tasks: TaskItem[] = []
  for (let i = messages.length - 1; i >= 0 && tasks.length < 40; i -= 1) {
    const message = messages[i]
    if (message.role !== 'assistant') continue
    for (let j = message.parts.length - 1; j >= 0 && tasks.length < 40; j -= 1) {
      const part = message.parts[j]
      if (part.kind === 'tool') {
        tasks.push({
          id: `${i}-${j}`,
          title: part.name,
          status: part.status === 'ok' ? 'completed' : part.status === 'failed' ? 'failed' : 'in_progress',
          createdAt: message.createdAt,
        })
      } else if (part.kind === 'command') {
        tasks.push({
          id: `${i}-${j}`,
          title: `run ${part.command}`.slice(0, 80),
          status: part.status === 'ok' ? 'completed' : part.status === 'failed' ? 'failed' : 'in_progress',
          createdAt: message.createdAt,
        })
      } else if (part.kind === 'file') {
        tasks.push({
          id: `${i}-${j}`,
          title: part.path.split('/').pop() ?? part.path,
          status: part.ok ? 'completed' : 'failed',
          createdAt: message.createdAt,
        })
      } else if (part.kind === 'subagent') {
        tasks.push({
          id: part.id,
          title: part.name,
          status: part.status === 'running' ? 'in_progress' : part.status === 'failed' ? 'failed' : 'completed',
          createdAt: message.createdAt,
        })
      }
    }
  }
  return tasks
}

/** A subagent the agent spawned (from `Agent` tool parts in the transcript). */
export interface DerivedSubagent {
  id: string
  /** Human task label (the tool's `description`). */
  name: string
  /** `subagent_type` from the tool input, when present. */
  kind: string
  status: 'working' | 'completed' | 'failed'
  startedAt: string
}

/**
 * Subagents the agent actually spawned, read from subagent-tool invocations in
 * the conversation. Claude's `Agent` tool and opencode's task tools both carry a
 * `description` + `prompt` in their input, so we detect either: a tool literally
 * named `Agent`, or any tool whose input has a `prompt` plus a description. This
 * is a transcript-derived view — AgentDeck has no first-class subagent feed.
 */
export function deriveSubagents(messages: Message[]): DerivedSubagent[] {
  const out: DerivedSubagent[] = []
  for (const message of messages) {
    if (message.role !== 'assistant') continue
    for (const part of message.parts) {
      // First-class subagent events win.
      if (part.kind === 'subagent') {
        out.push({
          id: part.id,
          name: part.name,
          kind: part.kindType,
          status: part.status === 'running' ? 'working' : part.status,
          startedAt: part.startedAt,
        })
        continue
      }
      if (part.kind !== 'tool') continue
      const tool: ToolPart = part
      let input: Record<string, unknown> = {}
      try {
        input = JSON.parse(tool.input ?? '') as Record<string, unknown>
      } catch {
        /* not JSON — treat as a plain named tool */
      }
      const namedAgent = tool.name.toLowerCase() === 'agent'
      const taskTool =
        typeof input.prompt === 'string' &&
        (typeof input.description === 'string' || typeof input.subagent_type === 'string')
      if (!namedAgent && !taskTool) continue
      const name = typeof input.description === 'string'
        ? input.description
        : tool.name.toLowerCase() === 'agent'
          ? 'Subagent'
          : tool.name
      const kind = typeof input.subagent_type === 'string'
        ? input.subagent_type
        : typeof input.kind === 'string'
          ? input.kind
          : ''
      out.push({
        id: tool.toolId,
        name,
        kind,
        status: tool.status === 'failed' ? 'failed' : tool.status === 'ok' ? 'completed' : 'working',
        startedAt: message.createdAt,
      })
    }
  }
  return out
}

export function tasksFromConversation(sessionId: string): TaskItem[] {
  return tasksFromPlanParts(getConversation(sessionId).messages)
}

/* ── Plan details (title, related files) ─────────────────────────────────── */

export interface PlanInfo {
  title?: string
  createdAt?: string
  /** Files the agent changed in the same message after producing the plan. */
  relatedFiles: string[]
  stepCount: number
}

/** Metadata about the newest plan part, for the Plan view's header. */
export function latestPlanInfo(messages: Message[]): PlanInfo | undefined {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i]
    const planIndex = message.parts.findIndex((part) => part.kind === 'plan')
    if (planIndex === -1) continue
    const plan = message.parts[planIndex] as { title?: string; steps: string[] }
    const relatedFiles = message.parts
      .slice(planIndex + 1)
      .filter((part): part is FileChangePart => part.kind === 'file')
      .map((part) => part.path)
    return {
      title: plan.title,
      createdAt: message.createdAt,
      relatedFiles,
      stepCount: plan.steps.length,
    }
  }
  return undefined
}

/** The newest user prompt's text — the plan's objective, when present. */
export function latestUserPrompt(messages: Message[]): string | undefined {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i]
    if (message.role !== 'user') continue
    const text = message.parts
      .filter((part) => part.kind === 'text')
      .map((part) => (part as { text: string }).text)
      .join(' ')
      .trim()
    if (text) return text
  }
  return undefined
}

/* ── Todos (adapter over plan steps) ─────────────────────────────────────── */

const TODO_OVERRIDE_PREFIX = 'agentdeck-todo-'

function todoOverrideKey(sessionId: string, todoId: string): string {
  return `${TODO_OVERRIDE_PREFIX}${sessionId}-${todoId}`
}

function loadTodoOverrides(sessionId: string): Record<string, 'completed'> {
  try {
    const overrides: Record<string, 'completed'> = {}
    for (let i = 0; i < localStorage.length; i += 1) {
      const key = localStorage.key(i)
      if (!key?.startsWith(TODO_OVERRIDE_PREFIX + sessionId + '-')) continue
      if (localStorage.getItem(key) === '1') overrides[key.slice(TODO_OVERRIDE_PREFIX.length)] = 'completed'
    }
    return overrides
  } catch {
    return {}
  }
}

/**
 * The agent can only be blocked on the user: a `waiting_for_approval` /
 * `waiting_for_input` session freezes the active step, and an error part in the
 * newest assistant message marks it failed. Otherwise statuses come straight
 * from the plan entries.
 */
export function buildTodoList(
  session: Session,
  conversation?: Conversation,
  overrides: Record<string, 'completed'> = {},
): TodoItem[] {
  const messages = conversation?.messages ?? getConversation(session.id).messages
  const tasks = tasksFromPlanParts(messages)
  const blocked =
    session.status === 'waiting_for_approval' || session.status === 'waiting_for_input'
  const failed = hasRecentError(messages)
  const now = new Date().toISOString()

  // The active step is the one in progress, else the first pending one.
  let activeIndex = tasks.findIndex((t) => t.status === 'in_progress')
  if (activeIndex === -1) activeIndex = tasks.findIndex((t) => t.status === 'pending')

  return tasks.map((task, idx) => {
    let status = task.status
    if (idx === activeIndex && status !== 'completed') {
      if (failed) status = 'failed'
      else if (blocked) status = 'blocked'
    }
    if (overrides[task.id] === 'completed') status = 'completed'
    return {
      id: task.id,
      title: task.title,
      status,
      priority: 'medium',
      assignee: session.agent,
      source: 'primary',
      createdAt: task.createdAt,
      updatedAt: task.createdAt ?? now,
    }
  })
}

export function hasRecentError(messages: Message[]): boolean {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    if (messages[i].role !== 'assistant') continue
    return messages[i].parts.some((part) => part.kind === 'error')
  }
  return false
}

/** Live todo list with local completion overrides layered on top. */
export function useTodos(session: Session): {
  todos: TodoItem[]
  toggle: (todoId: string) => void
} {
  const revision = useStore((s) => s.revisions[session.id])
  void revision // re-derive when the conversation changes
  const [overrides, setOverrides] = useState<Record<string, 'completed'>>(() =>
    loadTodoOverrides(session.id),
  )

  // Compute inline — the revision subscription above re-renders on change, and
  // the derivation is a cheap walk of the plan steps.
  const todos = buildTodoList(session, getConversation(session.id), overrides)

  const toggle = useCallback(
    (todoId: string) => {
      setOverrides((current) => {
        const next = { ...current }
        if (next[todoId]) delete next[todoId]
        else next[todoId] = 'completed'
        try {
          localStorage.setItem(todoOverrideKey(session.id, todoId), next[todoId] ? '1' : '0')
        } catch {
          /* storage may be unavailable */
        }
        return next
      })
    },
    [session.id],
  )

  return { todos, toggle }
}

/* ── Activity stream (pure, testable) ────────────────────────────────────── */

function activityFromPart(part: Message['parts'][number]): ActivityEvent | null {
  switch (part.kind) {
    case 'tool':
      return {
        timestamp: '',
        label: part.status === 'failed' ? 'Tool failed' : `Using ${part.name}`,
        detail: part.status === 'failed' ? part.output?.slice(0, 160) : part.input?.slice(0, 160),
        kind: part.status === 'failed' ? 'error' : 'tool',
      }
    case 'command':
      return {
        timestamp: '',
        label: 'Ran command',
        detail: part.command,
        kind: part.status === 'failed' ? 'error' : 'command',
      }
    case 'file':
      return { timestamp: '', label: part.ok ? 'Changed file' : 'File change failed', detail: part.path, kind: 'file' }
    case 'plan': {
      const plan = part as { title?: string; steps: string[] }
      return {
        timestamp: '',
        label: plan.title ? `Plan: ${plan.title}` : 'Updated plan',
        detail: plan.steps.length ? `${plan.steps.length} step${plan.steps.length === 1 ? '' : 's'}` : undefined,
        kind: 'plan',
      }
    }
    case 'approval':
      return {
        timestamp: '',
        label: part.isQuestion ? 'Asked a question' : 'Waiting for approval',
        detail: part.prompt?.slice(0, 160),
        kind: 'approval',
      }
    case 'error':
      return { timestamp: '', label: 'Error', detail: part.message, kind: 'error' }
    case 'turn_summary':
      return { timestamp: '', label: 'Turn complete', detail: part.stopReason, kind: 'completed' }
    case 'subagent':
      return {
        timestamp: '',
        label: part.status === 'running' ? `Subagent: ${part.name}` : `Subagent done: ${part.name}`,
        detail: part.status === 'failed' ? 'failed' : part.kindType || undefined,
        kind: part.status === 'failed' ? 'error' : 'tool',
      }
    case 'progress':
      return {
        timestamp: '',
        label: part.percent !== undefined ? `Progress ${Math.round(part.percent)}%` : 'Progress',
        detail: part.message ?? part.step,
        kind: 'tool',
      }
    case 'search':
      return { timestamp: '', label: `Search: ${part.query}`, detail: part.results?.[0], kind: 'tool' }
    case 'git_commit':
      return { timestamp: '', label: `Commit ${part.sha}`, detail: part.message, kind: 'file' }
    case 'config_changed':
      return { timestamp: '', label: `Config: ${part.key} → ${part.value}`, kind: 'started' }
    default:
      return null
  }
}

/** Recent agent activity, newest first, for the Agents view's activity stream. */
export function deriveAgentActivity(messages: Message[], limit = 14): ActivityEvent[] {
  const events: ActivityEvent[] = []
  for (let i = messages.length - 1; i >= 0 && events.length < limit; i -= 1) {
    const message = messages[i]
    if (message.role !== 'assistant') continue
    for (let j = message.parts.length - 1; j >= 0 && events.length < limit; j -= 1) {
      const event = activityFromPart(message.parts[j])
      if (!event) continue
      events.push({ ...event, timestamp: message.createdAt })
    }
  }
  return events
}

export function deriveAgentActivityFromSession(sessionId: string, limit = 14): ActivityEvent[] {
  return deriveAgentActivity(getConversation(sessionId).messages, limit)
}

/* ── Agent roster ────────────────────────────────────────────────────────── */

const SUBAGENT_STATUS: Record<string, AgentStatus> = {
  running: 'working',
  starting: 'working',
  resuming: 'working',
  waiting_for_approval: 'blocked',
  waiting_for_input: 'waiting',
  idle: 'idle',
  error: 'failed',
  needs_resume: 'paused',
}

function agentStatusFor(status: string, hasActivity: boolean): AgentStatus {
  if (status === 'running') return hasActivity ? 'working' : 'thinking'
  return SUBAGENT_STATUS[status] ?? 'idle'
}

/**
 * The primary agent plus every session in the same workspace (the honest
 * "subagents" signal — AgentDeck has no subagent event stream, so the roster
 * is other sessions the agent or the user spawned in this project).
 */
export function useAgentSummaries(session: Session): {
  primary: AgentSummary
  subagents: AgentSummary[]
  here: Session[]
} {
  const sessions = useStore((s) => s.sessions)
  const providers = useStore((s) => s.providers)
  const conversation = getConversation(session.id)

  const here = useMemo(
    () =>
      sessions.filter(
        (s) =>
          s.status !== 'archived' &&
          (s.project ?? null) === (session.project ?? null) &&
          !(s.status === 'exited' && s.id !== session.id),
      ),
    [sessions, session.project, session.id],
  )

  const providerName = providers.find((p) => p.id === session.agent)?.name ?? session.agent

  const primary: AgentSummary = {
    id: session.id,
    name: providerName,
    agentType: session.agent,
    primary: true,
    status: agentStatusFor(session.status, Boolean(conversation.activity)),
    currentTask: conversation.activity?.label,
    detail: conversation.activity?.detail,
    startedAt: session.created_at,
    lastActivityAt: session.updated_at,
  }

  const subagents: AgentSummary[] = here
    .filter((s) => s.id !== session.id)
    .map((s) => ({
      id: s.id,
      name: s.name,
      agentType: s.agent,
      primary: false,
      status: SUBAGENT_STATUS[s.status] ?? 'idle',
      startedAt: s.created_at,
      lastActivityAt: s.updated_at,
    }))

  return { primary, subagents, here }
}

/* ── Git summary (live) ──────────────────────────────────────────────────── */

export interface GitBranchSummary {
  branch?: string
  added: number
  removed: number
  changed: number
}

/** Live branch + diffstat, polled like the git panel (15s + focus regain). */
export function useGitBranchSummary(project?: string | null, refreshKey = 0): GitBranchSummary {
  const [summary, setSummary] = useState<GitBranchSummary>({ added: 0, removed: 0, changed: 0 })
  const refresh = useCallback(async () => {
    if (!project) {
      setSummary({ added: 0, removed: 0, changed: 0 })
      return
    }
    try {
      const data = await gitApi.branches(project)
      setSummary({
        branch: data.current,
        added: data.added ?? 0,
        removed: data.removed ?? 0,
        changed: data.changed_count ?? 0,
      })
    } catch {
      /* keep stale state */
    }
  }, [project])

  useEffect(() => {
    void refresh()
    const interval = setInterval(() => void refresh(), 15_000)
    const onVisible = () => {
      if (document.visibilityState === 'visible') void refresh()
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => {
      clearInterval(interval)
      document.removeEventListener('visibilitychange', onVisible)
    }
  }, [refresh, refreshKey])

  return summary
}

/* ── Combined workspace stats for the floating HUD ───────────────────────── */

export interface WorkspaceStats {
  git: GitBranchSummary
  tasks: TaskItem[]
  todos: TodoItem[]
  /** Sessions running in this workspace (the agent + subagents). */
  running: number
  /** Any same-workspace session failed or blocked on the user. */
  attention: boolean
  done: number
  remaining: number
  blockedCount: number
}

export function useWorkspaceStats(session: Session, refreshKey = 0): WorkspaceStats {
  const git = useGitBranchSummary(session.project, refreshKey)
  const sessions = useStore((s) => s.sessions)
  const revision = useStore((s) => s.revisions[session.id])
  void revision

  // Compute inline — these are cheap operations and the revision subscription
  // already re-renders this component on every change.
  const tasks = tasksFromConversation(session.id)
  const todos = buildTodoList(session)
  const running = sessions.filter(
    (s) => s.status === 'running' && (s.project ?? null) === (session.project ?? null),
  ).length
  const attention = sessions.some(
    (s) =>
      (s.project ?? null) === (session.project ?? null) &&
      (s.status === 'error' || s.status === 'waiting_for_approval' || s.status === 'waiting_for_input'),
  )

  return {
    git,
    tasks,
    todos,
    running,
    attention,
    done: tasks.filter((t) => t.status === 'completed').length,
    remaining: todos.filter((t) => t.status !== 'completed').length,
    blockedCount: todos.filter((t) => t.status === 'blocked' || t.status === 'failed').length,
  }
}

/* ── Misc helpers ────────────────────────────────────────────────────────── */

export function formatElapsed(startIso: string, now: number): string {
  const start = new Date(startIso).getTime()
  if (Number.isNaN(start)) return '—'
  const ms = Math.max(0, now - start)
  const mins = Math.floor(ms / 60000)
  if (mins < 1) return '<1m'
  if (mins < 60) return `${mins}m ${Math.floor((ms % 60000) / 1000)}s`
  const hrs = Math.floor(mins / 60)
  return `${hrs}h ${mins % 60}m`
}

export function timeAgo(iso: string | undefined, now: number): string {
  if (!iso) return ''
  const t = new Date(iso).getTime()
  if (Number.isNaN(t)) return ''
  const seconds = Math.max(0, Math.floor((now - t) / 1000))
  if (seconds < 10) return 'just now'
  if (seconds < 60) return `${seconds}s ago`
  const mins = Math.floor(seconds / 60)
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}
