/**
 * Session — the conversation with one agent.
 *
 * This is where the app spends most of its time, so the layout is built around
 * one rule: **the transcript gets the screen, and everything else gets out of
 * its way.**
 *
 * THE HEADER, AND WHAT WAS REMOVED FROM IT
 * ---------------------------------------
 * The previous header carried a back button, a title, a status pill, a search
 * button, two panel toggles, a live config chip row, and a context ring — five
 * horizontal bands before the first message, and three of them were duplicated
 * a few centimetres down the screen.
 *
 * Now the header carries four things: where you are, what state it is in, the
 * one button that opens the session's tools, and the overflow. Everything else
 * has moved somewhere it is reachable but not always in the way:
 *
 *   - **Config chips and the context ring → the composer's dock.** They were
 *     *already* duplicated there on the desktop; on a phone they belong with
 *     the field you are typing into, not in a bar above the transcript.
 *   - **The desktop's right rail → a pushed screen** (`SessionPanelScreen`).
 *     A plan, a diff, a file tree and a terminal do not fit in a 60%-height
 *     sheet at phone width, and cramming them in made them unreadable. Full
 *     screen, with its own tab strip, is the honest translation of a
 *     resizable side panel.
 *   - **The desktop's left sidebar → a sheet.** Switching sessions is a
 *     glance, not a destination; a sheet over the transcript keeps the
 *     conversation you were reading visible behind it.
 *   - **Search → a sheet, from the overflow.** A search field permanently
 *     resident in the header is a control for a screen you are on about 2% of
 *     the time.
 *
 * THE CONTEXT STRIP
 * -----------------
 * One row between the transcript and the composer that answers "what is it
 * doing right now" without opening anything: the plan's progress, the number
 * of subagents, and the elapsed runtime. It is the desktop's `FloatingHud`
 * collapsed to a single line and pinned where a thumb cannot miss it. Tapping
 * it opens the panel on the tab that matches what you tapped.
 */

