/**
 * Composer tokens — the `$skill`, `@file` and `/command` references a prompt can
 * carry, and the colour each one wears.
 *
 * The desktop colours them inline, in the field as you type and in every
 * message you send, so a prompt reads as prose *plus* the things the agent will
 * resolve. The phone does the same thing with the same three marks and the same
 * colours, from one parser, so the field and the transcript can never disagree
 * about what a token is.
 *
 * Colour is not decoration here: `$review` and the word "review" mean different
 * things to the agent, and the hue is what tells them apart at a glance.
 */

import { Text } from '../ui'
import type { StyleProp, TextStyle } from 'react-native'

export type TokenKind = 'at' | 'skill' | 'slash'

export interface TokenTone {
  /** Class for the glyph and the label. */
  ink: string
  /** Class for the chip behind them. */
  fill: string
}

/** `@` files are green, `$` skills purple, `/` commands orange — the desktop's. */
export const TOKEN_TONE: Record<TokenKind, TokenTone> = {
  at: { ink: 'text-green', fill: 'bg-green-tint' },
  skill: { ink: 'text-purple', fill: 'bg-purple-tint' },
  slash: { ink: 'text-orange', fill: 'bg-orange-tint' },
}

export type Segment =
  | { kind: 'text'; text: string }
  | { kind: TokenKind; trigger: string; label: string }

/**
 * A token is a trigger followed by a run of non-space characters. `/` only
 * counts at a word boundary — otherwise "and/or" would light up as a command.
 */
const TOKEN_RE = /([@$/])(\S+)/g

export function parseSegments(text: string): Segment[] {
  const segments: Segment[] = []
  let last = 0
  for (const match of text.matchAll(TOKEN_RE)) {
    const index = match.index ?? 0
    const trigger = match[1]
    if (trigger === '/' && index > 0 && !/\s/.test(text[index - 1])) continue
    if (index > last) segments.push({ kind: 'text', text: text.slice(last, index) })
    const kind: TokenKind = trigger === '@' ? 'at' : trigger === '$' ? 'skill' : 'slash'
    segments.push({ kind, trigger, label: match[2] })
    last = index + match[0].length
  }
  if (last < text.length) segments.push({ kind: 'text', text: text.slice(last) })
  return segments
}

/** True when the draft carries at least one token — the field only needs its
 *  colour layer when there is something to colour. */
export function hasToken(text: string): boolean {
  return parseSegments(text).some((segment) => segment.kind !== 'text')
}

/**
 * The draft (or a sent prompt) with its tokens coloured. `label` width is
 * bounded so one long path cannot push the line apart.
 */
export function TokenText({
  text,
  className,
  style,
  trailing,
  chip,
}: {
  text: string
  className?: string
  style?: StyleProp<TextStyle>
  /** A trailing space keeps the last line's height in step with the field. */
  trailing?: boolean
  /**
   * Draw each token on a dark chip. A sent prompt sits on the blue bubble,
   * where a bare hue has nothing to sit on — the chip gives the colour a
   * surface without giving up which token is which.
   */
  chip?: boolean
}) {
  const segments = parseSegments(text)
  return (
    <Text className={className} style={style}>
      {segments.map((segment, index) =>
        segment.kind === 'text' ? (
          <Text key={index}>{segment.text}</Text>
        ) : (
          <Text
            key={index}
            className={TOKEN_TONE[segment.kind].ink}
            style={chip ? { backgroundColor: 'rgba(0, 0, 0, 0.28)' } : undefined}
          >
            {segment.trigger}
            {segment.label}
          </Text>
        ),
      )}
      {trailing ? ' ' : null}
    </Text>
  )
}

/** The token ending at the caret, if the caret sits in one. */
export function activeToken(
  text: string,
  caret: number,
): { kind: TokenKind; query: string; start: number } | null {
  const line = text.slice(0, caret)
  const match = /([@$/])(\S*)$/.exec(line)
  if (!match) return null
  const start = caret - match[0].length
  if (match[1] === '/' && start > 0 && !/\s/.test(text[start - 1])) return null
  const kind: TokenKind = match[1] === '@' ? 'at' : match[1] === '$' ? 'skill' : 'slash'
  return { kind, query: match[2], start }
}

/** Replace the active token with a chosen one, keeping the caret after it. */
export function insertToken(text: string, caret: number, trigger: string, value: string): string {
  const active = activeToken(text, caret)
  if (!active) return text
  return `${text.slice(0, active.start)}${trigger}${value} ${text.slice(caret)}`
}