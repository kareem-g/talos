import { describe, expect, it } from 'vitest'
import { sessionUIState, uiStateDisplay, uiStateRank } from './sessionState'
import type { Conversation } from '@/types/conversation'
import { emptyConversation } from '@/types/conversation'
import type { Session } from '@/types/session'

function session(status: Session['status']): Session {
  return {
    id: 's1',
    name: 'Test',
    agent: 'claude',
    project: null,
    branch: null,
    status,
    worktree_path: null,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    cost: null,
    tokens_used: null,
    resume_command: status === 'needs_resume' ? 'claude --resume abc' : null,
  }
}

function convWithApproval(needsApproval = true): Conversation {
  const c = emptyConversation('s1')
  if (!needsApproval) return c
  // inject approval part into last message
  c.messages.push({
    id: 'm1',
    role: 'assistant',
    parts: [
      {
        kind: 'approval',
        requestId: 'p1',
        prompt: 'Allow edit?',
        options: [
          { value: 'allow', label: 'Allow', kind: 'allow' as const },
          { value: 'deny', label: 'Deny', kind: 'deny' as const },
        ],
        decision: undefined,
      } as unknown as Conversation['messages'][number]['parts'][number],
    ],
    sequence: 1,
    createdAt: new Date().toISOString(),
    streaming: true,
  } as unknown as Conversation['messages'][number])
  return c
}

describe('sessionUIState', () => {
  it('maps needs_resume to paused', () => {
    expect(sessionUIState(session('needs_resume'), undefined, 'connected')).toBe('paused')
  })

  it('maps error to failed', () => {
    expect(sessionUIState(session('error'), undefined, 'connected')).toBe('failed')
  })

  it('maps running to working', () => {
    expect(sessionUIState(session('running'), undefined, 'connected')).toBe('working')
  })

  it('maps idle to ready', () => {
    expect(sessionUIState(session('idle'), undefined, 'connected')).toBe('ready')
  })

  it('open approval overrides running', () => {
    const c = convWithApproval(true)
    expect(sessionUIState(session('running'), c, 'connected')).toBe('approval')
  })

  it('no approval on needs_resume stays paused', () => {
    const c = emptyConversation('s1')
    expect(sessionUIState(session('needs_resume'), c, 'connected')).toBe('paused')
  })

  it('disconnected yields offline regardless of session', () => {
    expect(sessionUIState(session('running'), undefined, 'disconnected')).toBe('offline')
    expect(sessionUIState(session('needs_resume'), undefined, 'offline')).toBe('offline')
  })

  it('reconnecting overrides everything', () => {
    expect(sessionUIState(session('error'), undefined, 'reconnecting')).toBe('reconnecting')
  })

  it('waiting_for_input yields input', () => {
    expect(sessionUIState(session('waiting_for_input'), undefined, 'connected')).toBe('input')
  })

  it('exited yields ended', () => {
    expect(sessionUIState(session('exited'), undefined, 'connected')).toBe('ended')
  })
})

describe('uiStateDisplay', () => {
  it('paused is orange not red', () => {
    expect(uiStateDisplay('paused').tone).toBe('orange')
    expect(uiStateDisplay('paused').label).toBe('Paused')
  })

  it('failed is red', () => {
    expect(uiStateDisplay('failed').tone).toBe('red')
  })

  it('resuming pulses', () => {
    expect(uiStateDisplay('resuming').pulse).toBe(true)
  })
})

describe('uiStateRank', () => {
  it('attention (approval/failed) sorts before paused', () => {
    expect(uiStateRank('approval')).toBeLessThan(uiStateRank('paused'))
    expect(uiStateRank('failed')).toBeLessThan(uiStateRank('paused'))
  })

  it('paused and ready share tier but rank after live', () => {
    expect(uiStateRank('working')).toBeLessThan(uiStateRank('paused'))
    expect(uiStateRank('paused')).toBe(uiStateRank('ready'))
  })

  it('ended sorts last', () => {
    expect(uiStateRank('archived')).toBeGreaterThanOrEqual(uiStateRank('ended'))
  })
})
