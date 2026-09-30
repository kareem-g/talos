/**
 * Prose — assistant parchment with the desktop's inline markdown treatment.
 *
 * EMBER CLAY: fenced blocks become kiln wells (ember-ticked headers, copyable
 * mono), headings/bullets become real rows, `code`/bold/@tokens glow inline.
 * Agent prose stays 15px/21px for arm's-length reading; the streaming caret
 * burns ember. Same splitFences/parseBlocks/inlineMarkdown handlers.
 */

import * as React from 'react'
import { Animated, ScrollView, Text, View, type TextStyle } from 'react-native'

import { cn } from '@/lib/format'
import { agentHue, palette, radius } from '@app/design/tokens'
import {
  CopyButton,
  Mono,
  Well,
} from '@app/components/ui'

/* ── Fences ──────────────────────────────────────────────────────────────────── */

export interface Segment {
  code: boolean
  lang?: string
  body: string
}

/** Split on ``` fences; odd segments are code. Ported from the desktop. */
export function splitFences(text: string): Segment[] {
  const parts = text.split('```')
  const segments: Segment[] = []
  for (let index = 0; index < parts.length; index++) {
    const body = parts[index]
    if (index % 2 === 1) {
      const newline = body.indexOf('\n')
      const first = newline === -1 ? body : body.slice(0, newline)
      const rest = newline === -1 ? '' : body.slice(newline + 1)
      const lang = /^[\w+-]*$/.test(first.trim()) ? first.trim() : ''
      segments.push({ code: true, lang: lang || undefined, body: lang ? rest : body })
    } else if (body.length > 0) {
      segments.push({ code: false, body })
    }
  }
  return segments
}

/* ── Block parsing ──────────────────────────────────────────────────────────── */

export type Block =
  | { kind: 'heading'; level: number; text: string }
  | { kind: 'bullets'; items: string[] }
  | { kind: 'ordered'; items: string[] }
  | { kind: 'paragraph'; text: string }

/** Headings, bullets, numbered lists, and blank-line paragraphs. */
export function parseBlocks(text: string): Block[] {
  const lines = text.split('\n')
  const blocks: Block[] = []
  let paragraph: string[] = []
  let bullets: string[] = []
  let ordered: string[] = []

  const flush = () => {
    if (bullets.length) {
      blocks.push({ kind: 'bullets', items: bullets })
      bullets = []
    }
    if (ordered.length) {
      blocks.push({ kind: 'ordered', items: ordered })
      ordered = []
    }
    if (paragraph.length) {
      blocks.push({ kind: 'paragraph', text: paragraph.join('\n') })
      paragraph = []
    }
  }

  for (const line of lines) {
    const heading = /^(#{1,4})\s+(.*)$/.exec(line)
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line)
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line)
    if (heading) {
      flush()
      blocks.push({ kind: 'heading', level: heading[1].length, text: heading[2] })
    } else if (bullet) {
      if (paragraph.length || ordered.length) flush()
      bullets.push(bullet[1])
    } else if (numbered) {
      if (paragraph.length || bullets.length) flush()
      ordered.push(numbered[1])
    } else if (line.trim() === '') {
      flush()
    } else {
      if (bullets.length || ordered.length) flush()
      paragraph.push(line)
    }
  }
  flush()
  return blocks
}

/* ── Inline styling ─────────────────────────────────────────────────────────── */

