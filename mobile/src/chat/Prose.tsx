/**
 * Prose — the agent's typography: fenced code on the machine plate, a
 * markdown-lite body at reading size, inline `code` chips. The parser is
 * line-based on purpose — the same contract the desktop's parseBlocks
 * follows, minus nesting a phone never shows.
 */

import { View } from 'react-native'
import { Text } from '../ui'
import { color } from '../design/tokens'
import { MONO, W_SEMI } from '../design/fonts'

export function splitFences(text: string): Array<{ code: boolean; lang?: string; body: string }> {
  const segments: Array<{ code: boolean; lang?: string; body: string }> = []
  let current: { code: boolean; lang?: string; body: string[] } | null = null
  for (const line of text.split('\n')) {
    const fence = /^\s*```(\w+)?\s*$/.exec(line)
    if (fence) {
      if (current?.code) {
        segments.push({ code: true, lang: current.lang, body: current.body.join('\n') })
        current = null
      } else {
        if (current) segments.push({ code: false, body: current.body.join('\n') })
        current = { code: true, lang: fence[1], body: [] }
      }
      continue
    }
    if (!current) current = { code: false, body: [] }
    current.body.push(line)
  }
  if (current) segments.push({ code: current.code, lang: current.lang, body: current.body.join('\n') })
  return segments.filter((segment) => segment.body.length > 0 || segment.code)
}

/**
 * One line of prose: inline `code` chips and **emphasis**, the two marks agents
 * actually emit mid-sentence. Splitting on both in one pass keeps the emphasis
 * inside a code chip from being mistaken for markdown — `**` is only a marker
 * when it is *outside* a fence.
 */
function InlineCode({ text }: { text: string }) {
  const parts = text.split(/(`[^`]+`|\*\*[^*]+\*\*)/g).filter(Boolean)
  return (
    <Text className="text-body leading-[24px] text-ink">
      {parts.map((part, index) => {
        if (part.startsWith('`') && part.endsWith('`')) {
          return (
            <Text key={index} className="text-mono-small text-sky" style={{ fontFamily: MONO, backgroundColor: color.field, borderRadius: 5 }}>
              {part.slice(1, -1)}
            </Text>
          )
        }
        if (part.startsWith('**') && part.endsWith('**')) {
          return (
            <Text key={index} className="font-semibold" weight={W_SEMI}>
              {part.slice(2, -2)}
            </Text>
          )
        }
        return <Text key={index}>{part}</Text>
      })}
    </Text>
  )
}

export function Code({ text, lang }: { text: string; lang?: string }) {
  return (
    <View className="overflow-hidden rounded-[12px] bg-plate">
      {lang ? (
        <View className="border-b border-line px-3 py-1.5">
          <Text className="text-[10px] uppercase text-ink-3" style={{ fontFamily: MONO, letterSpacing: 0.8 }}>
            {lang}
          </Text>
        </View>
      ) : null}
      <Text className="px-3 py-2.5 text-[12px] leading-[18px] text-term-fg" style={{ fontFamily: MONO }}>
        {text}
      </Text>
    </View>
  )
}

function Blocks({ text }: { text: string }) {
  return (
    <View className="gap-2">
      {text.split('\n').map((line, index) => {
        if (!line.trim()) return null
        const heading = /^(#{1,4})\s+(.*)$/.exec(line)
        if (heading) {
          const depth = heading[1].length
          return (
            <Text
              key={index}
              className="text-ink"
              weight={W_SEMI}
              style={{
                fontWeight: '600',
                fontSize: depth === 1 ? 20 : depth === 2 ? 17 : 15.5,
                lineHeight: depth === 1 ? 26 : depth === 2 ? 23 : 24,
                marginTop: index === 0 ? 0 : 6,
              }}
            >
              {heading[2]}
            </Text>
          )
        }
        const bullet = /^\s*[-*•]\s+(.*)$/.exec(line)
        if (bullet) {
          return (
            <View key={index} className="flex-row gap-2.5 pl-1">
              <Text className="mt-[9px] text-ink-3">•</Text>
              <View className="min-w-0 flex-1">
                <InlineCode text={bullet[1]} />
              </View>
            </View>
          )
        }
        return (
          <View key={index}>
            <InlineCode text={line} />
          </View>
        )
      })}
    </View>
  )
}

export function Prose({ text }: { text: string }) {
  return (
    <View className="gap-2.5 px-[18px]">
      {splitFences(text).map((segment, index) =>
        segment.code ? <Code key={index} text={segment.body} lang={segment.lang} /> : <Blocks key={index} text={segment.body} />,
      )}
    </View>
  )
}