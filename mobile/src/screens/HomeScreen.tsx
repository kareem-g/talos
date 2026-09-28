/**
 * Home — the session list. Phase C replaces this with the full Station control
 * deck (triage timeline, workspace groups, attention rows); for now it lists
 * sessions so navigation and the notification tap-routing are exercisable.
 */

import * as React from 'react'
import { FlatList, Pressable, Text, View } from 'react-native'
import { useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { useStore } from '@app/store'
import type { RootStackParamList } from '@app/navigation'

type Nav = NativeStackNavigationProp<RootStackParamList, 'Home'>

export function HomeScreen() {
  const navigation = useNavigation<Nav>()
  const sessions = useStore((state) => state.sessions)
  const connection = useStore((state) => state.connection)

  return (
    <View className="flex-1 bg-canvas">
      <View className="border-b border-line px-4 pb-3 pt-6">
        <Text className="text-xl font-semibold text-ink">AgentDeck</Text>
        <Text className="mt-1 text-xs text-ink-3">{connection}</Text>
      </View>
      <FlatList
        data={sessions}
        keyExtractor={(session) => session.id}
        ListEmptyComponent={
          <Text className="mt-8 text-center text-sm text-ink-3">No sessions yet</Text>
        }
        renderItem={({ item }) => (
          <Pressable
            className="border-b border-line px-4 py-3"
            onPress={() => navigation.navigate('Session', { sessionId: item.id })}
          >
            <Text className="text-base text-ink">{item.name}</Text>
            <Text className="mt-0.5 text-xs text-ink-3">
              {item.agent} · {item.status}
            </Text>
          </Pressable>
        )}
      />
    </View>
  )
}
