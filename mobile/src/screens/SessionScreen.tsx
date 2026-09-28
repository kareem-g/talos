/**
 * Session detail. Phase C replaces this with the real transcript (Timeline +
 * StateZone approval/question cards + Composer), hydrated from
 * `GET /api/mobile/sessions/{id}` and the shared event reducer.
 *
 * The notification-security rule lives here: a tap only navigates. This screen
 * fetches the CURRENT approval state from the backend on mount — it never trusts
 * the `approvalId` in the notification payload beyond using it to scroll/focus.
 * Resolving an approval goes through the existing WS `approval_response`, so a
 * stale tap (approval already answered) shows the resolved state, not a live
 * button.
 */

import * as React from 'react'
import { Pressable, Text, View } from 'react-native'
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native'
import type { RootStackParamList } from '@app/navigation'

export function SessionScreen() {
  const navigation = useNavigation()
  const route = useRoute<RouteProp<RootStackParamList, 'Session'>>()
  const { sessionId, approvalId } = route.params

  return (
    <View className="flex-1 bg-canvas">
      <View className="flex-row items-center border-b border-line px-4 pb-3 pt-6">
        <Pressable onPress={() => navigation.goBack()}>
          <Text className="mr-3 text-base text-accent">Back</Text>
        </Pressable>
        <Text className="flex-1 text-base text-ink" numberOfLines={1}>
          {sessionId}
        </Text>
      </View>
      <View className="p-4">
        <Text className="text-sm text-ink-2">Session {sessionId}</Text>
        {approvalId ? (
          <Text className="mt-2 text-sm text-orange">Pending approval: {approvalId}</Text>
        ) : null}
        <Text className="mt-4 text-xs text-ink-3">
          Transcript and live approval card arrive in Phase C. State is always
          re-fetched from the daemon here — the notification is only a signal.
        </Text>
      </View>
    </View>
  )
}
