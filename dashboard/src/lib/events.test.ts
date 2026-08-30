/**
 * Reducer tests.
 *
 * These target the specific failures the old pipeline had, because those are the
 * regressions that matter: duplicated assistant text, prompts rendered twice,
 * tool cards multiplying on reconnect, spinners that never stop.
 */

import { describe, expect, it } from 'vitest'
import {
  addOptimisticUserMessage,
  appendTerminal,
  applyAgentEvent,
  applyMessage,
  sealConversation,
} from './events'
import { describeApproval } from './approvals'
import { emptyConversation, type Conversation, type TextPart } from '@/types/conversation'
import type { AgentEvent } from '@/types/protocol'

let sequence = 0

function event(
  kind: string,
  payload: Record<string, unknown> = {},
  overrides: Partial<AgentEvent> = {},
): AgentEvent {
  sequence += 1
  return {
    event_id: `e${sequence}`,
    session_id: 's1',
    sequence,
    timestamp: new Date(1700000000000 + sequence * 1000).toISOString(),
    kind,
    payload,
    duration_ms: null,
    ...overrides,
  }
}

/** The assistant prose of a conversation, in order. */
function assistantText(conversation: Conversation): string {
  return conversation.messages
    .filter((message) => message.role === 'assistant')
    .flatMap((message) => message.parts)
    .filter((part): part is TextPart => part.kind === 'text')
    .map((part) => part.text)
    .join('')
}

describe('streaming text', () => {
  it('appends deltas into one part', () => {
    const conversation = emptyConversation('s1')
    applyAgentEvent(conversation, event('assistant_text', { text: 'Hel', delta: true }))
    applyAgentEvent(conversation, event('assistant_text', { text: 'lo ', delta: true }))
    applyAgentEvent(conversation, event('assistant_text', { text: 'world', delta: true }))

    expect(assistantText(conversation)).toBe('Hello world')
    expect(conversation.messages).toHaveLength(1)
    expect(conversation.messages[0].parts).toHaveLength(1)
  })

  it('replaces on redraw instead of appending', () => {
    // PTY-sourced text arrives as full-screen redraws. Appending them is what
    // produced garbled, repeated output in the old pipeline.
    const conversation = emptyConversation('s1')
    applyAgentEvent(conversation, event('assistant_text', { text: 'Loading', redraw: true }))
    applyAgentEvent(conversation, event('assistant_text', { text: 'Loading.', redraw: true }))
    applyAgentEvent(conversation, event('assistant_text', { text: 'Done', redraw: true }))

    expect(assistantText(conversation)).toBe('Done')
  })

  it('does not duplicate text when the same event is delivered twice', () => {
    // Exactly what a reconnect replay overlap looks like.
    const conversation = emptyConversation('s1')
    const delta = event('assistant_text', { text: 'once', delta: true })
    expect(applyAgentEvent(conversation, delta)).toBe(true)
    expect(applyAgentEvent(conversation, delta)).toBe(false)

    expect(assistantText(conversation)).toBe('once')
  })

  it('keeps a legitimately repeated line', () => {
    // The old content-equality dedupe dropped this. Two identical deltas with
    // different ids are two real pieces of output.
    const conversation = emptyConversation('s1')
    applyAgentEvent(conversation, event('assistant_text', { text: 'same\n', delta: true }))
    applyAgentEvent(conversation, event('assistant_text', { text: 'same\n', delta: true }))

    expect(assistantText(conversation)).toBe('same\nsame\n')
  })

  it('starts a new text part after a tool call so ordering survives', () => {
    const conversation = emptyConversation('s1')
    applyAgentEvent(conversation, event('assistant_text', { text: 'before', delta: true }))
    applyAgentEvent(conversation, event('tool_started', { tool_id: 't1', tool_name: 'Read' }))
    applyAgentEvent(conversation, event('assistant_text', { text: 'after', delta: true }))

    const kinds = conversation.messages[0].parts.map((part) => part.kind)
    expect(kinds).toEqual(['text', 'tool', 'text'])
  })
})

