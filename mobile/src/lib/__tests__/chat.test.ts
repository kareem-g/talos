/**
 * Cover for the chat port's pure logic — the parts that can be wrong without
 * looking wrong on screen. The prose parser decides what becomes a code card vs a
 * bullet vs a heading, and the rail derivations decide what the Plan/Agents/Goal
 * tabs claim about a session; both are easy to break silently and worth pinning.
 */

import { parseBlocks, splitFences } from '@app/components/chat/prose'
import { deriveSubagents, hasRecentError, latestPlanInfo, latestUserPrompt } from '../sessionView'
import type { Message, MessagePart } from '@/types/conversation'

const CREATED = '2026-09-28T10:00:00.000Z'

/** Build a minimal assistant message around a set of parts. */
function assistant(parts: MessagePart[]): Message {
  return {
    id: `m-${Math.random().toString(36).slice(2, 8)}`,
    role: 'assistant',
    parts,
    sequence: 1,
    createdAt: CREATED,
    streaming: false,
  }
}

function user(text: string): Message {
  return {
    id: `u-${Math.random().toString(36).slice(2, 8)}`,
    role: 'user',
    parts: [{ kind: 'text', text, streaming: false }],
    sequence: 1,
    createdAt: CREATED,
    streaming: false,
  }
}

describe('splitFences', () => {
  it('alternates prose and code segments, keeping the language tag', () => {
    const segments = splitFences('before\n```ts\nconst a = 1\n```\nafter')
    expect(segments).toEqual([
      { code: false, body: 'before\n' },
      { code: true, lang: 'ts', body: 'const a = 1\n' },
      { code: false, body: '\nafter' },
    ])
  })

  it('treats an unterminated trailing fence as code', () => {
    const segments = splitFences('text\n```py\nprint(1)')
    expect(segments[1]).toEqual({ code: true, lang: 'py', body: 'print(1)' })
  })

  it('keeps a fence body intact when the first line is not a language', () => {
    const segments = splitFences('```\nplain body\n```')
    expect(segments).toEqual([{ code: true, lang: undefined, body: '\nplain body\n' }])
  })
})

describe('parseBlocks', () => {
  it('separates headings, bullets, ordered items and paragraphs', () => {
    const blocks = parseBlocks('# Title\n\n- one\n- two\n\n1. first\n2. second\n\nprose here')
    expect(blocks).toEqual([
      { kind: 'heading', level: 1, text: 'Title' },
      { kind: 'bullets', items: ['one', 'two'] },
      { kind: 'ordered', items: ['first', 'second'] },
      { kind: 'paragraph', text: 'prose here' },
    ])
  })

  it('only treats a dash as a bullet when a space follows', () => {
    // "-10 degrees" is prose, not a list item.
    expect(parseBlocks('-10 degrees')).toEqual([{ kind: 'paragraph', text: '-10 degrees' }])
  })

  it('keeps multi-line paragraphs together', () => {
    expect(parseBlocks('line one\nline two')).toEqual([
      { kind: 'paragraph', text: 'line one\nline two' },
    ])
  })
})

describe('latestPlanInfo', () => {
  it('reports the newest plan with the files changed after it', () => {
    const info = latestPlanInfo([
      assistant([{ kind: 'plan', title: 'Old', steps: ['a'], text: 'old body' }]),
      assistant([
        { kind: 'plan', title: 'Ship the port', steps: ['one', 'two'], text: '# Ship\nbody' },
        { kind: 'file', path: 'mobile/src/a.ts', ok: true },
        { kind: 'file', path: 'mobile/src/b.ts', ok: false },
      ]),
    ])
    expect(info?.title).toBe('Ship the port')
    expect(info?.stepCount).toBe(2)
    expect(info?.relatedFiles).toEqual(['mobile/src/a.ts', 'mobile/src/b.ts'])
    expect(info?.text).toBe('# Ship\nbody')
  })

  it('returns undefined when the session has no plan', () => {
    expect(latestPlanInfo([assistant([{ kind: 'text', text: 'hi', streaming: false }])])).toBeUndefined()
  })
})

describe('latestUserPrompt', () => {
  it('returns the newest user text, skipping assistant turns', () => {
    expect(
      latestUserPrompt([
        user('first prompt'),
        assistant([{ kind: 'text', text: 'answer', streaming: false }]),
        user('second prompt'),
      ]),
    ).toBe('second prompt')
  })
})

describe('hasRecentError', () => {
  it('looks only at the newest assistant turn', () => {
    expect(hasRecentError([assistant([{ kind: 'error', message: 'boom' }])])).toBe(true)
    expect(
      hasRecentError([
        assistant([{ kind: 'error', message: 'boom' }]),
        user('retry'),
        assistant([{ kind: 'text', text: 'fine now', streaming: false }]),
      ]),
    ).toBe(false)
  })
})

describe('deriveSubagents', () => {
  it('reads first-class subagent events', () => {
    const agents = deriveSubagents([
      assistant([
        {
          kind: 'subagent',
          id: 'sub-1',
          name: 'Audit the parsers',
          kindType: 'explore',
          status: 'running',
          startedAt: '2026-09-28T10:00:00.000Z',
        },
      ]),
    ])
    expect(agents).toEqual([
      { id: 'sub-1', name: 'Audit the parsers', kind: 'explore', status: 'working' },
    ])
  })

  it('falls back to Agent tool invocations and maps status', () => {
    const agents = deriveSubagents([
      assistant([
        {
          kind: 'tool',
          toolId: 'tool-9',
          name: 'Agent',
          input: JSON.stringify({ description: 'Map the routes', subagent_type: 'general' }),
          status: 'ok',
        },
      ]),
    ])
    expect(agents).toEqual([
      { id: 'tool-9', name: 'Map the routes', kind: 'general', status: 'completed' },
    ])
  })

  it('ignores ordinary tools and unparseable input', () => {
    expect(
      deriveSubagents([
        assistant([
          { kind: 'tool', toolId: 't1', name: 'Read', input: 'not json', status: 'ok' },
          { kind: 'tool', toolId: 't2', name: 'Edit', input: '{"file_path":"/a"}', status: 'ok' },
        ]),
      ]),
    ).toEqual([])
  })
})
