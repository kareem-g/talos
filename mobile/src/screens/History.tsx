/**
 * History — every session grouped by day, newest first. The status pill
 * travels with the row; the star pins it to Home's Starred filter.
 */

import * as React from 'react'
import { Pressable, ScrollView, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { isInternalSession } from '@/lib/sessionState'
import { uiStateDisplay, sessionUIState } from '@/lib/sessionState'
import type { Session } from '@/types/session'
import { useStore, useConversation } from '@/store'
import { useShell } from '../shell'
import { agentHue, color } from '../design/tokens'
import { MONO } from '../design/fonts'
import { ChevronRight, Plus, Star } from '../design/icons'
import { Empty, Field, Pill, Tap, Text, haptic } from '../ui'

function dayOf(iso: string): string {
  const then = new Date(iso)
  if (Number.isNaN(then.getTime())) return 'Earlier'
  const days = Math.floor((Date.now() - then.getTime()) / 86_400_000)
  if (days <= 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days}d ago`
  return then.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function ageOf(iso: string): string {
  const then = new Date(iso)
  if (Number.isNaN(then.getTime())) return ''
  const mins = Math.max(1, Math.round((Date.now() - then.getTime()) / 60_000))
  if (mins < 60) return `${mins}m`
  const hours = Math.round(mins / 60)
  if (hours < 24) return `${hours}h`
  return `${Math.round(hours / 24)}d`
}

export function HistoryScreen() {
  const shell = useShell()
  const insets = useSafeAreaInsets()
  const sessions = useStore((s) => s.sessions)
  const loading = useStore((s) => s.sessionsLoading)
  const starred = useStore((s) => s.starred)
  const toggleStar = useStore((s) => s.toggleStar)
  const loadSnapshot = useStore((s) => s.loadSnapshot)
  const [query, setQuery] = React.useState('')

  React.useEffect(() => {
    void loadSnapshot()
  }, [loadSnapshot])

  const visible = React.useMemo(() => {
    const needle = query.trim().toLowerCase()
    return sessions
      .filter((session) => !isInternalSession(session))
      .filter((session) => session.status !== 'archived')
      .filter(
        (session) =>
          !needle ||
          session.name.toLowerCase().includes(needle) ||
          (session.project ?? '').toLowerCase().includes(needle),
      )
      .slice()
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
  }, [sessions, query])

  const groups = React.useMemo(() => {
    const byDay = new Map<string, Session[]>()
    for (const session of visible) {
      const key = dayOf(session.updated_at)
      const list = byDay.get(key)
      if (list) list.push(session)
      else byDay.set(key, [session])
    }
    return [...byDay.entries()]
  }, [visible])

  return (
    <View className="flex-1 bg-canvas">
      <ScrollView
        className="flex-1 bg-canvas"
        contentContainerStyle={{ paddingBottom: insets.bottom + 110 }}
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
      >
        <View className="px-5" style={{ paddingTop: insets.top + 16 }}>
          <View className="flex-row items-center">
            <Text className="text-[33px] font-bold leading-[37px] text-ink" style={{ letterSpacing: -0.5 }}>
              History
            </Text>
            <View className="flex-1" />
            <Tap
              accessibilityRole="button"
              accessibilityLabel="New session"
              onPress={() => {
                void haptic('light')
                shell.openNewTask()
              }}
              squeeze={0.92}
              className="h-9 w-9 items-center justify-center rounded-full bg-field"
            >
              <Plus size={22} color={color.ink} stroke={2} />
            </Tap>
          </View>
        </View>

        <View className="mt-3 px-5">
          <Field
            value={query}
            onChangeText={setQuery}
            placeholder="Search history"
            accessibilityLabel="Search history"
            className="h-[46px] min-h-[46px]"
          />
        </View>

        {loading && visible.length === 0 ? (
          <Text className="p-6 text-center text-[14px] text-ink-3">Loading…</Text>
        ) : groups.length === 0 ? (
          <Empty title="Nothing yet" note="Sessions you run on the desktop appear here, newest first." />
        ) : (
          groups.map(([day, rows]) => (
            <View key={day} style={{ marginTop: 22 }}>
              <Text className="mb-2 ml-4 text-[12px] font-semibold text-ink-3">{day}</Text>
              <View className="mx-4 overflow-hidden rounded-[16px] bg-surface">
                {rows.map((session, index) => (
                  <React.Fragment key={session.id}>
                    {index > 0 ? <View className="ml-9 mr-4 h-px bg-line" /> : null}
                    <Row
                      session={session}
                      starred={starred.includes(session.id)}
                      onOpen={() => {
                        void loadSnapshot()
                        shell.openSession(session.id)
                      }}
                      onStar={() => toggleStar(session.id)}
                    />
                  </React.Fragment>
                ))}
              </View>
            </View>
          ))
        )}

        <Text className="mx-4 mt-4 text-[11.5px] leading-[17px] text-ink-3">
          Archived sessions are hidden here — show them from Home's Archived filter.
        </Text>
      </ScrollView>
    </View>
  )
}

function Row({
  session,
  starred,
  onOpen,
  onStar,
}: {
  session: Session
  starred: boolean
  onOpen: () => void
  onStar: () => void
}) {
  const conversation = useConversation(session.id)
  const connection = useStore((s) => s.connection)
  const display = uiStateDisplay(sessionUIState(session, conversation, connection))
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={session.name}
      onPress={() => {
        void haptic('light')
        onOpen()
      }}
      className="flex-row items-center gap-2.5 px-4 py-3"
    >
      <View className="size-2 shrink-0 rounded-full" style={{ backgroundColor: agentHue(session.agent) }} />
      <View className="min-w-0 flex-1">
        <View className="flex-row items-center gap-2">
          <Text className="shrink text-[15px] text-ink" numberOfLines={1}>
            {session.name}
          </Text>
          <Pill label={display.label} tone={display.tone} pulse={display.pulse} className="h-5 px-2" />
        </View>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={starred ? 'Unstar' : 'Star'}
        onPress={() => {
          void haptic('select')
          onStar()
        }}
        hitSlop={8}
        className="shrink-0 p-0.5"
      >
        <Star size={15} color={starred ? color.orange : color.ink4} fill={starred} />
      </Pressable>
      <Text className="shrink-0 text-[10.5px] text-ink-3" style={{ fontFamily: MONO, fontVariant: ['tabular-nums'] }}>
        {ageOf(session.updated_at)}
      </Text>
      <ChevronRight size={13} color={color.ink3} stroke={2} />
    </Pressable>
  )
}