describe('user messages', () => {
  it('confirms an optimistic message rather than duplicating it', () => {
    // The server echoes Input back as a Message frame. The old code matched by
    // normalized text prefix and misfired on whitespace differences.
    const conversation = emptyConversation('s1')
    addOptimisticUserMessage(conversation, 'fix the auth bug')
    expect(conversation.messages).toHaveLength(1)
    expect(conversation.messages[0].optimistic).toBe(true)

    applyMessage(conversation, {
      id: 'server-1',
      session_id: 's1',
      role: 'user',
      content: 'fix the auth bug',
      timestamp: new Date().toISOString(),
    })

    expect(conversation.messages).toHaveLength(1)
    expect(conversation.messages[0].optimistic).toBe(false)
    expect(conversation.messages[0].id).toBe('server-1')
  })

  it('confirms even when the echoed text differs in whitespace', () => {
    const conversation = emptyConversation('s1')
    addOptimisticUserMessage(conversation, 'do the thing')

    applyMessage(conversation, {
      id: 'server-2',
      session_id: 's1',
      role: 'user',
      // Trailing newline the backend strips/adds — must not defeat matching.
      content: 'do the thing\n',
      timestamp: new Date().toISOString(),
    })

    expect(conversation.messages).toHaveLength(1)
    expect(conversation.messages[0].optimistic).toBe(false)
  })

  it('ignores a re-delivered message frame', () => {
    const conversation = emptyConversation('s1')
    const message = {
      id: 'server-3',
      session_id: 's1',
      role: 'user' as const,
      content: 'hello',
      timestamp: new Date().toISOString(),
    }
    expect(applyMessage(conversation, message)).toBe(true)
    expect(applyMessage(conversation, message)).toBe(false)
    expect(conversation.messages).toHaveLength(1)
  })
})

describe('reasoning', () => {
  it('accumulates thought deltas into one part', () => {
    const conversation = emptyConversation('s1')
    applyAgentEvent(conversation, event('thinking_started'))
    applyAgentEvent(conversation, event('thinking_delta', { text: 'The user ', delta: true }))
    applyAgentEvent(conversation, event('thinking_delta', { text: 'wants a terminal.', delta: true }))

    const reasoning = conversation.messages[0].parts.find((part) => part.kind === 'reasoning')
    expect(reasoning).toMatchObject({
      kind: 'reasoning',
      text: 'The user wants a terminal.',
      streaming: true,
    })
  })

  it('replaces the trace when a whole thought arrives', () => {
    // Some agents send chunks and then the complete thought. Appending it would
    // show the reasoning twice.
    const conversation = emptyConversation('s1')
    applyAgentEvent(conversation, event('thinking_started'))
    applyAgentEvent(conversation, event('thinking_delta', { text: 'partial', delta: true }))
    applyAgentEvent(
      conversation,
      event('thinking_delta', { text: 'partial and complete', delta: false }),
    )

    const reasoning = conversation.messages[0].parts.find((part) => part.kind === 'reasoning')
    expect(reasoning).toMatchObject({ text: 'partial and complete' })
  })

  it('seals the reasoning part and records its duration on finish', () => {
    const conversation = emptyConversation('s1')
    applyAgentEvent(conversation, event('thinking_started'))
    applyAgentEvent(conversation, event('thinking_delta', { text: 'done thinking', delta: true }))
    applyAgentEvent(conversation, event('thinking_finished', {}, { duration_ms: 2400 }))

    const reasoning = conversation.messages[0].parts.find((part) => part.kind === 'reasoning')
    expect(reasoning).toMatchObject({ streaming: false, durationMs: 2400 })
  })

  it('keeps reasoning separate from the answer text', () => {
    // Reasoning bleeding into the answer was a real failure of the old pipeline.
    const conversation = emptyConversation('s1')
    applyAgentEvent(conversation, event('thinking_started'))
    applyAgentEvent(conversation, event('thinking_delta', { text: 'I should check X', delta: true }))
    applyAgentEvent(conversation, event('thinking_finished'))
    applyAgentEvent(conversation, event('assistant_text', { text: 'Here is the answer.', delta: true }))

    expect(assistantText(conversation)).toBe('Here is the answer.')
    const reasoning = conversation.messages[0].parts.find((part) => part.kind === 'reasoning')
    expect(reasoning).toMatchObject({ text: 'I should check X' })
  })
})

