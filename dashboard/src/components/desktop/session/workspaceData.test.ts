/**
 * Unit tests for the Agent Workspace data adapters (pure functions only —
 * no store, no DOM) and the shared diff parser.
 */

import { describe, expect, it } from 'vitest'
import { emptyConversation, type Conversation, type Message, type MessagePart } from '@/types/conversation'
import type { Session } from '@/types/session'
import {
  buildTodoList,
  deriveAgentActivity,
  deriveSubagents,
  latestPlanInfo,
  latestUserPrompt,
  tasksFromPlanParts,
} from './workspaceData'
import { parseDiff } from '@/components/shared/DiffViewer'

/* ── Fixtures ─────────────────────────────────────────────────────────────── */

const session: Session = {
  id: 's1',
  name: 'Test session',
  agent: 'opencode',
  project: '/repo',
  branch: 'main',
  status: 'running',
  worktree_path: null,
  created_at: '2026-08-28T09:00:00Z',
  updated_at: '2026-08-28T09:30:00Z',
  cost: 0,
  tokens_used: 0,
  resume_command: null,
}

function message(parts: MessagePart[], overrides: Partial<Message> = {}): Message {
  return {
    id: overrides.id ?? `m-${Math.random()}`,
    role: overrides.role ?? 'assistant',
    sequence: 0,
    createdAt: overrides.createdAt ?? '2026-08-28T10:00:00Z',
    streaming: false,
    parts,
    ...overrides,
  }
}

function planPart(steps: string[], entries?: Array<{ content: string; status?: string }>) {
  return { kind: 'plan' as const, steps, entries }
}

function conversation(messages: Message[]): Conversation {
  const c = emptyConversation(session.id)
  c.messages = messages
  return c
}

/* ── tasksFromPlanParts ──────────────────────────────────────────────────── */

describe('tasksFromPlanParts', () => {
  it('maps plan steps with live entry statuses', () => {
    const tasks = tasksFromPlanParts([
      message([
        planPart(['step one', 'step two', 'step three'], [
          { content: 'step one', status: 'completed' },
          { content: 'step two', status: 'in_progress' },
        ]),
      ]),
    ])
    expect(tasks).toEqual([
      { id: '0-0', title: 'step one', status: 'completed', createdAt: '2026-08-28T10:00:00Z' },
      { id: '0-1', title: 'step two', status: 'in_progress', createdAt: '2026-08-28T10:00:00Z' },
      { id: '0-2', title: 'step three', status: 'pending', createdAt: '2026-08-28T10:00:00Z' },
    ])
  })

  it('falls back to pending when a step has no entry', () => {
    const tasks = tasksFromPlanParts([message([planPart(['a'], [{ content: 'other', status: 'completed' }])])])
    expect(tasks[0].status).toBe('pending')
  })

  it('the newest plan part wins', () => {
    const tasks = tasksFromPlanParts([
      message([planPart(['old step'], [{ content: 'old step', status: 'completed' }])], { createdAt: '2026-08-28T09:00:00Z' }),
      message([planPart(['new step'])], { createdAt: '2026-08-28T10:00:00Z' }),
    ])
    expect(tasks.map((t) => t.title)).toEqual(['new step'])
    expect(tasks[0].status).toBe('pending')
  })

  it('returns an empty list when there is no plan', () => {
    expect(tasksFromPlanParts([message([{ kind: 'text', text: 'hi', streaming: false }])])).toEqual([])
    expect(tasksFromPlanParts([])).toEqual([])
  })
})

/* ── buildTodoList ───────────────────────────────────────────────────────── */

describe('buildTodoList', () => {
  it('defaults priority/assignee/source and carries created time', () => {
    const todos = buildTodoList(session, conversation([message([planPart(['one'])])]))
    expect(todos[0]).toMatchObject({
      title: 'one',
      status: 'pending',
      priority: 'medium',
      assignee: 'opencode',
      source: 'primary',
      createdAt: '2026-08-28T10:00:00Z',
    })
  })

  it('marks the active step blocked while waiting for approval', () => {
    const todos = buildTodoList(
      { ...session, status: 'waiting_for_approval' },
      conversation([message([planPart(['one', 'two'], [{ content: 'one', status: 'in_progress' }])])]),
    )
    expect(todos.find((t) => t.title === 'one')?.status).toBe('blocked')
    expect(todos.find((t) => t.title === 'two')?.status).toBe('pending')
  })

  it('marks the active step failed when the newest assistant message has an error', () => {
    const todos = buildTodoList(
      session,
      conversation([
        message([
          planPart(['one'], [{ content: 'one', status: 'in_progress' }]),
          { kind: 'error', message: 'boom' },
        ]),
      ]),
    )
    expect(todos.find((t) => t.title === 'one')?.status).toBe('failed')
  })

  it('the active step is the first pending one when nothing is in progress', () => {
    const todos = buildTodoList(
      { ...session, status: 'waiting_for_input' },
      conversation([message([planPart(['one', 'two', 'three'], [{ content: 'one', status: 'completed' }])])]),
    )
    expect(todos.find((t) => t.title === 'two')?.status).toBe('blocked')
    expect(todos.find((t) => t.title === 'three')?.status).toBe('pending')
  })

  it('local overrides complete a todo regardless of agent status', () => {
    const todos = buildTodoList(
      session,
      conversation([message([planPart(['one'])])]),
      { '0-0': 'completed' },
    )
    expect(todos[0].status).toBe('completed')
  })
})

