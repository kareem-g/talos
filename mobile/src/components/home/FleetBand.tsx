/**
 * The fleet band — the whole station as one strip.
 *
 * This is the Deck's thesis in a single component. A phone is asked one
 * question — *does anything need me?* — and a list answers it only if you read
 * it. Eighteen sessions read at a glance as a shape: blocked ones are tallest
 * and drawn in paper ink, live ones are the accent, failures are red, and the
 * quiet majority are hairlines you can ignore.
 *
 * It is ordered, not sorted by recency: the states that need a human come
 * first, because the tick you can find without scanning is the whole point.
 * Every tick is a jump target.
 *
 * Colour is never the only channel here either — the legend names each state,
 * and the counts above the strip are the same numbers in words.
 */

import * as React from 'react'
import {Pressable, View} from 'react-native'
import { Text } from '@app/components/Text'

import type { Session, SessionStatus } from '@/types/session'
import { Eyebrow, Mono, haptic } from '@app/components/ui'
import { palette } from '@app/design/tokens'
import { cn } from '@/lib/format'

/** Which of the four signals a session is carrying. */
type Signal = 'blocked' | 'live' | 'failed' | 'quiet'

function signalOf(status: SessionStatus): Signal {
  switch (status) {
    case 'waiting_for_approval':
    case 'waiting_for_input':
      return 'blocked'
    case 'error':
      return 'failed'
    case 'running':
    case 'starting':
    case 'resuming':
      return 'live'
    default:
      return 'quiet'
  }
}

/** Tallest first, and the order the strip is drawn in. */
const RANK: Record<Signal, number> = { blocked: 0, live: 1, failed: 2, quiet: 3 }

const FILL: Record<Signal, string> = {
  blocked: palette.ink,
  live: palette.accent,
  failed: palette.danger,
  quiet: palette.lineStrong,
}

const HEIGHT: Record<Signal, number> = { blocked: 30, live: 20, failed: 26, quiet: 8 }

export function FleetBand({
  sessions,
  onOpen,
  className,
}: {
  sessions: Session[]
  onOpen: (sessionId: string) => void
  className?: string
}) {
  const ordered = React.useMemo(() => {
    return sessions
      .map((session) => ({ session, signal: signalOf(session.status) }))
      .sort((a, b) => RANK[a.signal] - RANK[b.signal] || b.session.updated_at.localeCompare(a.session.updated_at))
  }, [sessions])

  const blocked = ordered.filter((entry) => entry.signal === 'blocked').length
  const failed = ordered.filter((entry) => entry.signal === 'failed').length
  const live = ordered.filter((entry) => entry.signal === 'live').length

  // Only the states a human acts on are named above the strip. "3 live" and
  // "1 failed" change what you do next; "14 idle" does not.
  const summary = [
    blocked > 0 ? { label: `${blocked} blocked`, colour: palette.ink } : null,
    live > 0 ? { label: `${live} live`, colour: palette.accent } : null,
    failed > 0 ? { label: `${failed} failed`, colour: palette.danger } : null,
  ].filter(Boolean) as Array<{ label: string; colour: string }>

  return (
    <View className={cn('rounded-lg border border-line bg-surface px-4 py-3.5', className)}>
      <View className="flex-row items-center gap-2">
        <Eyebrow>{`Fleet · ${sessions.length} ${sessions.length === 1 ? 'session' : 'sessions'}`}</Eyebrow>
        <View className="flex-1" />
        {summary.length === 0 ? (
          <Mono className="text-[10px] uppercase text-ink-3">All clear</Mono>
        ) : (
          summary.map((entry) => (
            <Mono key={entry.label} className="text-[10px] uppercase" style={{ color: entry.colour }}>
              {entry.label}
            </Mono>
          ))
        )}
      </View>

      <View className="mt-3 flex-row items-end gap-[3px]" style={{ height: 32 }}>
        {sessions.length === 0 ? (
          // An empty fleet still draws its frame — the band is a fixed piece of
          // furniture, not a component that appears once there is data.
          <View className="flex-1 flex-row items-end gap-[3px]">
            {Array.from({ length: 12 }).map((_, index) => (
              <View key={index} style={{ flex: 1, height: 5, borderRadius: 2, backgroundColor: palette.line }} />
            ))}
          </View>
        ) : (
          ordered.map(({ session, signal }) => (
            <Pressable
              key={session.id}
              accessibilityRole="button"
              accessibilityLabel={`${session.name}. ${session.status.replace(/_/g, ' ')}.`}
              accessibilityHint="Opens this session"
              onPress={() => {
                void haptic('select')
                onOpen(session.id)
              }}
              // The tap target is the full strip height even when the tick is
              // 8pt tall — the visual encodes the state, the target serves the
              // thumb, and they are allowed to disagree.
              style={{ flex: 1, height: 32, justifyContent: 'flex-end' }}
            >
              <View
                style={{
                  height: HEIGHT[signal],
                  minWidth: 3,
                  borderRadius: 2,
                  backgroundColor: FILL[signal],
                }}
              />
            </Pressable>
          ))
        )}
      </View>

      <View className="mt-2.5 flex-row items-center gap-3">
        <Legend colour={palette.ink} label="blocked" />
        <Legend colour={palette.accent} label="working" />
        <Legend colour={palette.danger} label="failed" />
        <Legend colour={palette.lineStrong} label="idle" />
      </View>
    </View>
  )
}

function Legend({ colour, label }: { colour: string; label: string }) {
  return (
    <View className="flex-row items-center gap-1.5">
      <View style={{ width: 6, height: 6, borderRadius: 2, backgroundColor: colour }} />
      <Text className="text-[10px] leading-[13px] text-ink-4">{label}</Text>
    </View>
  )
}