describe('tools and commands', () => {
  it('pairs finish with start in place', () => {
    const conversation = emptyConversation('s1')
    applyAgentEvent(conversation, event('tool_started', { tool_id: 't1', tool_name: 'Edit' }))
    applyAgentEvent(
      conversation,
      event('tool_finished', { tool_id: 't1', success: true, output: 'ok' }, { duration_ms: 120 }),
    )

    const parts = conversation.messages[0].parts
    expect(parts).toHaveLength(1)
    expect(parts[0]).toMatchObject({ kind: 'tool', status: 'ok', output: 'ok', durationMs: 120 })
  })

  it('does not create a second card for a re-delivered start', () => {
    // The crash this prevents was real: duplicate tool ids.
    const conversation = emptyConversation('s1')
    const start = event('tool_started', { tool_id: 't1', tool_name: 'Read' })
    applyAgentEvent(conversation, start)
    // Same tool_id, different event id — a resend, not a second call.
    applyAgentEvent(conversation, event('tool_started', { tool_id: 't1', tool_name: 'Read' }))

    expect(conversation.messages[0].parts).toHaveLength(1)
  })

  it('marks a non-zero exit code as failed', () => {
    const conversation = emptyConversation('s1')
    applyAgentEvent(conversation, event('command_started', { tool_id: 'c1', command: 'npm test' }))
    applyAgentEvent(conversation, event('command_finished', { tool_id: 'c1', exit_code: 1 }))

    expect(conversation.messages[0].parts[0]).toMatchObject({
      kind: 'command',
      status: 'failed',
      exitCode: 1,
    })
  })

  it('stops a spinner for a tool that never reported back', () => {
    const conversation = emptyConversation('s1')
    applyAgentEvent(conversation, event('tool_started', { tool_id: 't1', tool_name: 'Search' }))
    applyAgentEvent(conversation, event('agent_completed', {}))

    expect(conversation.messages[0].parts[0]).toMatchObject({ status: 'failed' })
    expect(conversation.messages[0].streaming).toBe(false)
  })
})

describe('turn lifecycle', () => {
  it('closes streaming parts on completion', () => {
    const conversation = emptyConversation('s1')
    applyAgentEvent(conversation, event('thinking_started'))
    applyAgentEvent(conversation, event('assistant_text', { text: 'answer', delta: true }))
    applyAgentEvent(conversation, event('agent_completed', {}))

    const turn = conversation.messages[0]
    expect(turn.streaming).toBe(false)
    expect(turn.parts.every((part) => !('streaming' in part) || !part.streaming)).toBe(true)
    expect(conversation.activity).toBeUndefined()
  })

  it('opens a new turn for events after a completion', () => {
    const conversation = emptyConversation('s1')
    applyAgentEvent(conversation, event('assistant_text', { text: 'first', delta: true }))
    applyAgentEvent(conversation, event('agent_completed', {}))
    applyAgentEvent(conversation, event('assistant_text', { text: 'second', delta: true }))

    expect(conversation.messages).toHaveLength(2)
    expect(conversation.messages[1].streaming).toBe(true)
  })
})

describe('session end', () => {
  it('seals a conversation left streaming when the session ends', () => {
    // A process that exits between events (crash, kill, clean exit) leaves the
    // activity line and open parts spinning. This is the "shows Working after it
    // stopped" failure.
    const conversation = emptyConversation('s1')
    applyAgentEvent(conversation, event('thinking_started'))
    applyAgentEvent(conversation, event('tool_started', { tool_id: 't1', tool_name: 'Read' }))
    applyAgentEvent(conversation, event('assistant_text', { text: 'partial', delta: true }))
    expect(conversation.activity).toBeDefined()

    sealConversation(conversation)

    const turn = conversation.messages[0]
    expect(turn.streaming).toBe(false)
    expect(conversation.activity).toBeUndefined()
    for (const part of turn.parts) {
      if ('streaming' in part) expect(part.streaming).toBe(false)
      if (part.kind === 'tool') expect(part.status).toBe('failed')
    }
  })

  it('is safe on an empty or already-finished conversation', () => {
    const empty = emptyConversation('s1')
    expect(() => sealConversation(empty)).not.toThrow()

    const finished = emptyConversation('s2')
    applyAgentEvent(finished, event('assistant_text', { text: 'done', delta: true }))
    applyAgentEvent(finished, event('agent_completed', {}))
    sealConversation(finished)
    expect(finished.messages[0].streaming).toBe(false)
  })
})