/* ── deriveAgentActivity ─────────────────────────────────────────────────── */

describe('deriveAgentActivity', () => {
  it('maps tool, command, file, plan, approval, error and summary parts', () => {
    const events = deriveAgentActivity([
      message([
        { kind: 'tool', toolId: 't1', name: 'Read', status: 'ok', input: 'src/main.rs' },
        { kind: 'command', toolId: 't2', command: 'cargo test', status: 'ok' },
        { kind: 'file', path: 'src/lib.rs', ok: true },
        planPart(['a'], []),
        { kind: 'approval', requestId: 'r1', prompt: 'Allow edit?', options: ['yes', 'no'] },
        { kind: 'error', message: 'boom' },
        { kind: 'turn_summary', stopReason: 'end_turn' },
      ]),
    ])
    expect(events.map((e) => e.kind)).toEqual(['completed', 'error', 'approval', 'plan', 'file', 'command', 'tool'])
    expect(events[6]).toMatchObject({ kind: 'tool', label: 'Using Read', detail: 'src/main.rs' })
  })

  it('flags failed tools and commands as errors', () => {
    const events = deriveAgentActivity([
      message([
        { kind: 'tool', toolId: 't1', name: 'Write', status: 'failed', output: 'denied' },
        { kind: 'command', toolId: 't2', command: 'npm i', status: 'failed', exitCode: 1 },
      ]),
    ])
    expect(events[0].kind).toBe('error')
    expect(events[1].kind).toBe('error')
  })

  it('skips text parts and returns newest first', () => {
    const events = deriveAgentActivity([
      message([{ kind: 'text', text: 'hello', streaming: false }], { createdAt: '2026-08-28T09:00:00Z' }),
      message([{ kind: 'file', path: 'a.ts', ok: true }], { createdAt: '2026-08-28T10:00:00Z' }),
    ])
    expect(events.map((e) => e.kind)).toEqual(['file'])
    expect(events[0].timestamp).toBe('2026-08-28T10:00:00Z')
  })

  it('respects the limit', () => {
    const parts: MessagePart[] = Array.from({ length: 6 }, (_, i) => ({
      kind: 'file' as const,
      path: `f${i}.ts`,
      ok: true,
    }))
    expect(deriveAgentActivity([message(parts)], 3)).toHaveLength(3)
  })
})

/* ── latestPlanInfo / latestUserPrompt ───────────────────────────────────── */

describe('plan metadata helpers', () => {
  it('latestPlanInfo returns the newest plan title, time and related files', () => {
    const info = latestPlanInfo([
      message(
        [
          planPart(['old']),
          { kind: 'file', path: 'old.ts', ok: true },
        ],
        { createdAt: '2026-08-28T09:00:00Z' },
      ),
      message(
        [
          planPart(['new'], []),
          { kind: 'file', path: 'new.ts', ok: true },
          { kind: 'file', path: 'other.ts', ok: true },
        ],
        { createdAt: '2026-08-28T10:00:00Z' },
      ),
    ])
    expect(info).toEqual({
      title: undefined,
      createdAt: '2026-08-28T10:00:00Z',
      relatedFiles: ['new.ts', 'other.ts'],
      stepCount: 1,
    })
  })

  it('latestPlanInfo returns undefined when there is no plan', () => {
    expect(latestPlanInfo([message([{ kind: 'text', text: 'hi', streaming: false }])])).toBeUndefined()
  })

  it('latestUserPrompt returns the newest user message text', () => {
    const prompt = latestUserPrompt([
      message([{ kind: 'text', text: 'first', streaming: false }], { role: 'user', createdAt: '2026-08-28T09:00:00Z' }),
      message([{ kind: 'text', text: 'second', streaming: false }], { role: 'user', createdAt: '2026-08-28T10:00:00Z' }),
    ])
    expect(prompt).toBe('second')
  })

  it('latestUserPrompt skips empty and assistant messages', () => {
    const prompt = latestUserPrompt([
      message([{ kind: 'text', text: '', streaming: false }], { role: 'user' }),
      message([{ kind: 'text', text: 'agent text', streaming: false }], { role: 'assistant' }),
    ])
    expect(prompt).toBeUndefined()
  })
})

