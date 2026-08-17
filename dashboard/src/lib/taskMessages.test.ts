import { describe, expect, it } from 'vitest'
import { buildThreadMessages, splitReasoning } from './taskMessages'

describe('splitReasoning', () => {
  it('returns the whole text when there is only one paragraph', () => {
    const [, reply] = splitReasoning('Just a single paragraph.')
    expect(reply).toBe('Just a single paragraph.')
  })

  it('returns undefined reasoning for a single paragraph', () => {
    const [reasoning] = splitReasoning('Just a single paragraph.')
    expect(reasoning).toBeUndefined()
  })

  it('treats monologue instruction blocks as reasoning', () => {
    const text =
      '. Follow all instructions in security-review/SK.md.\n\n' +
      'Hello! How can I help you today?'
    const [reasoning, reply] = splitReasoning(text)
    expect(reasoning).toContain('Follow all instructions')
    expect(reply).toContain('Hello')
  })

  it('treats bulleted skill lists as reasoning', () => {
    const text =
      '• search: A specialized search skill\n' +
      '• edit: Make precise modifications\n\n' +
      'Sure, I can help with that.'
    const [reasoning, reply] = splitReasoning(text)
    expect(reasoning).toContain('search')
    expect(reply).toContain('Sure')
  })

  it('does not split a normal multi-paragraph reply without monologue', () => {
    const text = 'First paragraph of a normal reply.\n\nSecond paragraph, still prose.'
    const [reasoning, reply] = splitReasoning(text)
    expect(reasoning).toBeUndefined()
    expect(reply).toContain('First paragraph')
    expect(reply).toContain('Second paragraph')
  })
})

describe('buildThreadMessages', () => {
  const baseContext = {
    items: [],
    optimistic: [],
    working: false,
    streamingId: null,
    pendingApprovalIds: new Set<string>(),
    pendingQuestionIds: new Set<string>(),
    resolvedDecisionById: new Map<string, string>(),
    rawEvents: new Map(),
  }

  it('creates one assistant message per agent turn with stable ids', () => {
    const messages = buildThreadMessages({
      ...baseContext,
      items: [
        { id: 'user-1', kind: 'user', content: 'hey', timestamp: '2024-01-01T00:00:00Z' },
        { id: 'event-1', kind: 'agent', content: 'Hello there', timestamp: '2024-01-01T00:00:01Z' },
      ],
    })
    expect(messages).toHaveLength(2)
    expect(messages[0].role).toBe('user')
    expect(messages[1].role).toBe('assistant')
  })

  it('keeps monolithic transcript prose as text without heuristic reasoning', () => {
    const monologue =
      '. Follow all instructions in security-review/SK.md.\n\n' +
      'Hello! How can I help you today?'
    const messages = buildThreadMessages({
      ...baseContext,
      items: [{ id: 'event-1', kind: 'agent', content: monologue, timestamp: '2024-01-01T00:00:01Z' }],
    })
    const content = messages[0].content as readonly { type: string; text?: string }[]
    expect(content.map((part) => part.type)).toEqual(['text'])
    expect(content[0].text).toContain('Hello')
  })

  it('shows a real thinking part on the first optimistic turn', () => {
    const messages = buildThreadMessages({
      ...baseContext,
      optimistic: [{ id: 'user-1', content: 'hello chat' }],
      optimisticRunning: true,
    })
    expect(messages.at(-1)?.role).toBe('assistant')
    expect((messages.at(-1)?.content as readonly { type: string }[]).map((part) => part.type)).toContain('reasoning')
  })

  it('does not turn a repeated user prompt into assistant text', () => {
    const messages = buildThreadMessages({
      ...baseContext,
      items: [
        { id: 'user-1', kind: 'user', content: 'hello chat', timestamp: '2024-01-01T00:00:00Z' },
        { id: 'event-1', kind: 'agent', content: 'hello chat', timestamp: '2024-01-01T00:00:01Z' },
      ],
    })
    expect(messages).toHaveLength(1)
    expect(messages[0].role).toBe('user')
  })

  it('keeps non-monolithic assistant text as a single text part', () => {
    const messages = buildThreadMessages({
      ...baseContext,
      items: [{ id: 'event-1', kind: 'agent', content: 'A straightforward answer.', timestamp: '2024-01-01T00:00:01Z' }],
    })
    const assistant = messages[0]
    const content = assistant.content as readonly { type: string }[]
    const textParts = content.filter((part) => part.type === 'text')
    expect(textParts).toHaveLength(1)
    expect((textParts[0] as unknown as { text: string }).text).toBe('A straightforward answer.')
  })
})