describe('activity', () => {
  it('tracks what the agent is doing and clears when done', () => {
    const conversation = emptyConversation('s1')
    applyAgentEvent(conversation, event('thinking_started'))
    expect(conversation.activity?.label).toBe('Thinking')

    applyAgentEvent(conversation, event('command_started', { tool_id: 'c1', command: 'cargo test' }))
    expect(conversation.activity?.label).toBe('Running cargo')

    applyAgentEvent(conversation, event('file_edited', { path: 'src/auth.ts', success: true }))
    expect(conversation.activity).toMatchObject({ label: 'Editing files', detail: 'src/auth.ts' })

    applyAgentEvent(conversation, event('agent_completed', {}))
    expect(conversation.activity).toBeUndefined()
  })
})

describe('approvals', () => {
  it('resolves an approval raised in an earlier turn', () => {
    const conversation = emptyConversation('s1')
    applyAgentEvent(
      conversation,
      event('permission_required', { id: 'p1', prompt: 'Run rm -rf?', options: ['allow', 'deny'] }),
    )
    applyAgentEvent(conversation, event('agent_completed', {}))
    applyAgentEvent(conversation, event('assistant_text', { text: 'next turn', delta: true }))
    applyAgentEvent(conversation, event('permission_resolved', { request_id: 'p1', decision: 'allow' }))

    const approval = conversation.messages[0].parts.find((part) => part.kind === 'approval')
    expect(approval).toMatchObject({ decision: 'allow' })
  })

  it('does not duplicate an approval card on resend', () => {
    const conversation = emptyConversation('s1')
    applyAgentEvent(conversation, event('permission_required', { id: 'p1', prompt: 'ok?' }))
    applyAgentEvent(conversation, event('permission_required', { id: 'p1', prompt: 'ok?' }))

    expect(conversation.messages[0].parts.filter((part) => part.kind === 'approval')).toHaveLength(1)
  })

  it('carries structured options, selection mode and custom-input flag', () => {
    const conversation = emptyConversation('s1')
    applyAgentEvent(
      conversation,
      event('permission_required', {
        id: 'p2',
        prompt: 'Pick environments',
        options: ['prod', 'staging', 'both'],
        option_data: [
          { id: 'prod', label: 'Production', description: 'Live traffic', allows_custom_text: false },
          { id: 'staging', label: 'Staging' },
          { id: 'both', label: 'Both' },
        ],
        selection_mode: 'multi',
        allows_custom_text: true,
      }),
    )

    const approval = conversation.messages[0].parts.find((part) => part.kind === 'approval')
    expect(approval).toMatchObject({
      kind: 'approval',
      requestId: 'p2',
      // The buttons render labels; the raw values stay in `optionData`.
      options: ['Production', 'Staging', 'Both'],
      multiSelect: true,
      allowsCustomText: true,
    })
    // Structured metadata is preserved so labels/descriptions can be rendered.
    expect(approval?.optionData?.[0]).toMatchObject({ value: 'prod', label: 'Production' })
  })
})