const INLINE_RE = /(`[^`]+`|\*\*[^*]+\*\*|\[[^\]]+\]\([^)]+\))/
const TOKEN_RE = /([@$#/])(\S+)/

/** `code`, **bold**, links, and @/$#/ tokens inside one line of prose. */
function InlineText({
  text,
  className,
  style,
  chips,
}: {
  text: string
  className?: string
  style?: TextStyle
  chips?: boolean
}) {
  const nodes: React.ReactNode[] = []
  const pieces = text.split(INLINE_RE)
  pieces.forEach((piece, pieceIndex) => {
    if (!piece) return
    if (piece.startsWith('`') && piece.endsWith('`') && piece.length > 2) {
      nodes.push(
        <Text
          key={`c${pieceIndex}`}
          style={{
            fontFamily: 'Menlo',
            fontSize: 13,
            color: palette.accent,
            backgroundColor: palette.accentSoft,
          }}
        >
          {' '}
          {piece.slice(1, -1)}{' '}
        </Text>,
      )
      return
    }
    if (piece.startsWith('**') && piece.endsWith('**') && piece.length > 4) {
      nodes.push(
        <Text key={`b${pieceIndex}`} style={{ fontWeight: '600', color: palette.ink }}>
          {piece.slice(2, -2)}
        </Text>,
      )
      return
    }
    const link = /^\[([^\]]+)\]\(([^)]+)\)$/.exec(piece)
    if (link) {
      // A link is the one inline thing that must be distinguishable without
      // colour too, so it is underlined as well as tinted.
      nodes.push(
        <Text
          key={`l${pieceIndex}`}
          style={{ color: palette.accent, textDecorationLine: 'underline' }}
        >
          {link[1]}
        </Text>,
      )
      return
    }
    if (!chips) {
      nodes.push(<Text key={`t${pieceIndex}`}>{piece}</Text>)
      return
    }
    // Token chips: split the remainder on @/$#/ sigils, keeping the sigil.
    const chunks = piece.split(new RegExp(`(?=${TOKEN_RE.source.slice(1, -1)})`))
    chunks.forEach((chunk, chunkIndex) => {
      const match = TOKEN_RE.exec(chunk)
      if (!match) {
        if (chunk) nodes.push(<Text key={`x${pieceIndex}-${chunkIndex}`}>{chunk}</Text>)
        return
      }
      const sigil = match[1]
      const label = match[2].replace(/\(.*\)$/, '').replace(/\/$/, '')
      // `@file` green, `$skill` violet, `#conversation` blue, `/command` amber.
      // Violet is the one hue here that is not a status colour, and it is
      // deliberate: a skill reference names a *kind of thing*, not a state, and
      // borrowing a status hue would make it read as "this is wrong".
      const color =
        sigil === '@'
          ? palette.ok
          : sigil === '$'
            ? agentHue.opencode
            : sigil === '#'
              ? palette.info
              : palette.wait
      nodes.push(
        <Text key={`k${pieceIndex}-${chunkIndex}`} style={{ color, fontWeight: '600' }}>
          <Text style={{ opacity: 0.55 }}>{sigil}</Text>
          {label}
        </Text>,
      )
    })
  })
  return (
    <Text className={className} style={style}>
      {nodes}
    </Text>
  )
}

/* ── Code ──────────────────────────────────────────────────────────────────────
 * A code block on a phone is a *scrolling* object, not a paragraph. It is
 * horizontally scrollable and never wraps: a wrapped diff is unreadable, and
 * a code block that is not scrollable silently truncates the right-hand side,
 * which for a shell command is the part that matters. */

export function Code({ lang, body }: { lang?: string; body: string }) {
  return (
    <Well className="overflow-hidden border border-line" style={{ borderRadius: radius.md }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          borderBottomWidth: 1,
          borderBottomColor: palette.line,
          backgroundColor: palette.well,
          paddingHorizontal: 14,
          paddingVertical: 8,
        }}
      >
        <Mono className="text-[10px] uppercase text-ink-3" style={{ letterSpacing: 1 }}>
          {lang ?? 'code'}
        </Mono>
        <CopyButton value={body} />
      </View>
      <Scrollable>
        <Mono className="px-3.5 py-3 text-[12.5px] leading-[19px] text-code-ink">{body}</Mono>
      </Scrollable>
    </Well>
  )
}

/** A horizontal scroller for anything that must not wrap. */
function Scrollable({ children, maxHeight }: { children: React.ReactNode; maxHeight?: number }) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      style={maxHeight ? { maxHeight } : undefined}
      contentContainerStyle={{ minWidth: '100%' }}
    >
      {children}
    </ScrollView>
  )
}

