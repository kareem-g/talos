/**
 * roomOpenApproval tests: an approval card on a hidden channel or worker
 * timeline must be discoverable without the session appearing in any list.
 */

import { describe, expect, it } from 'vitest'
import { applyAgentEvent } from './events'
import { getConversation } from '@/store'
import { roomOpenApproval, type Room } from './rooms'
import type { AgentEvent } from '@/types/protocol'

let sequence = 100000

function event(sessionId: string, kind: string, payload: Record<string, unknown> = {}): AgentEvent {
  sequence += 1
  return {
    event_id: `room-test-${sequence}`,
    session_id: sessionId,
    sequence,
    timestamp: new Date().toISOString(),
    kind,
    payload,
  } as unknown as AgentEvent
}

function room(sessionId?: string, workers: Array<{ name: string; sessionId?: string }> = []): Room {
  return { id: 'room-test', name: 'Test Room', workers, sessionId, panels: [] }
}

describe('roomOpenApproval', () => {
  it('finds a channel approval card', () => {
    const channel = `channel-${sequence}`
    applyAgentEvent(
      getConversation(channel),
      event(channel, 'permission_required', { id: 'req-1', prompt: 'Run it?', options: ['allow', 'deny'] }),
    )
    const found = roomOpenApproval(room(channel))
    expect(found).toEqual({ sessionId: channel, requestId: 'req-1' })
  })

  it('ignores resolved cards and falls through to worker sessions', () => {
    const channel = `channel-${sequence}`
    const worker = `worker-${sequence}`
    applyAgentEvent(
      getConversation(channel),
      event(channel, 'permission_required', { id: 'req-done', prompt: 'Old?', options: ['allow'] }),
    )
    applyAgentEvent(getConversation(channel), event(channel, 'permission_resolved', {
      request_id: 'req-done',
      decision: 'allow',
    }))
    applyAgentEvent(
      getConversation(worker),
      event(worker, 'permission_required', { id: 'req-live', prompt: 'New?', options: ['allow'] }),
    )
    const found = roomOpenApproval(room(channel, [{ name: 'W', sessionId: worker }]))
    expect(found).toEqual({ sessionId: worker, requestId: 'req-live' })
  })

  it('returns null when nothing is open', () => {
    expect(roomOpenApproval(room(`empty-${sequence}`))).toBeNull()
  })
})