describe('robustness', () => {
  it('ignores unknown event kinds', () => {
    // The backend's `kind` is an open string. A new one must not require a
    // frontend change, and must not throw.
    const conversation = emptyConversation('s1')
    expect(() =>
      applyAgentEvent(conversation, event('quantum_entanglement_started', { spin: 'up' })),
    ).not.toThrow()
    expect(conversation.messages).toHaveLength(0)
  })

  it('survives events with missing payload fields', () => {
    const conversation = emptyConversation('s1')
    expect(() => {
      applyAgentEvent(conversation, event('assistant_text', {}))
      applyAgentEvent(conversation, event('tool_finished', {}))
      applyAgentEvent(conversation, event('command_finished', {}))
      applyAgentEvent(conversation, event('file_edited', {}))
      applyAgentEvent(conversation, event('permission_resolved', {}))
    }).not.toThrow()
  })

  it('keeps terminal bytes out of the chat', () => {
    const conversation = emptyConversation('s1')
    applyAgentEvent(conversation, event('terminal_output', { data: '\u001b[31mred\u001b[0m' }))

    expect(conversation.messages).toHaveLength(0)
    expect(assistantText(conversation)).toBe('')
  })

  it('tracks the replay cursor from the envelope', () => {
    const conversation = emptyConversation('s1')
    applyAgentEvent(conversation, event('assistant_text', { text: 'a', delta: true }), 42)
    expect(conversation.lastEventId).toBe(42)

    // An out-of-order lower id must not move the cursor backwards.
    applyAgentEvent(conversation, event('assistant_text', { text: 'b', delta: true }), 7)
    expect(conversation.lastEventId).toBe(42)
  })

  it('bounds the terminal buffer', () => {
    const conversation = emptyConversation('s1')
    appendTerminal(conversation, 'x'.repeat(600 * 1024))
    expect(conversation.terminal.length).toBeLessThanOrEqual(512 * 1024)
  })
})