/* ── Streaming caret ────────────────────────────────────────────────────────── */

/** The blinking accent bar the desktop shows on the last streaming paragraph. */
export function Caret() {
  const opacity = React.useRef(new Animated.Value(1)).current
  React.useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0, duration: 520, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 520, useNativeDriver: true }),
      ]),
    )
    loop.start()
    return () => loop.stop()
  }, [opacity])
  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{
        opacity,
        marginLeft: 3,
        height: 17,
        width: 3,
        alignSelf: 'flex-end',
        borderRadius: 2,
        backgroundColor: palette.accent,
      }}
    />
  )
}

/* ── Prose ──────────────────────────────────────────────────────────────────────
 * Block spacing is 10pt between blocks and 2pt between list items. A dense
 * document is not what this is: it is a stream of answers, and the spacing has
 * to make the *shape* of one answer readable at a glance before you read it. */

const HEADING_STYLE: Record<number, TextStyle> = {
  1: { fontSize: 20, lineHeight: 27, fontWeight: '700', letterSpacing: -0.4, color: palette.ink },
  2: { fontSize: 17.5, lineHeight: 24, fontWeight: '700', letterSpacing: -0.3, color: palette.ink },
  3: { fontSize: 16, lineHeight: 22, fontWeight: '600', letterSpacing: -0.15, color: palette.ink },
  // h4 is the "fine print heading" level: same weight, one step quieter, which
  // is the only thing distinguishing it from body text.
  4: { fontSize: 15.5, lineHeight: 21, fontWeight: '600', color: palette.ink2 },
}

export function Prose({
  text,
  streaming,
  chips,
}: {
  text: string
  streaming?: boolean
  chips?: boolean
}) {
  const segments = React.useMemo(() => splitFences(text), [text])

  return (
    <View style={{ gap: 12 }}>
      {segments.map((segment, segmentIndex) => {
        const last = segmentIndex === segments.length - 1
        if (segment.code) {
          return <Code key={segmentIndex} lang={segment.lang} body={segment.body} />
        }
        const blocks = parseBlocks(segment.body)
        return (
          <View key={segmentIndex} style={{ gap: 12 }}>
            {blocks.map((block, blockIndex) => {
              const isLastBlock = streaming && last && blockIndex === blocks.length - 1
              if (block.kind === 'heading') {
                return (
                  <InlineText
                    key={blockIndex}
                    text={block.text}
                    style={HEADING_STYLE[block.level] ?? HEADING_STYLE[3]}
                    chips={chips}
                  />
                )
              }
              if (block.kind === 'bullets' || block.kind === 'ordered') {
                return (
                  <View key={blockIndex} style={{ gap: 7 }}>
                    {block.items.map((item, itemIndex) => (
                      <View key={itemIndex} style={{ flexDirection: 'row', gap: 10 }}>
                        <Mono className="w-4 text-[14px] leading-[23px] text-ink-3">
                          {block.kind === 'bullets' ? '•' : `${itemIndex + 1}.`}
                        </Mono>
                        <InlineText
                          text={item}
                          style={{ flex: 1, fontSize: 15.5, lineHeight: 23, color: palette.ink }}
                          chips={chips}
                        />
                      </View>
                    ))}
                  </View>
                )
              }
              return (
                <View key={blockIndex} style={{ flexDirection: 'row' }}>
                  <InlineText
                    text={block.text}
                    style={{ flex: 1, fontSize: 15.5, lineHeight: 23.5, color: palette.ink }}
                    chips={chips}
                  />
                  {isLastBlock ? <Caret /> : null}
                </View>
              )
            })}
          </View>
        )
      })}
    </View>
  )
}

/** User-message text: prose with inline token chips and `code`/bold styling. */
export function Chips({ text }: { text: string }) {
  return <InlineText text={text} style={{ fontSize: 15.5, lineHeight: 22.5, color: palette.ink }} chips />
}

export { cn }
