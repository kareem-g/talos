/**
 * Session detail — transcript, live approval/question cards, and the composer.
 *
 * On open it hydrates the conversation from `GET /api/mobile/sessions/{id}` (the
 * backend is the source of truth, never the notification payload), then stays
 * live off the socket. The status pill comes from the shared `sessionState`
 * machine, so an approval that is open in the transcript reads as "Needs approval"
 * even if the backend status frame lags.
 *
 * A notification tap lands here with `approvalId`; the card is already rendered
 * inline from the fetched state. Scroll-to-focus for that id is a Phase D polish.
 */

import * as React from 'react'
import { KeyboardAvoidingView, Platform, Pressable } from 'react-native'
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { ChevronLeft } from 'lucide-react-native'

import { useStore, useConversation } from '@app/store'
import { sessionUIState, uiStateDisplay } from '@/lib/sessionState'
import type { RootStackParamList } from '@app/navigation'
import { ScreenHeader, StatusPill } from '@app/components/ui'
import { Transcript } from '@app/components/Transcript'
import { Composer } from '@app/components/Composer'

export function SessionScreen() {
  const navigation = useNavigation()
  const route = useRoute<RouteProp<RootStackParamList, 'Session'>>()
  const { sessionId } = route.params

  const openSession = useStore((state) => state.openSession)
  const session = useStore((state) => state.sessions.find((s) => s.id === sessionId))
  const connection = useStore((state) => state.connection)
  const revision = useStore((state) => state.revisions[sessionId] ?? 0)
  const conversation = useConversation(sessionId)

  React.useEffect(() => {
    void openSession(sessionId)
  }, [sessionId, openSession])

  const uiState = session ? sessionUIState(session, conversation, connection) : 'ready'
  const display = uiStateDisplay(uiState)

  return (
    <SafeAreaView className="flex-1 bg-canvas" edges={['top']}>
      <ScreenHeader
        title={session?.name ?? 'Session'}
        subtitle={session ? `${session.agent}${display.hint ? ` · ${display.hint}` : ''}` : undefined}
        left={
          <Pressable
            onPress={() => navigation.goBack()}
            className="-ml-1 rounded-lg p-1 active:bg-hover"
            accessibilityLabel="Back"
          >
            <ChevronLeft size={22} color="#f2f2f3" />
          </Pressable>
        }
        right={<StatusPill tone={display.tone} label={display.label} pulse={display.pulse} />}
      />
      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Transcript sessionId={sessionId} messages={conversation.messages} revision={revision} />
        <Composer sessionId={sessionId} uiState={uiState} />
      </KeyboardAvoidingView>
    </SafeAreaView>
  )
}