describe('GrokBot event types', () => {
  /** Raw Grok streaming-json vocabulary renders through the same paths. */
  it('maps raw grok kinds: text, thought, tool_call, end', () => {
    const conversation = emptyConversation('s1')
    applyAgentEvent(conversation, event('thought', { text: 'pondering ' }))
    applyAgentEvent(conversation, event('text', { text: 'Answer ' }))
    applyAgentEvent(conversation, event('tool_call', { id: 't1', name: 'read_file', status: 'in_progress' }))
    applyAgentEvent(conversation, event('tool_call_update', { id: 't1', status: 'completed', result: 'contents' }))
    applyAgentEvent(conversation, event('text', { text: 'done' }))
    applyAgentEvent(conversation, event('end', {}))

    expect(assistantText(conversation)).toBe('Answer done')
    const turn = conversation.messages[0]
    const tool = turn.parts.find((part) => part.kind === 'tool') as { name: string; output?: string; status: string }
    expect(tool.name).toBe('read_file')
    expect(tool.output).toBe('contents')
    expect(tool.status).toBe('ok')
    // `end` seals the turn.
    expect(turn.streaming).toBe(false)
    // Thought text is present as reasoning.
    const reasoning = turn.parts.find((part) => part.kind === 'reasoning') as { text: string }
    expect(reasoning.text).toBe('pondering ')
  })

  it('merges usage updates into one meter', () => {
    const conversation = emptyConversation('s1')
    applyAgentEvent(conversation, event('usage', { input_tokens: 100 }))
    applyAgentEvent(conversation, event('usage', { input_tokens: 150, outputTokens: 40, cost_usd: 0.02 }))

    const turn = conversation.messages[0]
    const meters = turn.parts.filter((part) => part.kind === 'usage')
    expect(meters).toHaveLength(1)
    const meter = meters[0] as { inputTokens?: number; outputTokens?: number; costUsd?: number }
    expect(meter.inputTokens).toBe(150)
    expect(meter.outputTokens).toBe(40)
    expect(meter.costUsd).toBe(0.02)
  })

  it('builds a turn summary from a completion that reports data', () => {
    const conversation = emptyConversation('s1')
    applyAgentEvent(conversation, event('assistant_text', { text: 'hi', delta: true }))
    applyAgentEvent(
      conversation,
      event('agent_completed', { stop_reason: 'end_turn', input_tokens: 10, output_tokens: 5 }, { duration_ms: 4200 }),
    )

    const turn = conversation.messages[0]
    const summary = turn.parts.find((part) => part.kind === 'turn_summary') as {
      stopReason?: string
      inputTokens?: number
      outputTokens?: number
      durationMs?: number
    }
    expect(summary.stopReason).toBe('end_turn')
    expect(summary.inputTokens).toBe(10)
    expect(summary.durationMs).toBe(4200)
    expect(turn.streaming).toBe(false)
  })

  it('adds no summary card for a bare completion', () => {
    // An empty "Turn complete" row is noise. Most agents complete silently.
    const conversation = emptyConversation('s1')
    applyAgentEvent(conversation, event('assistant_text', { text: 'hi', delta: true }))
    applyAgentEvent(conversation, event('agent_completed', {}))

    const turn = conversation.messages[0]
    expect(turn.parts.some((part) => part.kind === 'turn_summary')).toBe(false)
  })

  it('stores announced slash commands and mode on the conversation', () => {
    const conversation = emptyConversation('s1')
    applyAgentEvent(conversation, event('commands_available', { commands: ['/review', '/plan'] }))
    applyAgentEvent(conversation, event('mode_changed', { mode_id: 'build', modes: [{ id: 'build', name: 'Build' }] }))

    expect(conversation.commands).toEqual(['/review', '/plan'])
    expect(conversation.mode?.id).toBe('build')
    // Neither kind may leak into the transcript.
    expect(conversation.messages).toHaveLength(0)
  })

  it('renders plan step statuses when entries carry them', () => {
    const conversation = emptyConversation('s1')
    applyAgentEvent(
      conversation,
      event('plan', {
        title: 'Plan',
        steps: ['One', 'Two'],
        entries: [
          { content: 'One', status: 'completed' },
          { content: 'Two', status: 'in_progress' },
        ],
      }),
    )

    const plan = conversation.messages[0].parts.find((part) => part.kind === 'plan') as {
      entries?: Array<{ content: string; status?: string }>
    }
    expect(plan.entries).toHaveLength(2)
    expect(plan.entries?.[0]).toEqual({ content: 'One', status: 'completed' })
    expect(plan.entries?.[1].status).toBe('in_progress')
  })

  it('replaces the plan part in the same turn instead of stacking duplicates', () => {
    const conversation = emptyConversation('s1')
    // A TodoWrite / plan_update stream emits several updates per turn.
    applyAgentEvent(conversation, event('plan', {
      steps: ['Old'],
      entries: [{ content: 'Old', status: 'pending' }],
    }))
    applyAgentEvent(conversation, event('plan', {
      steps: ['New', 'Newer'],
      entries: [
        { content: 'New', status: 'in_progress' },
        { content: 'Newer', status: 'pending' },
      ],
    }))

    const plans = conversation.messages[0].parts.filter((part) => part.kind === 'plan')
    expect(plans).toHaveLength(1)
    const plan = plans[0] as { steps?: string[] }
    expect(plan.steps).toEqual(['New', 'Newer'])
  })

  it('marks a grok tool failed by status string', () => {
    const conversation = emptyConversation('s1')
    applyAgentEvent(conversation, event('tool_call', { id: 'x1', name: 'bash', status: 'in_progress' }))
    applyAgentEvent(conversation, event('tool_call_update', { id: 'x1', status: 'failed' }))

    const tool = conversation.messages[0].parts.find((part) => part.kind === 'tool') as { status: string }
    expect(tool.status).toBe('failed')
  })

  it('fills tool input once from a tool_input event without spawning cards', () => {
    const conversation = emptyConversation('s1')
    applyAgentEvent(conversation, event('tool_started', { tool_id: 'tu_1', tool_name: 'Bash' }))
    applyAgentEvent(conversation, event('tool_input', { tool_id: 'tu_1', input: '{"command":"ls -la"}' }))
    // A late duplicate must not double-apply or create new parts.
    applyAgentEvent(conversation, event('tool_finished', { tool_id: 'tu_1', success: true, output: 'ok' }))

    const turn = conversation.messages[0]
    const tools = turn.parts.filter((part) => part.kind === 'tool')
    expect(tools).toHaveLength(1)
    const tool = tools[0] as { input?: string; output?: string; status: string }
    expect(tool.input).toContain('ls -la')
    expect(tool.output).toBe('ok')
    expect(turn.streaming).toBe(true) // turn continues after the tool
  })
})

