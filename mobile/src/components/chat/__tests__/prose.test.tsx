/**
 * Render cover for the chat's markdown path.
 *
 * The failure this guards against is a transcript that shows the agent's raw
 * markdown — `# Heading`, `**bold**`, fenced code — instead of rendering it. So
 * every case asserts both directions: the content survives, and the markers that
 * produced it do not.
 *
 * Rendered with `react-test-renderer` rather than @testing-library/react-native:
 * RNTL 14 ships both `src/` and `dist/`, and under jest-expo a test file resolves
 * one copy while the library's own imports resolve the other, which leaves its
 * `screen` singleton unwired.
 */

import * as React from 'react'
import TestRenderer from 'react-test-renderer'

import { parseBlocks, Prose, splitFences } from '@app/components/chat/prose'

/** Every string the renderer produced, concatenated. */
function renderedText(element: React.ReactElement): string {
  let collected = ''
  const walk = (node: unknown): void => {
    if (typeof node === 'string') {
      collected += node
      return
    }
    if (Array.isArray(node)) {
      for (const child of node) walk(child)
      return
    }
    if (node && typeof node === 'object' && 'children' in node) {
      walk((node as { children: unknown }).children)
    }
  }
  let tree: TestRenderer.ReactTestRenderer
  TestRenderer.act(() => {
    tree = TestRenderer.create(element)
  })
  walk(tree!.toJSON())
  TestRenderer.act(() => {
    tree!.unmount()
  })
  return collected
}

describe('Prose', () => {
  it('renders headings, bullets and paragraphs instead of their markers', () => {
    const text = renderedText(
      <Prose text={'# Ship the port\n\n- first step\n- second step\n\nPlain paragraph here.'} />,
    )
    expect(text).toContain('Ship the port')
    expect(text).toContain('first step')
    expect(text).toContain('Plain paragraph here.')
    // Markers must be consumed by the parser, never printed.
    expect(text).not.toContain('# Ship')
    expect(text).not.toContain('- first step')
  })

  it('renders fenced code with its language and no fence markers', () => {
    const text = renderedText(<Prose text={'before\n```ts\nconst a = 1\n```\nafter'} />)
    expect(text).toContain('const a = 1')
    expect(text).toContain('ts')
    expect(text).not.toContain('```')
  })

  it('renders inline bold and code without their asterisks and backticks', () => {
    const text = renderedText(<Prose text={'Use **npm test** and `cargo check` to verify.'} />)
    expect(text).toContain('npm test')
    expect(text).toContain('cargo check')
    expect(text).not.toContain('**')
    expect(text).not.toContain('`cargo check`')
  })

  it('renders ordered lists with their numbering', () => {
    const text = renderedText(<Prose text={'1. one\n2. two'} />)
    expect(text).toContain('one')
    expect(text).toContain('1.')
    expect(text).not.toContain('1. one')
  })

  it('renders h2 and h3 headings', () => {
    const text = renderedText(<Prose text={'## Section\n\n### Subsection'} />)
    expect(text).toContain('Section')
    expect(text).toContain('Subsection')
    expect(text).not.toContain('##')
  })

  it('renders @ and / tokens from a user message', () => {
    const text = renderedText(<Prose text={'Look at @src/lib/api.ts and run /compact'} chips />)
    expect(text).toContain('src/lib/api.ts')
    expect(text).toContain('compact')
  })
})

describe('parseBlocks', () => {
  it('keeps a numbered list separate from surrounding prose', () => {
    expect(parseBlocks('intro\n\n1. one\n2. two\n\noutro')).toEqual([
      { kind: 'paragraph', text: 'intro' },
      { kind: 'ordered', items: ['one', 'two'] },
      { kind: 'paragraph', text: 'outro' },
    ])
  })
})

describe('splitFences', () => {
  it('alternates prose and code around a fenced block', () => {
    expect(splitFences('a\n```js\ncode\n```\nb')).toEqual([
      { code: false, body: 'a\n' },
      { code: true, lang: 'js', body: 'code\n' },
      { code: false, body: '\nb' },
    ])
  })

  /**
   * A single-line fence has no body: its first line is the language tag. The
   * desktop parses it the same way, so an inline ```hi``` reads as a language
   * rather than as content. Pinned so that parity stays deliberate.
   */
  it('treats a single-line fence as a language tag with an empty body', () => {
    expect(splitFences('say ```hi``` now')).toEqual([
      { code: false, body: 'say ' },
      { code: true, lang: 'hi', body: '' },
      { code: false, body: ' now' },
    ])
  })
})
