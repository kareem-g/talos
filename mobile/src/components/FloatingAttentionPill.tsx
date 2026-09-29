/**
 * Floating Attention Pill — desktop parity.
 *
 * Appears floating when one or more sessions require human intervention
 * (approval needed, structured question asked, or error). Tapping jumps directly
 * to the first session awaiting approval.
 */

import * as React from 'react'
import { Pressable, Text, View } from 'react-native'
import { AlertCircle, ChevronRight } from 'lucide-react-native'

import { useConversation, useStore } from '@app/store'
import { firstOpenApprovalId, sessionUIState } from '@/lib/sessionState'
import { useOpenSession } from '@app/navigation'
import { GlassSurface } from './Glass'
import { palette } from '@app/design/tokens'

export function FloatingAttentionPill() {
  const sessions = useStore((s) => s.sessions)
  const connection = useStore((s) => s.connection)
  const revisions = useStore((s) => s.revisions)
  const pendingActions = useStore((s) => s.pendingActions)
  const openSession = useOpenSession()

  // Track sessions that need human attention
  const attentionSessions = React.useMemo(() => {
    return sessions.filter((session) => {
      if (session.status === 'archived') return false
      return (
        session.status === 'waiting_for_approval' ||
        session.status === 'waiting_for_input' ||
        session.status === 'error'
      )
    })
  }, [sessions, revisions])

  const count = Math.max(attentionSessions.length, pendingActions.length)

  if (count === 0) return null

  const target = attentionSessions[0]
  const targetId = target?.id ?? pendingActions[0]?.session_id
  const targetApprovalId = pendingActions[0]?.id

  return (
    <View className="pointer-events-box-none absolute bottom-6 left-0 right-0 z-50 items-center justify-center px-4">
      <Pressable
        onPress={() => {
          if (targetId) {
            openSession(targetId, targetApprovalId)
          }
        }}
        accessibilityRole="button"
        accessibilityLabel={`${count} action${count > 1 ? 's' : ''} need attention`}
        className="active:opacity-90"
      >
        <GlassSurface
          effect="regular"
          interactive
          radius={24}
          className="border border-red/40 bg-surface/90 shadow-xl shadow-black/40"
        >
          <View className="min-h-11 flex-row items-center gap-2.5 px-4 py-2">
            <View className="size-2 rounded-full bg-red animate-pulse" />
            <AlertCircle size={15} color={palette.danger} />
            <Text className="text-[13px] font-semibold text-ink">
              {count} {count === 1 ? 'action needs' : 'actions need'} attention
            </Text>
            <ChevronRight size={14} color={palette.danger} />
          </View>
        </GlassSurface>
      </Pressable>
    </View>
  )
}
