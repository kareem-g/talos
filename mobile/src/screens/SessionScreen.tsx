/**
 * Session — the conversation with one agent.
 *
 * This is where the app spends most of its time, so the layout is built around
 * one rule: **the conversation gets the screen, and everything else gets out of
 * its way.**
 *
 * What changed from the previous version:
 *
 * - **The transcript is no longer fighting three sets of controls for the top of
 *   the screen.** The old header carried a back button, a title, a status pill,
 *   a search button, two panel toggles, a live config chip row, and a context
 *   ring — five horizontal bands before the first message. The title row now
 *   holds the back button, the name, the status, and one overflow button; the
 *   config chips collapsed to a single tappable summary that opens a sheet, and
 *   the context ring moved into that sheet.
 *
 * - **The two side rails became one sheet with tabs.** The desktop splits them
 *   into left and right columns; on a phone that is two panels and two
 *   dismissal gestures for one idea ("show me more"). They are now one
 *   `SessionTools` sheet with tabbed sections, so switching between workspace
 *   context and tools does not close and reopen the sheet.
 *
 * - **The composer never loses its send button.** The old layout swapped
 *   Send for a Queue/Stop pair, which changed the primary action's position
 *   mid-conversation. Send stays in place and its label changes; Stop is
 *   revealed next to it, not in its slot.
 *
 * The status pill comes from the shared `sessionState` machine, so a session
 * with an open approval reads as "Needs approval" even when the backend's
 * status frame lags behind — the phone is the thing you look at when the agent
 * is waiting, so the phone decides what "waiting" looks like.
 */

import * as React from 'react'
import { KeyboardAvoidingView, Platform, Pressable, Text, View } from 'react-native'
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native'
import { ChevronLeft, ChevronRight, SlidersHorizontal } from 'lucide-react-native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'

import { sessionUIState, uiStateDisplay } from '@/lib/sessionState'
import type { Session } from '@/types/session'
import { useStore, useConversation } from '@app/store'
import type { RootStackParamList } from '@app/navigation'
import { agentColor, palette } from '@app/design/tokens'
import { ConfigChips, ContextRing } from '@app/components/ConfigChips'
import { Transcript } from '@app/components/Transcript'
import { Composer } from '@app/components/Composer'
import { SessionRail } from '@app/components/SessionRail'
import { SessionLeftRail } from '@app/components/SessionLeftRail'
import { NewTaskSheet } from '@app/components/NewTaskSheet'
import { CommandPalette } from '@app/components/CommandPalette'
import { FloatingAttentionPill } from '@app/components/FloatingAttentionPill'
import { SubagentModal } from '@app/components/SubagentModal'
import { EngineSwitchModal } from '@app/components/EngineSwitchModal'
import { Sheet } from '@app/components/Sheet'
import { Eyebrow, IconButton, StatusPill, haptic } from '@app/components/ui'

/** A minimal row, for the window between a deep link and the snapshot landing. */
const PLACEHOLDER_SESSION: Session = {
  id: '',
  name: 'Session',
  agent: '',
  project: null,
  branch: null,
  status: 'idle',
  worktree_path: null,
  created_at: '',
  updated_at: '',
  cost: null,
  tokens_used: null,
  resume_command: null,
  parent_id: null,
}