import * as React from 'react'
import { KeyboardAvoidingView, Platform, Pressable, Text, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import {
  Archive,
  ArchiveRestore,
  ChevronLeft,
  GitFork,
  ListTree,
  MoreHorizontal,
  PanelRight,
  Repeat2,
  Users,
  Zap,
} from 'lucide-react-native'
import Clipboard from '@react-native-clipboard/clipboard'

import { sessionUIState, uiStateDisplay } from '@/lib/sessionState'
import type { Session } from '@/types/session'
import { useStore, useConversation } from '@app/store'
import type { RootStackParamList } from '@app/navigation'
import { agentColor, palette, radius } from '@app/design/tokens'
import { Transcript } from '@app/components/Transcript'
import { Composer } from '@app/components/Composer'
import { NewTaskSheet } from '@app/components/NewTaskSheet'
import { SubagentSheet } from '@app/components/SubagentModal'
import { EngineSwitchSheet } from '@app/components/EngineSwitchModal'
import { SessionSwitcherSheet } from '@app/components/SessionLeftRail'
import { SessionSearchSheet } from '@app/components/CommandPalette'
import { AttentionPill } from '@app/components/AttentionPill'
import { ActionSheet, ConfirmDialog } from '@app/components/Sheet'
import { AppBar, BackButton } from '@app/components/Screen'
import { deriveSubagents, latestPlanInfo } from '@app/lib/sessionView'
import { ProgressBar, StatusPill, IconButton, toast } from '@app/components/ui'

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
  const insets = useSafeAreaInsets()

  const openSession = useStore((state) => state.openSession)
  const session = useStore((state) => state.sessions.find((row) => row.id === sessionId))
  const connection = useStore((state) => state.connection)
  const revision = useStore((state) => state.revisions[sessionId] ?? 0)
  const conversation = useConversation(sessionId)
  const removeSession = useStore((state) => state.removeSession)
  const resumeSession = useStore((state) => state.resumeSession)
  const forkSession = useStore((state) => state.forkSession)
  const archiveSession = useStore((state) => state.archiveSession)
  const mobileApi = useStore((state) => state.loadSnapshot)

  const [switcherOpen, setSwitcherOpen] = React.useState(false)
  const [searchOpen, setSearchOpen] = React.useState(false)
  const [newTaskOpen, setNewTaskOpen] = React.useState(false)
  const [subagentOpen, setSubagentOpen] = React.useState(false)
  const [engineOpen, setEngineOpen] = React.useState(false)
  const [menuOpen, setMenuOpen] = React.useState(false)
  const [confirmDelete, setConfirmDelete] = React.useState(false)
  /**
   * What to present once the action sheet has finished animating out.
   *
   * Two modals cannot be stacked on iOS, so an action that opens another
   * surface has to wait for the first one to be gone. Queueing the intent
   * rather than firing it from the press handler is what makes that work.
   */
  const [pendingSurface, setPendingSurface] = React.useState<
    'switcher' | 'panel' | 'search' | 'delete' | null
  >(null)

  React.useEffect(() => {
    void openSession(sessionId)
  }, [sessionId, openSession])

  React.useEffect(() => {
    if (!pendingSurface) return
    switch (pendingSurface) {
      case 'switcher':
        setSwitcherOpen(true)
        break
      case 'panel':
        navigation.navigate('SessionPanel', { sessionId })
        break
      case 'search':
        setSearchOpen(true)
        break
      case 'delete':
        setConfirmDelete(true)
        break
    }
    setPendingSurface(null)
  }, [pendingSurface, navigation, sessionId])

  const uiState = session ? sessionUIState(session, conversation, connection) : 'ready'
  const display = uiStateDisplay(uiState)
  // `uiStateDisplay` is the shared desktop contract and names its tones
  // `green | orange | red | dim`; the mobile palette names the same four states
  // `ok | wait | danger | muted`. Mapping here, once, is what lets the two apps
  // agree on *what state this is* without agreeing on the colour name.
  const tone = React.useMemo(
    () =>
      ({
        green: 'ok',
        orange: 'wait',
        red: 'danger',
        dim: 'muted',
      } as const)[display.tone],
    [display.tone],
  )
  const accent = agentColor(session?.agent ?? '')

  const plan = React.useMemo(() => latestPlanInfo(conversation.messages), [conversation.messages, revision])
  const subagents = React.useMemo(() => deriveSubagents(conversation.messages), [conversation.messages, revision])
  const planDone = plan?.entries?.filter((entry) => entry.status === 'completed').length ?? 0
  const planTotal = plan?.entries?.length ?? plan?.stepCount ?? 0
  const runningSubagents = subagents.filter((agent) => agent.status === 'working').length

  const openPanel = (tab?: 'plan' | 'agents') =>
    navigation.navigate('SessionPanel', { sessionId, tab: tab as never })

  async function doDelete() {
    const name = session?.name ?? 'Session'
    const ok = await removeSession(sessionId)
    setConfirmDelete(false)
    setMenuOpen(false)
    if (ok) {
      navigation.goBack()
      toast({ message: `Deleted “${name}”` })
    } else {
      toast({ message: `Could not delete “${name}”`, tone: 'danger' })
    }
  }

  return (
    <View className="flex-1 bg-canvas">
      {/* ── Header ────────────────────────────────────────────────────────
          Four things. Everything else has moved. */}
      <AppBar
        title={session?.name ?? 'Session'}
        subtitle={session?.agent || 'loading…'}
        borderless
        left={<BackButton onPress={() => navigation.goBack()} label="Back to the deck" />}
        right={
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 2, paddingRight: 6 }}>
            <StatusPill tone={tone} label={display.label} pulse={display.pulse} size="sm" />
            <IconButton
              label="Open session tools"
              accessibilityHint="Plan, agents, git, files, terminal"
              size={36}
              onPress={() => openPanel()}
            >
              <PanelRight size={19} color={palette.ink2} />
            </IconButton>
            <IconButton
              label="Session actions"
              size={36}
              onPress={() => setMenuOpen(true)}
            >
              <MoreHorizontal size={19} color={palette.ink2} />
            </IconButton>
          </View>
        }
      />

      {/* The agent hue, as a hairline under the bar. It is the only place the
          app colours by *identity* rather than by state, and it sits exactly
          where the eye already is. Quieter in v3: a 1.5pt light, not a stripe. */}
      <View style={{ height: 1.5, backgroundColor: accent, opacity: session ? 0.7 : 0.2 }} />

      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top : 0}
      >
        <Transcript
          sessionId={sessionId}
          messages={conversation.messages}
          revision={revision}
          onViewPlan={() => openPanel('plan')}
        />

        {/* ── Context strip ──────────────────────────────────────────────
            What is it doing *right now*. Tapping a segment opens the panel on
            the matching tab, so this row is a shortcut rather than a readout
            you have to interpret and then act on elsewhere. */}
        <ContextStrip
          uiState={uiState}
          planDone={planDone}
          planTotal={planTotal}
          subagents={runningSubagents}
          onPlan={() => openPanel('plan')}
          onAgents={() => openPanel('agents')}
        />

        <Composer sessionId={sessionId} uiState={uiState} />
      </KeyboardAvoidingView>

      <SessionSwitcherSheet
        open={switcherOpen}
        onClose={() => setSwitcherOpen(false)}
        sessionId={sessionId}
        onNewTask={() => {
          setSwitcherOpen(false)
          setNewTaskOpen(true)
        }}
      />

      <SessionSearchSheet
        open={searchOpen}
        sessionId={sessionId}
        onClose={() => setSearchOpen(false)}
        onNewTask={() => {
          setSearchOpen(false)
          setNewTaskOpen(true)
        }}
      />

      <NewTaskSheet
        open={newTaskOpen}
        initialProject={session?.project}
        onClose={() => setNewTaskOpen(false)}
        onCreated={(created) => navigation.push('Session', { sessionId: created.id })}
      />

      <SubagentSheet
        open={subagentOpen}
        sessionId={sessionId}
        onClose={() => setSubagentOpen(false)}
        onOpenSession={(childId) => {
          setSubagentOpen(false)
          navigation.push('Session', { sessionId: childId })
        }}
      />

      <EngineSwitchSheet
        open={engineOpen}
        sessionId={sessionId}
        currentAgent={session?.agent ?? ''}
        onClose={() => setEngineOpen(false)}
      />

      <AttentionPill />

      <ActionSheet
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        onDismiss={() => setPendingSurface(null)}
        title={session?.name}
        eyebrow={session?.agent}
        actions={[
          {
            label: 'Switch session',
            hint: 'See what else is running, without leaving this conversation',
            icon: <Repeat2 size={18} color={palette.ink2} />,
            onPress: () => setPendingSurface('switcher'),
          },
          {
            label: 'Session tools',
            hint: 'Plan, agents, git diff, files, browser and terminal',
            icon: <ListTree size={18} color={palette.ink2} />,
            onPress: () => setPendingSurface('panel'),
          },
          {
            label: 'Start another task',
            hint: 'Open a new session without losing this conversation',
            icon: <Zap size={18} color={palette.accent} />,
            onPress: () => setNewTaskOpen(true),
          },
          {
            label: 'Switch agent',
            hint: 'Move this session to a different CLI or model, keeping the transcript',
            icon: <GitFork size={18} color={palette.ink2} />,
            onPress: () => setEngineOpen(true),
          },
          {
            label: 'Spawn a subagent',
            hint: 'Run a focused task in parallel and collect the result',
            icon: <Users size={18} color={palette.ink2} />,
            onPress: () => setSubagentOpen(true),
          },
          {
            label: 'Find in this session',
            hint: 'Search the transcript and jump to a message',
            icon: <ListTree size={18} color={palette.ink2} />,
            onPress: () => setPendingSurface('search'),
          },
          {
            label: 'Copy transcript as JSON',
            hint: 'Put the whole conversation on the clipboard',
            icon: <Archive size={18} color={palette.ink2} />,
            onPress: () => {
              try {
                Clipboard.setString(
                  JSON.stringify(
                    { session: session ?? PLACEHOLDER_SESSION, messages: conversation.messages },
                    null,
                    2,
                  ),
                )
                toast({ message: 'Transcript copied', tone: 'ok' })
              } catch {
                toast({ message: 'Could not copy the transcript', tone: 'danger' })
              }
            },
          },
          ...(session && (session.status === 'needs_resume' || session.status === 'exited' || session.status === 'idle')
            ? [
                {
                  label: 'Resume session',
                  hint: 'Continue from where it left off',
                  icon: <Zap size={18} color={palette.ok} />,
                  onPress: () => {
                    void resumeSession(sessionId).then((ok) => {
                      if (!ok) toast({ message: 'Could not resume that session', tone: 'danger' })
                    })
                  },
                },
              ]
            : []),
          {
            label: 'Fork session',
            hint: 'Branch into a new session with the same history',
            icon: <GitFork size={18} color={palette.ink2} />,
            onPress: () => {
              void forkSession(sessionId).then((forked) => {
                if (forked) {
                  navigation.push('Session', { sessionId: forked.id })
                  toast({ message: 'Forked into a new session', tone: 'ok' })
                } else {
                  toast({ message: 'Could not fork that session', tone: 'danger' })
                }
              })
            },
          },
          ...(session?.status === 'archived'
            ? [
                {
                  label: 'Restore from archive',
                  hint: 'Bring this session back into the list',
                  icon: <ArchiveRestore size={18} color={palette.wait} />,
                  onPress: () => {
                    void archiveSession(sessionId, true)
                    toast({ message: 'Restored', tone: 'ok' })
                  },
                },
              ]
            : [
                {
                  label: 'Archive session',
                  hint: 'Hide it without losing its history',
                  icon: <Archive size={18} color={palette.ink2} />,
                  onPress: () => {
                    void archiveSession(sessionId)
                    void mobileApi()
                    toast({ message: 'Archived', tone: 'ok' })
                  },
                },
              ]),
          {
            label: 'Delete session',
            hint: 'Permanently remove it and its history',
            icon: <ArchiveRestore size={18} color={palette.danger} />,
            tone: 'danger' as const,
            onPress: () => setPendingSurface('delete'),
          },
        ]}
      />

      <ConfirmDialog
        open={confirmDelete}
        title="Delete this session?"
        body={`“${session?.name ?? 'This session'}” and its full history will be removed from the desktop. This cannot be undone.`}
        confirmLabel="Delete forever"
        onClose={() => setConfirmDelete(false)}
        onConfirm={() => void doDelete()}
      />
    </View>
  )
}