describe('describeApproval', () => {
  it('merges structured option labels/descriptions over raw values', () => {
    const view = describeApproval('Deploy where?', ['prod', 'staging'], {
      optionData: [
        { value: 'prod', label: 'Production', description: 'Live traffic', allowsCustomText: false },
        { value: 'staging', label: 'Staging' },
      ],
      multiSelect: false,
      allowsCustomText: false,
    })
    expect(view.question).toBe('Deploy where?')
    expect(view.options.map((o) => o.label)).toEqual(['Production', 'Staging'])
    expect(view.options[0].description).toBe('Live traffic')
    expect(view.options[0].kind).toBe('other')
  })

  it('flags multi-select and custom-input from agent metadata', () => {
    const view = describeApproval('Choose', ['a', 'b'], {
      multiSelect: true,
      allowsCustomText: true,
    })
    expect(view.multiSelect).toBe(true)
    expect(view.allowsCustomText).toBe(true)
  })

  it('stays a no-op when no envelope and no option data', () => {
    const view = describeApproval('Run rm -rf?', ['allow', 'deny'])
    expect(view.options.map((o) => o.value)).toEqual(['allow', 'deny'])
    expect(view.multiSelect).toBe(false)
    expect(view.allowsCustomText).toBe(false)
  })
})

describe('harness context chip', () => {
  it('stashes context_assembled without creating a transcript row', () => {
    const conversation = emptyConversation('s1')
    const changed = applyAgentEvent(conversation, event('context_assembled', {
      environment: true,
      skills: ['tdd', 'frontend-design'],
      trajectories: [{ session_id: 'past-1', similarity: 0.55 }],
    }))

    expect(changed).toBe(true)
    expect(conversation.messages).toHaveLength(0)
    expect(conversation.pendingContext).toMatchObject({
      kind: 'context',
      environment: true,
      skills: ['tdd', 'frontend-design'],
      trajectories: [{ sessionId: 'past-1', similarity: 0.55 }],
    })
  })

  it('ignores an empty assembly', () => {
    const conversation = emptyConversation('s1')
    const changed = applyAgentEvent(conversation, event('context_assembled', {
      environment: false,
      skills: [],
      trajectories: [],
    }))

    expect(changed).toBe(false)
    expect(conversation.pendingContext).toBeUndefined()
  })

  it('attaches the pending context to the next user message', () => {
    const conversation = emptyConversation('s1')
    applyAgentEvent(conversation, event('context_assembled', {
      environment: false,
      skills: ['tdd'],
      trajectories: [],
    }))
    applyMessage(conversation, {
      id: 'm1',
      session_id: 's1',
      role: 'user',
      content: 'fix the auth bug',
      timestamp: new Date().toISOString(),
    })

    const user = conversation.messages[0]
    expect(user.role).toBe('user')
    expect(user.parts.some((part) => part.kind === 'context')).toBe(true)
    // The chip is consumed exactly once.
    expect(conversation.pendingContext).toBeUndefined()
  })

  it('attaches to the optimistic message the server confirms', () => {
    const conversation = emptyConversation('s1')
    applyAgentEvent(conversation, event('context_assembled', {
      environment: true,
      skills: [],
      trajectories: [],
    }))
    addOptimisticUserMessage(conversation, 'hi')
    applyMessage(conversation, {
      id: 'm2',
      session_id: 's1',
      role: 'user',
      content: 'hi',
      timestamp: new Date().toISOString(),
    })

    const user = conversation.messages[0]
    expect(user.parts.some((part) => part.kind === 'context')).toBe(true)
    expect(conversation.pendingContext).toBeUndefined()
  })
})

describe('harness plan lifecycle', () => {
  it('sets the plan status from plan_status events', () => {
    const conversation = emptyConversation('s1')
    applyAgentEvent(conversation, event('plan', { title: 'Fix auth', steps: ['a', 'b'] }))
    applyAgentEvent(conversation, event('plan_status', { status: 'approved', title: 'Fix auth' }))
    applyAgentEvent(conversation, event('plan_status', { status: 'completed', title: 'Fix auth' }))

    const plan = conversation.messages[0].parts.find((part) => part.kind === 'plan')
    expect(plan).toMatchObject({ kind: 'plan', title: 'Fix auth' })
    expect((plan as { status?: string }).status).toBe('completed')
  })

  it('ignores unknown plan statuses', () => {
    const conversation = emptyConversation('s1')
    applyAgentEvent(conversation, event('plan', { title: 'P', steps: ['x'] }))
    const changed = applyAgentEvent(conversation, event('plan_status', { status: 'running' }))
    expect(changed).toBe(false)
    const plan = conversation.messages[0].parts.find((part) => part.kind === 'plan')
    expect((plan as { status?: string }).status).toBeUndefined()
  })
})
