/**
 * Queue + steer + attachment logic in the store.
 *
 * These are the behaviors the composer's queue rows depend on: follow-ups typed
 * while the agent works wait in `queues`, drain one-per-turn on idle, and can be
 * steered/edited/deleted/reordered. `socket.sendInput` is not connected in tests,
 * so a "send" is observed through the optimistic user message it appends.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'

// The store sends through the socket singleton, which reaches for `window` on
// connect. Stub it so a "send" is observable only via the optimistic message.
const sentInputs: Array<{ sessionId: string; data: string }> = []
vi.mock('@/lib/socket', () => ({
  socket: {
    sendInput: (sessionId: string, data: string) => sentInputs.push({ sessionId, data }),
    interruptSession: () => {},
    stopSession: () => {},
    respondToApproval: () => {},
    answerQuestion: () => {},
    sendTerminalInput: () => {},
    resizeTerminal: () => {},
    connect: () => {},
    onStateChange: () => () => {},
    onFrame: () => () => {},
  },
}))

import { getConversation, useStore, withAttachmentBlock } from '@/store'
import type { AttachmentRef } from '@/types/conversation'

const SESSION = 'queue-test-session'

function attachment(name: string): AttachmentRef {
  return {
    ref: `att-${name}`,
    name,
    fileName: name,
    contentType: 'text/plain',
    size: 12,
    path: `/tmp/${name}`,
  }
}

/** Count user messages currently in the conversation (each send adds one). */
function userMessageCount(): number {
  return getConversation(SESSION).messages.filter((m) => m.role === 'user').length
}

function queue(): ReturnType<typeof useStore.getState>['queues'][string] {
  return useStore.getState().queues[SESSION] ?? []
}

beforeEach(() => {
  useStore.setState({ queues: {} })
})

describe('withAttachmentBlock', () => {
  it('leaves the text untouched when there are no attachments', () => {
    expect(withAttachmentBlock('hello', [])).toBe('hello')
  })

  it('appends the file paths so the agent can read them', () => {
    const out = withAttachmentBlock('look at this', [attachment('a.txt')])
    expect(out).toContain('look at this')
    expect(out).toContain('<attached_files>')
    expect(out).toContain('/tmp/a.txt')
    expect(out).toContain('a.txt, text/plain')
  })

  it('emits just the block when there is no text', () => {
    const out = withAttachmentBlock('', [attachment('b.png')])
    expect(out.startsWith('<attached_files>')).toBe(true)
    expect(out).toContain('/tmp/b.png')
  })
})

describe('queue lifecycle', () => {
  it('queueMessage appends a follow-up without sending it', () => {
    const before = userMessageCount()
    useStore.getState().queueMessage(SESSION, 'do this next')
    expect(queue()).toHaveLength(1)
    expect(queue()[0].text).toBe('do this next')
    // Queuing must not reach the agent yet.
    expect(userMessageCount()).toBe(before)
  })

  it('ignores an empty queue entry', () => {
    useStore.getState().queueMessage(SESSION, '   ')
    expect(queue()).toHaveLength(0)
  })

  it('flushQueue sends only the head, preserving the rest', () => {
    useStore.getState().queueMessage(SESSION, 'first')
    useStore.getState().queueMessage(SESSION, 'second')
    const before = userMessageCount()
    useStore.getState().flushQueue(SESSION)
    expect(userMessageCount()).toBe(before + 1)
    expect(queue().map((m) => m.text)).toEqual(['second'])
  })

  it('flushQueue is a no-op on an empty queue', () => {
    const before = userMessageCount()
    useStore.getState().flushQueue(SESSION)
    expect(userMessageCount()).toBe(before)
  })

  it('steerQueued sends immediately and drops it from the queue', () => {
    useStore.getState().queueMessage(SESSION, 'urgent')
    const id = queue()[0].id
    const before = userMessageCount()
    useStore.getState().steerQueued(SESSION, id)
    expect(userMessageCount()).toBe(before + 1)
    expect(queue()).toHaveLength(0)
  })

  it('editQueued removes the message and returns it for the composer', () => {
    useStore.getState().queueMessage(SESSION, 'typo here', [attachment('x.txt')])
    const id = queue()[0].id
    const pulled = useStore.getState().editQueued(SESSION, id)
    expect(pulled?.text).toBe('typo here')
    expect(pulled?.attachments).toHaveLength(1)
    expect(queue()).toHaveLength(0)
  })

  it('removeQueued drops a message without sending', () => {
    useStore.getState().queueMessage(SESSION, 'a')
    useStore.getState().queueMessage(SESSION, 'b')
    const before = userMessageCount()
    useStore.getState().removeQueued(SESSION, queue()[0].id)
    expect(queue().map((m) => m.text)).toEqual(['b'])
    expect(userMessageCount()).toBe(before)
  })

  it('reorderQueued moves a message to a new position', () => {
    useStore.getState().queueMessage(SESSION, 'a')
    useStore.getState().queueMessage(SESSION, 'b')
    useStore.getState().queueMessage(SESSION, 'c')
    useStore.getState().reorderQueued(SESSION, 0, 2)
    expect(queue().map((m) => m.text)).toEqual(['b', 'c', 'a'])
  })

  it('reorderQueued ignores out-of-range indices', () => {
    useStore.getState().queueMessage(SESSION, 'a')
    useStore.getState().reorderQueued(SESSION, 5, 0)
    expect(queue().map((m) => m.text)).toEqual(['a'])
  })

  it('a steered message carries its attachment paths to the agent', () => {
    useStore.getState().queueMessage(SESSION, 'review this', [attachment('y.txt')])
    const id = queue()[0].id
    useStore.getState().steerQueued(SESSION, id)
    const last = getConversation(SESSION).messages.filter((m) => m.role === 'user').pop()
    expect(last).toBeDefined()
    const text = last!.parts
      .map((p) => (p.kind === 'text' ? p.text : ''))
      .join('')
    expect(text).toContain('/tmp/y.txt')
  })
})
