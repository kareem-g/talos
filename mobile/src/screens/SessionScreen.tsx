/**
 * Session — the conversation with one agent.
 *
 * EMBER CLAY REDESIGN — "the hearth"
 * ----------------------------------
 * A phone-native cousin of the desktop SessionView, not a copy. The desktop
 * is a compact remote-control header (back + title + status pill + detail +
 * project + connection, with pane openers for sessions / controls / workspace)
 * over a Timeline + StateZone, with the left navigator and right workspace
 * rail surfacing as side sheets. This screen keeps that skeleton but hearths
 * it for one thumb:
 *
 *   - **Two-row header.** Row one: where you are, what state it is in, the
 *     two panes that matter (sessions left, workspace right) and the overflow.
 *     Row two: the desktop's detail overflow — project, branch, connection —
 *     full-width in mono, because at phone width it never fits beside the
 *     title. The agent hue burns underneath as a 2pt ember line: identity,
 *     not state.
 *   - **HUD island.** The desktop's collapsed FloatingHud as a floating pill
 *     pinned above the composer: plan progress + subagent count, tappable to
 *     the matching workspace tab. A shortcut, not a readout.
 *   - **The desktop's left rail → a sheet, the right rail → a pushed screen.**
 *     Switching sessions is a glance over the transcript; a plan, diff, file
 *     tree and terminal deserve the whole screen. Same split as the desktop,
 *     different widths.
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
import { agentColor, palette, radius, shadowFloating } from '@app/design/tokens'
import { Transcript } from '@app/components/Transcript'
import { Composer } from '@app/components/Composer'
import { NewTaskSheet } from '@app/components/NewTaskSheet'
import { SubagentSheet } from '@app/components/SubagentModal'
import { EngineSwitchSheet } from '@app/components/EngineSwitchModal'
import { SessionSwitcherSheet } from '@app/components/SessionLeftRail'
import { SessionSearchSheet } from '@app/components/CommandPalette'
import { AttentionPill } from '@app/components/AttentionPill'
import { ActionSheet, ConfirmDialog } from '@app/components/Sheet'
import { BackButton } from '@app/components/Screen'
import { deriveSubagents, latestPlanInfo } from '@app/lib/sessionView'
import { AgentAvatar, Dot, ProgressBar, StatusPill, IconButton, toast } from '@app/components/ui'

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

  const projectLeaf = session?.project?.split('/').filter(Boolean).pop() ?? null
  const offline = connection !== 'connected'

  return (
    <View className="flex-1 bg-canvas">
      {/* ── Hearth header ───────────────────────────────────────────────
          The desktop SessionView's compact header, hearth-styled: row one is
          navigation + identity + state + the two panes; row two is the detail
          overflow (project · branch · connection) in mono. */}
      <View style={{ paddingTop: insets.top, backgroundColor: palette.chrome, borderBottomWidth: 1, borderBottomColor: palette.line }}>
        <View className="min-h-[56px] flex-row items-center gap-1.5 pl-1 pr-2">
          <BackButton onPress={() => navigation.goBack()} label="Back to the deck" />
          <AgentAvatar agent={session?.agent ?? ''} name={session?.agent} size={34} />
          <View className="min-w-0 flex-1 px-1">
            <Text className="text-[16px] leading-[21px] font-semibold text-ink" style={{ letterSpacing: -0.25 }} numberOfLines={1}>
              {session?.name ?? 'Session'}
            </Text>
            <Text className="text-[11.5px] leading-[15px] text-ink-3" numberOfLines={1}>
              {session?.agent || 'loading…'}
              {projectLeaf ? ` · ${projectLeaf}` : ''}
            </Text>
          </View>
          <StatusPill tone={tone} label={display.label} pulse={display.pulse} size="sm" />
          <IconButton
            label="Switch session"
            accessibilityHint="See what else is running, without leaving this conversation"
            size={36}
            onPress={() => setSwitcherOpen(true)}
          >
            <Repeat2 size={18} color={palette.ink2} />
          </IconButton>
          <IconButton
            label="Open workspace"
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

        {/* Detail overflow: the desktop's second row, full-width on narrow. */}
        {session?.branch || projectLeaf || offline || display.hint ? (
          <View className="flex-row items-center gap-1.5 px-4 pb-2">
            {session?.branch ? (
              <Text className="shrink-0 text-[11px] leading-[14px] text-accent" numberOfLines={1}>
                {session.branch}
              </Text>
            ) : null}
            {projectLeaf && session?.branch ? (
              <Text className="text-[11px] text-ink-4">·</Text>
            ) : null}
            {projectLeaf ? (
              <Text className="min-w-0 flex-1 text-[11px] leading-[14px] text-ink-3" numberOfLines={1}>
                {session?.project}
              </Text>
            ) : null}
            {offline ? (
              <View className="shrink-0 flex-row items-center gap-1">
                <Dot tone="danger" />
                <Text className="text-[11px] capitalize text-ink-3">{connection}</Text>
              </View>
            ) : null}
          </View>
        ) : null}

        {/* The ember line: identity, not state. */}
        <View style={{ height: 2, backgroundColor: accent, opacity: session ? 0.85 : 0.2 }} />
      </View>

      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? insets.top : 0}
      >
        <View className="flex-1">
          <Transcript
            sessionId={sessionId}
            messages={conversation.messages}
            revision={revision}
            onViewPlan={() => openPanel('plan')}
          />

          {/* ── HUD island ────────────────────────────────────────────
              The desktop's collapsed FloatingHud as a floating pill: what it
              is doing right now, tappable to the matching workspace tab. */}
          <HudIsland
            uiState={uiState}
            planDone={planDone}
            planTotal={planTotal}
            subagents={runningSubagents}
            onPlan={() => openPanel('plan')}
            onAgents={() => openPanel('agents')}
          />
        </View>

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