/* ── Context strip ─────────────────────────────────────────────────────────────
 * The desktop's `FloatingHud`, reduced to one line and pinned where a thumb
 * cannot miss it.
 *
 * It is a row of *tappable segments*, not a readout, because every fact it can
 * show has a screen that acts on it: plan progress opens the plan, subagents
 * open the agents tab, and a state that is not "fine" says what to do about it.
 * A status line you cannot act on is a line of decoration. */

function ContextStrip({
  uiState,
  planDone,
  planTotal,
  subagents,
  onPlan,
  onAgents,
}: {
  uiState: string
  planDone: number
  planTotal: number
  subagents: number
  onPlan: () => void
  onAgents: () => void
}) {
  const display = uiStateDisplay(uiState as never)

  // Nothing to say: no plan, no subagents, and a state whose own label is
  // already in the header. A strip with nothing in it is a bar of padding.
  const hasPlan = planTotal > 0
  const hasSubagents = subagents > 0
  if (!hasPlan && !hasSubagents && display.label === 'Ready') return null

  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 8,
        borderTopWidth: 1,
        borderTopColor: palette.line,
        backgroundColor: palette.canvas,
        paddingHorizontal: 12,
        paddingVertical: 7,
      }}
    >
      {hasPlan ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Plan, ${planDone} of ${planTotal} steps done`}
          accessibilityHint="Opens the plan"
          onPress={onPlan}
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            gap: 7,
            flex: 1,
            minHeight: 26,
            borderRadius: radius.sm,
            paddingHorizontal: 7,
            backgroundColor: pressed ? palette.raised : 'transparent',
          })}
        >
          <ListTree size={13} color={palette.ink3} />
          <View style={{ flex: 1 }}>
            <ProgressBar value={planTotal ? planDone / planTotal : 0} tone={planDone === planTotal ? 'ok' : 'accent'} />
          </View>
          <Text style={{ color: palette.ink3, fontSize: 10.5, fontVariant: ['tabular-nums'] }}>
            {planDone}/{planTotal}
          </Text>
        </Pressable>
      ) : null}

      {hasSubagents ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`${subagents} subagents running`}
          accessibilityHint="Opens the agents panel"
          onPress={onAgents}
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            gap: 5,
            minHeight: 26,
            borderRadius: radius.sm,
            paddingHorizontal: 8,
            backgroundColor: pressed ? palette.raised : 'transparent',
          })}
        >
          <Users size={13} color={palette.accent} />
          <Text style={{ color: palette.accent, fontSize: 11.5, fontWeight: '600' }}>{subagents}</Text>
        </Pressable>
      ) : null}

      {hasPlan || hasSubagents ? null : (
        <Text style={{ flex: 1, color: palette.ink3, fontSize: 12 }} numberOfLines={1}>
          {display.hint ?? display.label}
        </Text>
      )}
    </View>
  )
}

export { ChevronLeft }
