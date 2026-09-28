/**
 * Session detail — transcript, approvals, composer, and both rails.
 *
 * Layout follows the desktop's session view: a header that carries the pane
 * toggles and the run's live configuration, the transcript, and the composer. On
 * a wide screen the desktop keeps the left sidebar and the right tool panel as
 * fixed columns; below its `lg` breakpoint it turns both into sheets, which is
 * what they are here — left rail for workspace context and session switching,
 * right rail for Plan/Agents/Git/Browser/Files/Terminal.
 *
 * On open it hydrates from `GET /api/mobile/sessions/{id}` (the backend is the
 * source of truth, never the notification payload), then stays live off the
 * socket. The status pill comes from the shared `sessionState` machine, so an
 * approval open in the transcript reads as "Needs approval" even when the
 * backend status frame lags.
 */

import * as React from 'react'
import { KeyboardAvoidingView, Platform, Pressable, Text, View } from 'react-native'
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { ChevronLeft, PanelLeft, PanelRight } from 'lucide-react-native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'

import { useStore, useConversation } from '@app/store'
import { sessionUIState, uiStateDisplay } from '@/lib/sessionState'
import type { RootStackParamList } from '@app/navigation'
import { GlassSurface, IconButton, Mono, StatusPill } from '@app/components/ui'
import { ConfigChips, ContextRing } from '@app/components/ConfigChips'
import { Transcript } from '@app/components/Transcript'
import { Composer } from '@app/components/Composer'
import { SessionRail } from '@app/components/SessionRail'
import { SessionLeftRail } from '@app/components/SessionLeftRail'
import { NewTaskSheet } from '@app/components/NewTaskSheet'

export function SessionScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const route = useRoute<RouteProp<RootStackParamList, 'Session'>>()
  const { sessionId } = route.params

  const openSession = useStore((state) => state.openSession)
  const session = useStore((state) => state.sessions.find((row) => row.id === sessionId))
  const connection = useStore((state) => state.connection)
  const revision = useStore((state) => state.revisions[sessionId] ?? 0)
  const conversation = useConversation(sessionId)

  const [leftOpen, setLeftOpen] = React.useState(false)
  const [rightOpen, setRightOpen] = React.useState(false)
  const [newTask, setNewTask] = React.useState(false)

  React.useEffect(() => {
    void openSession(sessionId)
  }, [sessionId, openSession])

  const uiState = session ? sessionUIState(session, conversation, connection) : 'ready'
  const display = uiStateDisplay(uiState)
  const busy = uiState === 'working' || uiState === 'starting' || uiState === 'resuming'

  // The rails need a session row even before the snapshot lands (a cold start
  // straight from a notification), so fall back to a minimal one.
  const railSession = React.useMemo(
    () =>
      session ?? {
        id: sessionId,
        name: 'Session',
        agent: '',
        project: null,
        branch: null,
        status: 'idle' as const,
        worktree_path: null,
        created_at: '',
        updated_at: '',
        cost: null,
        tokens_used: null,
        resume_command: null,
        parent_id: null,
      },
    [session, sessionId],
  )

  return (
    <SafeAreaView className="flex-1 bg-canvas" edges={['top']}>
      {/* Header: pane toggles either side of the title, config row beneath. */}
      <GlassSurface radius={0} className="border-b border-line">
        <View className="flex-row items-center gap-1 px-2 pt-2">
          <Pressable
            onPress={() => navigation.goBack()}
            accessibilityLabel="Back"
            className="size-9 items-center justify-center rounded-full active:bg-hover-2"
          >
            <ChevronLeft size={20} color="#f2f2f3" />
          </Pressable>

          <View className="min-w-0 flex-1 px-1">
            <View className="flex-row items-center gap-2">
              <View className="min-w-0 flex-1">
                <Text className="text-[15px] font-semibold text-ink" numberOfLines={1}>
                  {session?.name ?? 'Session'}
                </Text>
                <Mono className="text-[10.5px]" numberOfLines={1}>
                  {session ? session.agent : 'loading…'}
                </Mono>
              </View>
              <StatusPill tone={display.tone} label={display.label} pulse={display.pulse} />
            </View>
          </View>

          <IconButton label="Workspace panel" onPress={() => setLeftOpen(true)} className="size-9">
            <PanelLeft size={17} color="#b0b0b6" />
          </IconButton>
          <IconButton label="Tools panel" onPress={() => setRightOpen(true)} className="size-9">
            <PanelRight size={17} color="#b0b0b6" />
          </IconButton>
        </View>

        {/* Live configuration, beside the pane icons rather than in the composer. */}
        <View className="flex-row items-center">
          <View className="min-w-0 flex-1">
            <ConfigChips sessionId={sessionId} />
          </View>
          <View className="pr-2 pb-2">
            <ContextRing sessionId={sessionId} working={busy} />
          </View>
        </View>
      </GlassSurface>

      <KeyboardAvoidingView className="flex-1" behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
        <Transcript
          sessionId={sessionId}
          messages={conversation.messages}
          revision={revision}
          onViewPlan={() => setRightOpen(true)}
        />
        <Composer sessionId={sessionId} uiState={uiState} />
      </KeyboardAvoidingView>

      <SessionLeftRail
        open={leftOpen}
        onClose={() => setLeftOpen(false)}
        sessionId={sessionId}
        onNewTask={() => {
          setLeftOpen(false)
          setNewTask(true)
        }}
      />

      <SessionRail
        open={rightOpen}
        onClose={() => setRightOpen(false)}
        session={railSession}
        conversation={conversation}
      />

      <NewTaskSheet
        open={newTask}
        initialProject={session?.project}
        onClose={() => setNewTask(false)}
        onCreated={(created) => navigation.navigate('Session', { sessionId: created.id })}
      />
    </SafeAreaView>
  )
}
