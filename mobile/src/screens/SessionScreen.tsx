/**
 * Session detail — transcript, live approval/question cards, the composer, and
 * the workspace rail.
 *
 * On open it hydrates the conversation from `GET /api/mobile/sessions/{id}` (the
 * backend is the source of truth, never the notification payload), then stays
 * live off the socket. The status pill comes from the shared `sessionState`
 * machine, so an approval that is open in the transcript reads as "Needs approval"
 * even if the backend status frame lags.
 *
 * The rail is the desktop's right-hand tool panel, collapsed into a sheet — the
 * same thing the desktop itself does below its `lg` breakpoint.
 */

import * as React from 'react'
import { KeyboardAvoidingView, Platform, Pressable } from 'react-native'
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { ChevronLeft, PanelRight } from 'lucide-react-native'

import { useStore, useConversation } from '@app/store'
import { sessionUIState, uiStateDisplay } from '@/lib/sessionState'
import type { RootStackParamList } from '@app/navigation'
import { IconButton, ScreenHeader, StatusPill } from '@app/components/ui'
import { Transcript } from '@app/components/Transcript'
import { Composer } from '@app/components/Composer'
import { SessionRail } from '@app/components/SessionRail'

export function SessionScreen() {
  const navigation = useNavigation()
  const route = useRoute<RouteProp<RootStackParamList, 'Session'>>()
  const { sessionId } = route.params

  const openSession = useStore((state) => state.openSession)
  const session = useStore((state) => state.sessions.find((row) => row.id === sessionId))
  const connection = useStore((state) => state.connection)
  const revision = useStore((state) => state.revisions[sessionId] ?? 0)
  const conversation = useConversation(sessionId)
  const [railOpen, setRailOpen] = React.useState(false)
  const fallbackSession = React.useMemo(
    () => session ?? { id: sessionId, name: 'Session', agent: '', project: null, branch: null, status: 'idle' as const, worktree_path: null, created_at: '', updated_at: '', cost: null, tokens_used: null, resume_command: null, parent_id: null },
    [session, sessionId],
  )

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
            accessibilityLabel="Back"
            className="-ml-1 size-9 items-center justify-center rounded-lg active:bg-hover"
          >
            <ChevronLeft size={22} color="#f2f2f3" />
          </Pressable>
        }
        right={
          <>
            <StatusPill tone={display.tone} label={display.label} pulse={display.pulse} />
            <IconButton label="Workspace" onPress={() => setRailOpen(true)} className="size-9">
              <PanelRight size={17} color="#b0b0b6" />
            </IconButton>
          </>
        }
      />

      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <Transcript
          sessionId={sessionId}
          messages={conversation.messages}
          revision={revision}
          onViewPlan={() => setRailOpen(true)}
        />
        <Composer sessionId={sessionId} uiState={uiState} />
      </KeyboardAvoidingView>

      <SessionRail
        open={railOpen}
        onClose={() => setRailOpen(false)}
        session={fallbackSession}
        conversation={conversation}
      />
    </SafeAreaView>
  )
}