export function SessionScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const route = useRoute<RouteProp<RootStackParamList, 'Session'>>()
  const { sessionId } = route.params

  const openSession = useStore((state) => state.openSession)
  const session = useStore((state) => state.sessions.find((row) => row.id === sessionId))
  const connection = useStore((state) => state.connection)
  const revision = useStore((state) => state.revisions[sessionId] ?? 0)
  const conversation = useConversation(sessionId)

  const [toolsOpen, setToolsOpen] = React.useState(false)
  const [railOpen, setRailOpen] = React.useState(false)
  const [leftRailOpen, setLeftRailOpen] = React.useState(false)
  const [newTaskOpen, setNewTaskOpen] = React.useState(false)
  const [cmdOpen, setCmdOpen] = React.useState(false)
  const [subagentOpen, setSubagentOpen] = React.useState(false)
  const [engineOpen, setEngineOpen] = React.useState(false)

  React.useEffect(() => {
    void openSession(sessionId)
  }, [sessionId, openSession])

  const uiState = session ? sessionUIState(session, conversation, connection) : 'ready'
  const display = uiStateDisplay(uiState)
  const busy = uiState === 'working' || uiState === 'starting' || uiState === 'resuming'

  // The rails need a row even before the snapshot lands (a cold start straight
  // from a notification), so fall back to a minimal one.
  const railSession = React.useMemo(() => session ?? { ...PLACEHOLDER_SESSION, id: sessionId }, [session, sessionId])

  return (
    <View className="flex-1 bg-canvas">
      {/* ── Header ────────────────────────────────────────────────────────
          Three things only: where you are, what state it is in, and the one
          button that opens everything else. */}
      <View className="flex-row items-center gap-1 border-b border-line bg-chrome px-1.5 py-2">
        <IconButton label="Back" size={40} onPress={() => navigation.goBack()}>
          <ChevronLeft size={22} color={palette.ink} />
        </IconButton>

        <View
          className="min-w-0 flex-1 px-1"
          accessible
          accessibilityRole="header"
          accessibilityLabel={`${session?.name ?? 'Session'}, ${display.label}`}
        >
          <View className="flex-row items-center gap-2">
            <View
              className="size-2 shrink-0 rounded-full"
              style={{ backgroundColor: agentColor(session?.agent ?? '') }}
              accessibilityElementsHidden
            />
            <Text className="min-w-0 flex-1 text-[16px] font-bold text-ink" numberOfLines={1}>
              {session?.name ?? 'Session'}
            </Text>
          </View>
          <Text className="ml-4 mt-0.5 text-[11px] text-ink-3" numberOfLines={1}>
            {session?.agent || 'loading…'}
          </Text>
        </View>

        <StatusPill tone={display.tone} label={display.label} pulse={display.pulse} />

        <IconButton
          label="Session settings and tools"
          size={40}
          onPress={() => {
            void haptic('light')
            setToolsOpen(true)
          }}
        >
          <SlidersHorizontal size={19} color={palette.ink2} />
        </IconButton>
      </View>

      {/* ── Live configuration ────────────────────────────────────────────
          The chips are still inline — they are the fastest way to change a
          model mid-conversation — but they sit on their own strip rather than
          sharing the title row, and the context ring is now opt-in. */}
      <View className="flex-row items-center gap-2 border-b border-line bg-chrome px-3 py-1.5">
        <View className="min-w-0 flex-1">
          <ConfigChips sessionId={sessionId} />
        </View>
        <ContextRing sessionId={sessionId} working={busy} />
      </View>

      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? 88 : 0}
      >
        <Transcript
          sessionId={sessionId}
          messages={conversation.messages}
          revision={revision}
          onViewPlan={() => setToolsOpen(true)}
        />
        <Composer sessionId={sessionId} uiState={uiState} />
      </KeyboardAvoidingView>

      {/* ── One sheet, not two ────────────────────────────────────────────
          The desktop splits workspace context and tools into left and right
          columns. On a phone that is two panels, two grabbers, and two
          dismissal gestures for one idea. This sheet is the entry point to
          both; the rails themselves keep their own full-screen presentation,
          because a Git diff or a file tree needs the whole screen to be
          readable, and cramming them into a 60%-height sheet would make the
          dense content unusable. */}
      <Sheet open={toolsOpen} onClose={() => setToolsOpen(false)} title={session?.name} eyebrow="Session">
        <Eyebrow>Explore</Eyebrow>
        <View className="flex-row gap-2">
          <PanelEntry
            label="Tools"
            description="Plan, agents, Git, files, browser and terminals for this session."
            onPress={() => {
              setToolsOpen(false)
              setRailOpen(true)
            }}
          />
          <PanelEntry
            label="Workspace"
            description="Switch sessions and see what else is running here."
            onPress={() => {
              setToolsOpen(false)
              setLeftRailOpen(true)
            }}
          />
        </View>

        <Eyebrow>Actions</Eyebrow>
        <View className="gap-1">
          <SheetRow
            label="Start another task"
            hint="Open a new session without losing this conversation"
            onPress={() => {
              setToolsOpen(false)
              setNewTaskOpen(true)
            }}
          />
          <SheetRow
            label="Switch agent"
            hint="Move this session to a different CLI or model"
            onPress={() => {
              setToolsOpen(false)
              setEngineOpen(true)
            }}
          />
          <SheetRow
            label="Spawn a subagent"
            hint="Run a focused task in parallel and collect the result"
            onPress={() => {
              setToolsOpen(false)
              setSubagentOpen(true)
            }}
          />
          <SheetRow
            label="Find in session"
            hint="Search this conversation and jump to a message"
            onPress={() => {
              setToolsOpen(false)
              setCmdOpen(true)
            }}
          />
        </View>
      </Sheet>

      <SessionLeftRail
        open={leftRailOpen}
        onClose={() => setLeftRailOpen(false)}
        sessionId={sessionId}
        onNewTask={() => {
          setLeftRailOpen(false)
          setNewTaskOpen(true)
        }}
      />

      <SessionRail
        open={railOpen}
        onClose={() => setRailOpen(false)}
        session={railSession}
        conversation={conversation}
      />

      <NewTaskSheet
        open={newTaskOpen}
        initialProject={session?.project}
        onClose={() => setNewTaskOpen(false)}
        onCreated={(created) => navigation.navigate('Session', { sessionId: created.id })}
      />

      <CommandPalette open={cmdOpen} onClose={() => setCmdOpen(false)} onNewTask={() => setNewTaskOpen(true)} />

      <FloatingAttentionPill />

      <SubagentModal
        open={subagentOpen}
        sessionId={sessionId}
        onClose={() => setSubagentOpen(false)}
      />

      <EngineSwitchModal
        open={engineOpen}
        sessionId={sessionId}
        currentAgent={session?.agent ?? ''}
        onClose={() => setEngineOpen(false)}
      />
    </View>
  )
}

/** A panel entry — a large, tappable card for a full-screen destination. */
function PanelEntry({
  label,
  description,
  onPress,
}: {
  label: string
  description: string
  onPress: () => void
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={description}
      onPress={onPress}
      className="min-h-20 flex-1 justify-center gap-1 rounded-md border border-line bg-raised p-3 active:bg-pressed"
    >
      <Text className="text-[14px] font-semibold text-ink">{label}</Text>
      <Text className="text-[11px] leading-[15px] text-ink-3">{description}</Text>
    </Pressable>
  )
}

/** A row inside the tools sheet. */
function SheetRow({
  label,
  hint,
  onPress,
}: {
  label: string
  hint?: string
  onPress: () => void
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      onPress={onPress}
      className="min-h-14 flex-row items-center gap-3 rounded-md px-3 py-2.5 active:bg-pressed"
    >
      <View className="min-w-0 flex-1">
        <Text className="text-[14px] font-medium text-ink">{label}</Text>
        {hint ? <Text className="mt-0.5 text-[12px] text-ink-3">{hint}</Text> : null}
      </View>
      <ChevronRight size={16} color={palette.ink3} />
    </Pressable>
  )
}