/* ── HUD island ────────────────────────────────────────────────────────────────
 * The desktop's collapsed FloatingHud as a floating pill pinned above the
 * composer: plan progress on the left, subagents on the right. Each segment
 * opens its workspace tab — a shortcut, not a readout. Nothing to say (no
 * plan, no subagents, Ready) renders nothing: an island with nothing on it is
 * a bar of padding. */

function HudIsland({
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

  const hasPlan = planTotal > 0
  const hasSubagents = subagents > 0
  if (!hasPlan && !hasSubagents && display.label === 'Ready') return null

  return (
    <View pointerEvents="box-none" style={{ paddingHorizontal: 12, paddingBottom: 8, alignItems: 'center' }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          borderRadius: radius.pill,
          borderWidth: 1,
          borderColor: palette.lineStrong,
          backgroundColor: palette.raised,
          paddingLeft: 6,
          paddingRight: 6,
          paddingVertical: 5,
          gap: 4,
          ...shadowFloating,
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
              gap: 8,
              borderRadius: radius.pill,
              paddingHorizontal: 10,
              paddingVertical: 6,
              backgroundColor: pressed ? palette.hover : 'transparent',
            })}
          >
            <ListTree size={13} color={palette.accent} />
            <View style={{ width: 64 }}>
              <ProgressBar value={planTotal ? planDone / planTotal : 0} tone={planDone === planTotal ? 'ok' : 'accent'} />
            </View>
            <Text style={{ color: palette.ink2, fontSize: 11, fontWeight: '700', fontVariant: ['tabular-nums'] }}>
              {planDone}/{planTotal}
            </Text>
          </Pressable>
        ) : null}

        {hasPlan && hasSubagents ? (
          <View style={{ width: 1, height: 16, backgroundColor: palette.lineStrong }} />
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
              gap: 6,
              borderRadius: radius.pill,
              paddingHorizontal: 10,
              paddingVertical: 6,
              backgroundColor: pressed ? palette.hover : 'transparent',
            })}
          >
            <Users size={13} color={palette.accent} />
            <Text style={{ color: palette.accent, fontSize: 11.5, fontWeight: '700' }}>{subagents}</Text>
          </Pressable>
        ) : null}

        {!hasPlan && !hasSubagents ? (
          <Text style={{ color: palette.ink3, fontSize: 12, paddingHorizontal: 10, paddingVertical: 6 }} numberOfLines={1}>
            {display.hint ?? display.label}
          </Text>
        ) : null}
      </View>
    </View>
  )
}

export { ChevronLeft }