/* ── parseDiff (shared DiffViewer) ───────────────────────────────────────── */

describe('parseDiff', () => {
  const diff = [
    'diff --git a/src/a.ts b/src/a.ts',
    'index 123..456 100644',
    '--- a/src/a.ts',
    '+++ b/src/a.ts',
    '@@ -1,3 +1,4 @@',
    ' context',
    '-removed',
    '+added',
    '+added2',
    ' trailing',
  ].join('\n')

  it('tracks left/right line numbers across hunks', () => {
    const lines = parseDiff(diff)
    const byType = (t: string) => lines.filter((l) => l.type === t)
    expect(byType('meta')).toHaveLength(4) // diff, index, ---, +++
    expect(byType('hunk')).toHaveLength(1)

    const context = byType('context')
    expect(context[0]).toMatchObject({ left: 1, right: 1 })
    expect(context[1]).toMatchObject({ left: 3, right: 4 })

    const del = byType('del')[0]
    expect(del.left).toBe(2)
    expect(del.right).toBeUndefined()

    const adds = byType('add')
    expect(adds[0].right).toBe(2)
    expect(adds[1].right).toBe(3)
  })

  it('returns no rows for an empty diff', () => {
    expect(parseDiff('')).toEqual([])
  })
})

/* ── tasksFromPlanParts: only real plan/todo events become tasks ──────────── */

describe('tasksFromPlanParts ignores non-plan events', () => {
  it('returns [] when only tool / command / file events exist (no plan)', () => {
    const tasks = tasksFromPlanParts([
      message([
        { kind: 'tool', toolId: 't1', name: 'Read', status: 'ok', input: 'a.ts' },
        { kind: 'command', toolId: 't2', command: 'cargo build', status: 'ok' },
        { kind: 'file', path: 'src/lib.rs', ok: false },
        { kind: 'tool', toolId: 't3', name: 'Write', status: 'failed', input: 'b.ts' },
      ], { createdAt: '2026-08-28T10:00:00Z' }),
    ])
    expect(tasks).toEqual([])
  })

  it('returns [] for plain text with no plan part', () => {
    expect(tasksFromPlanParts([message([{ kind: 'text', text: 'hello there', streaming: false }])])).toEqual([])
  })

  it('still prefers a structured plan part when one exists', () => {
    const tasks = tasksFromPlanParts([
      message([
        { kind: 'text', text: '# Plan: old markdown\n1. ignored', streaming: false },
        { kind: 'tool', toolId: 't1', name: 'ShouldBeIgnored', status: 'ok', input: 'x' },
        planPart(['structured step'], [{ content: 'structured step', status: 'in_progress' }]),
      ]),
    ])
    expect(tasks.map((t) => t.title)).toEqual(['structured step'])
    expect(tasks[0].status).toBe('in_progress')
  })
})

/* ── deriveSubagents (from Agent tool parts in the transcript) ────────────── */

describe('deriveSubagents', () => {
  it('returns Agent tool invocations as launched subagents', () => {
    const sub = deriveSubagents([
      message([
        {
          kind: 'tool',
          toolId: 't1',
          name: 'Agent',
          status: 'running',
          input: JSON.stringify({ description: 'Review diff', subagent_type: 'Explore' }),
        },
      ]),
    ])
    expect(sub).toHaveLength(1)
    expect(sub[0]).toMatchObject({ name: 'Review diff', kind: 'Explore', status: 'working' })
  })

  it('returns [] when no Agent tool is present', () => {
    expect(deriveSubagents([message([{ kind: 'file', path: 'a.ts', ok: true }])])).toEqual([])
  })

  it('flags failed Agent tools', () => {
    const sub = deriveSubagents([
      message([{ kind: 'tool', toolId: 't1', name: 'Agent', status: 'failed', input: '{}' }]),
    ])
    expect(sub[0].status).toBe('failed')
  })

  it('catches task-style subagent tools (opencode) via description+prompt', () => {
    const sub = deriveSubagents([
      message([
        {
          kind: 'tool',
          toolId: 't1',
          name: 'Review uncommitted git diff',
          status: 'ok',
          input: JSON.stringify({ description: 'Review uncommitted git diff', prompt: 'Review the diff…' }),
        },
      ]),
    ])
    expect(sub).toHaveLength(1)
    expect(sub[0]).toMatchObject({ name: 'Review uncommitted git diff', status: 'completed' })
  })
})
