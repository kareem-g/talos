/**
 * Prose — assistant text with the desktop's inline markdown treatment.
 *
 * Ports the same three layers the desktop uses, so a message reads identically:
 *   `splitFences`  → fenced blocks become Code cards, the rest stays prose;
 *   `parseBlocks`  → headings, bullets and numbered lists become real rows;
 *   `inlineMarkdown` / `inlineChips` → `code`, **bold** and @/$#/ tokens get
 *   their own styling inside a paragraph.
 *
 * Native differences, all forced by the platform:
 *   - `numberOfLines` replaces `truncate`/`line-clamp-*`;
 *   - the streaming caret is an animated bar, not a `::after` pseudo-element;
 *   - text wraps natively, so `whitespace-pre-wrap`/`break-words` are the
 *     default rather than classes.
 */

import * as React from 'react'
import { Animated, Text, View, type TextStyle } from 'react-native'

import { cn } from '@/lib/format'
import { CopyButton, Mono } from '@app/components/ui'

/* ── Fences ──────────────────────────────────────────────────────────────── */

interface Segment {
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

/* ── Block parsing ───────────────────────────────────────────────────────── */

type Block =
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

/* ── Inline styling ──────────────────────────────────────────────────────── */

const INLINE_RE = /(`[^`]+`|\*\*[^*]+\*\*)/
const TOKEN_RE = /([@$#/])(\S+)/

/** `code`, **bold**, and @/$#/ tokens inside one line of prose. */
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
        <Text key={`c${pieceIndex}`} className="font-mono text-[11.5px] text-ink-2">
          {' '}
          {piece.slice(1, -1)}{' '}
        </Text>,
      )
      return
    }
    if (piece.startsWith('**') && piece.endsWith('**') && piece.length > 4) {
      nodes.push(
        <Text key={`b${pieceIndex}`} className="font-medium text-ink">
          {piece.slice(2, -2)}
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
      const tone =
        sigil === '@'
          ? 'bg-green-tint text-green'
          : sigil === '$'
            ? 'bg-accent-tint text-accent'
            : sigil === '#'
              ? 'bg-accent-tint text-accent'
              : 'bg-orange-tint text-orange'
      nodes.push(
        <Text key={`k${pieceIndex}-${chunkIndex}`} className={cn('text-[12px] font-medium', tone)}>
          <Text className="opacity-60">{sigil}</Text>
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

/* ── Code ────────────────────────────────────────────────────────────────── */

export function Code({ lang, body }: { lang?: string; body: string }) {
  return (
    <View className="my-0.5 overflow-hidden rounded-lg border border-line bg-inset">
      <View className="flex-row items-center justify-between border-b border-line bg-surface px-2.5 py-1">
        <Mono className="text-[10px] uppercase tracking-wider">{lang ?? 'code'}</Mono>
        <CopyButton value={body} />
      </View>
      <Mono className="px-3 py-2.5 text-[11.5px] leading-5 text-ink-2">{body}</Mono>
    </View>
  )
}

/* ── Streaming caret ─────────────────────────────────────────────────────── */

/** The blinking accent bar the desktop shows on the last streaming paragraph. */
export function Caret() {
  const opacity = React.useRef(new Animated.Value(1)).current
  React.useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, { toValue: 0, duration: 550, useNativeDriver: true }),
        Animated.timing(opacity, { toValue: 1, duration: 550, useNativeDriver: true }),
      ]),
    )
    loop.start()
    return () => loop.stop()
  }, [opacity])
  return <Animated.View style={{ opacity }} className="ml-0.5 h-4 w-[3px] self-end rounded-full bg-accent" />
}

/* ── Prose ───────────────────────────────────────────────────────────────── */

const HEADING_SIZE: Record<number, string> = {
  1: 'text-[16px]',
  2: 'text-[14.5px]',
  3: 'text-[13.5px]',
  4: 'text-[13.5px]',
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
    <View className="flex flex-col gap-2.5">
      {segments.map((segment, segmentIndex) => {
        const last = segmentIndex === segments.length - 1
        if (segment.code) {
          return <Code key={segmentIndex} lang={segment.lang} body={segment.body} />
        }
        const blocks = parseBlocks(segment.body)
        return (
          <View key={segmentIndex} className="flex flex-col gap-2">
            {blocks.map((block, blockIndex) => {
              const isLastBlock = streaming && last && blockIndex === blocks.length - 1
              if (block.kind === 'heading') {
                return (
                  <InlineText
                    key={blockIndex}
                    text={block.text}
                    className={cn('font-semibold text-ink', HEADING_SIZE[block.level] ?? 'text-[13.5px]')}
                    chips={chips}
                  />
                )
              }
              if (block.kind === 'bullets' || block.kind === 'ordered') {
                return (
                  <View key={blockIndex} className="flex flex-col gap-1.5">
                    {block.items.map((item, itemIndex) => (
                      <View key={itemIndex} className="flex-row gap-2">
                        <Mono className="mt-0.5 w-4 shrink-0 text-[11.5px] text-ink-3">
                          {block.kind === 'bullets' ? '•' : `${itemIndex + 1}.`}
                        </Mono>
                        <InlineText
                          text={item}
                          className="flex-1 text-[14px] leading-6 text-ink"
                          chips={chips}
                        />
                      </View>
                    ))}
                  </View>
                )
              }
              return (
                <View key={blockIndex} className="flex-row">
                  <InlineText
                    text={block.text}
                    className="flex-1 text-[14px] leading-6 text-ink"
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
  return <InlineText text={text} className="text-[14px] leading-6 text-ink" chips />
}
