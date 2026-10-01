/**
 * Session — the desktop SessionView, ported screen-for-screen.
 *
 * QAI · WARM STUDIO
 * -----------------
 * The desktop's mobile shell gives a session exactly one screen and exactly
 * four header moves, and this screen keeps that contract:
 *
 *   ‹ back · title + status pill · project · connection
 *   ⚙︎ Model & permissions (right sheet — SessionControls)
 *   ◧ Sessions pane (LEFT sheet — Rooms / Sessions / Explorer)
 *   ◨ Workspace (RIGHT sheet — the RightRail's tab strip)
 *   ⋯ Session actions (the phone's overflow: retry, fork, archive, search…)
 *
 * Under the header: the notice strip (session errors), the Timeline, the HUD
 * island (plan progress + subagents), and the one-line composer — model and
 * permission controls live in the ⚙︎ sheet, not the composer, which is the
 * desktop's own mobile rule ("the composer stays one line and the keyboard
 * keeps its room").
 *
 * The timeline carries the desktop's simple/detailed toggle: simple folds
 * every tool run to one friendly line; detailed expands steps, durations and
 * raw output. The choice persists, per device, like the desktop's.
 */

import * as React from 'react'
import {KeyboardAvoidingView, Platform, Pressable, View} from 'react-native'
import { Text } from '@app/components/Text'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import {
  Archive,
  ArchiveRestore,
  BookmarkPlus,
  GitFork,
  List,
  ListTree,
  MoreHorizontal,
  PanelLeft,
  PanelRight,
  RotateCcw,
  Search,
  Settings2,
  SlidersHorizontal,
  Users,
  Zap,
} from 'lucide-react-native'
import Clipboard from '@react-native-clipboard/clipboard'

import { sessionUIState, uiStateDisplay } from '@/lib/sessionState'
import { useStore, useConversation } from '@app/store'
import { mobileApi } from '@app/lib/api'
import type { RootStackParamList } from '@app/navigation'
import { openNewTask } from '@app/lib/newTask'
import { palette, radius, shadowFloating } from '@app/design/tokens'
import { Transcript } from '@app/components/Transcript'
import { Composer } from '@app/components/Composer'
import { SubagentSheet } from '@app/components/SubagentModal'
import { SessionSearchSheet } from '@app/components/CommandPalette'
import { AttentionPill } from '@app/components/AttentionPill'
import { RunBar } from '@app/components/session/RunBar'
import { LeftPaneSheet } from '@app/components/session/LeftPaneSheet'
import { SessionControlsSheet } from '@app/components/session/SessionControlsSheet'
import { WorkspaceRail, type PanelTabId } from '@app/components/panel/WorkspaceRail'
import { ActionSheet, ConfirmDialog, SideSheet } from '@app/components/Sheet'
import { BackButton } from '@app/components/Screen'
import { deriveSubagents, latestPlanInfo } from '@app/lib/sessionView'
import {
  Dot,
  Mono,
  Notice,
  ProgressBar,
  StatusPill,
  IconButton,
  haptic,
  toast,
} from '@app/components/ui'

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
  const notice = useStore((state) => state.notices[sessionId])
  const dismissNotice = useStore((state) => state.dismissNotice)
  const removeSession = useStore((state) => state.removeSession)
  const resumeSession = useStore((state) => state.resumeSession)
  const forkSession = useStore((state) => state.forkSession)
  const archiveSession = useStore((state) => state.archiveSession)
  const resendLastUserPrompt = useStore((state) => state.resendLastUserPrompt)
  const loadSnapshot = useStore((state) => state.loadSnapshot)
  const timelineDetail = useStore((state) => state.timelineDetail)
  const setTimelineDetail = useStore((state) => state.setTimelineDetail)

  /** Which side pane is open, if any — the desktop SessionView's own state. */
  const [pane, setPane] = React.useState<'sessions' | 'controls' | 'workspace' | null>(null)
  const [workspaceTab, setWorkspaceTab] = React.useState<PanelTabId | undefined>()
  const [searchOpen, setSearchOpen] = React.useState(false)
  const [subagentOpen, setSubagentOpen] = React.useState(false)
  const [menuOpen, setMenuOpen] = React.useState(false)
  const [confirmDelete, setConfirmDelete] = React.useState(false)
  /**
   * What to present once the action sheet has finished animating out.
   * Two modals cannot be stacked from a dismissing one, so an action that
   * opens another surface waits for the first to be gone.
   */
  const [pendingSurface, setPendingSurface] = React.useState<'search' | 'delete' | null>(null)

  React.useEffect(() => {
    void openSession(sessionId)
  }, [sessionId, openSession])

  React.useEffect(() => {
    if (!pendingSurface) return
    switch (pendingSurface) {
      case 'search':
        setSearchOpen(true)
        break
      case 'delete':
        setConfirmDelete(true)
        break
    }
    setPendingSurface(null)
  }, [pendingSurface])

  const uiState = session ? sessionUIState(session, conversation, connection) : 'ready'
  const display = uiStateDisplay(uiState)
  // `uiStateDisplay` is the shared desktop contract and names its tones
  // `green | orange | red | dim`; the mobile palette names the same four
  // states `ok | wait | danger | muted`. Mapping here, once, is what lets the
  // two apps agree on *what state this is* without agreeing on the name.
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

  const plan = React.useMemo(() => latestPlanInfo(conversation.messages), [conversation.messages, revision])
  const subagents = React.useMemo(() => deriveSubagents(conversation.messages), [conversation.messages, revision])
  const planDone = plan?.entries?.filter((entry) => entry.status === 'completed').length ?? 0
  const planTotal = plan?.entries?.length ?? plan?.stepCount ?? 0
  const runningSubagents = subagents.filter((agent) => agent.status === 'working').length

  const busy = uiState === 'working' || uiState === 'starting' || uiState === 'resuming'
  const activityDetail = conversation.activity?.detail
  const working = display.pulse === true

  function openWorkspace(tab?: PanelTabId) {
    setWorkspaceTab(tab)
    setPane('workspace')
  }

  /** Switch sessions from a pane: replace, so the back stack does not grow
   *  one screen per hop — the desktop navigates, it does not stack. */
  function switchSession(id: string) {
    setPane(null)
    if (id === sessionId) return
    navigation.replace('Session', { sessionId: id })
  }

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

  /** Save this conversation as a project memory on the desktop. */
  async function saveMemory() {
    setMenuOpen(false)
    try {
      const result = await mobileApi.saveMemory(sessionId)
      if (result.saved) toast({ message: 'Saved to project memory', tone: 'ok' })
      else toast({ message: result.error ?? 'Nothing to remember yet', tone: 'wait' })
    } catch (cause) {
      toast({
        message: 'Could not save a memory',
        detail: cause instanceof Error ? cause.message : undefined,
        tone: 'danger',
      })
    }
  }

  const projectLeaf = session?.project?.split('/').filter(Boolean).pop() ?? null
  const offline = connection !== 'connected'

  return (
    <View className="flex-1 bg-canvas">
      {/* ── Compact remote-control header (the desktop's, row for row) ── */}
      <View
        style={{
          paddingTop: insets.top,
          backgroundColor: palette.canvas,
          borderBottomWidth: 1,
          borderBottomColor: palette.line,
        }}
      >
        <View className="min-h-[52px] flex-row items-center gap-1 pl-1 pr-1.5">
          <BackButton onPress={() => navigation.goBack()} label="Back" />

          <View className="min-w-0 flex-1 px-1">
            <Text className="text-[13.5px] leading-[18px] font-medium text-ink" style={{ letterSpacing: -0.15 }} numberOfLines={1}>
              {session?.name ?? 'Session'}
            </Text>
            {/* Single status line: pill · project · connection — the desktop's
                one source of truth for this screen. */}
            <View className="mt-0.5 flex-row items-center gap-1.5">
              <StatusPill tone={tone} label={display.label} pulse={display.pulse} size="sm" />
              {projectLeaf ? (
                <>
                  <Text className="text-[10.5px] text-ink-4">·</Text>
                  <Mono className="min-w-0 flex-1 text-[10.5px] text-ink-3" numberOfLines={1}>
                    {projectLeaf}
                  </Mono>
                </>
              ) : null}
              {offline ? (
                <View className="flex-row items-center gap-1">
                  <Dot tone="danger" />
                  <Text className="text-[10.5px] capitalize text-ink-3">{connection}</Text>
                </View>
              ) : null}
            </View>
          </View>

          {/* The desktop's four pane openers, same icons, same order — plus
              the phone's overflow, because session actions have to live
              somewhere a thumb can reach. */}
          <IconButton
            label="Model and permissions"
            size={34}
            active={pane === 'controls'}
            tone="accent"
            onPress={() => {
              void haptic('light')
              setPane((current) => (current === 'controls' ? null : 'controls'))
            }}
          >
            <Settings2 size={16} color={pane === 'controls' ? palette.accent : palette.ink2} />
          </IconButton>
          <IconButton
            label="Sessions pane"
            size={34}
            active={pane === 'sessions'}
            tone="accent"
            onPress={() => {
              void haptic('light')
              setPane((current) => (current === 'sessions' ? null : 'sessions'))
            }}
          >
            <PanelLeft size={16} color={pane === 'sessions' ? palette.accent : palette.ink2} />
          </IconButton>
          <IconButton
            label="Workspace"
            size={34}
            active={pane === 'workspace'}
            tone="accent"
            onPress={() => {
              void haptic('light')
              setPane((current) => (current === 'workspace' ? null : 'workspace'))
            }}
          >
            <PanelRight size={16} color={pane === 'workspace' ? palette.accent : palette.ink2} />
          </IconButton>
          <IconButton
            label="Session actions"
            size={34}
            onPress={() => setMenuOpen(true)}
          >
            <MoreHorizontal size={16} color={palette.ink2} />
          </IconButton>
        </View>

      </View>

      {/* The RunBar: the desktop's floating HUD and its state zone, folded into
          one 44pt strip that stays visible at every scroll position. */}
      <RunBar
        sessionId={sessionId}
        tone={tone}
        label={display.label}
        pulse={display.pulse}
        detail={activityDetail}
        cost={session?.cost ?? undefined}
        tokens={session?.tokens_used ?? undefined}
        working={working}
      />

      {notice ? (
        <View className="px-4 pt-2">
          <Notice
            tone="danger"
            message={notice}
            action={{ label: 'Dismiss', onPress: () => dismissNotice(sessionId) }}
          />
        </View>
      ) : null}

      <KeyboardAvoidingView
        className="flex-1"
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        // Zero offset: this view starts below a custom header and ends at the
        // screen's bottom edge, so the overlap the KAV computes IS the
        // keyboard height. Adding the top inset here (the old code) padded the
        // view by ~59px extra — the gap users saw above the keyboard.
        keyboardVerticalOffset={0}
      >
        <View className="flex-1">
          <Transcript
            sessionId={sessionId}
            messages={conversation.messages}
            revision={revision}
            simple={timelineDetail === 'simple'}
            onViewPlan={() => openWorkspace('plan')}
          />

          {/* ── HUD island — the desktop's collapsed FloatingHud ─────── */}
          <HudIsland
            uiState={uiState}
            planDone={planDone}
            planTotal={planTotal}
            subagents={runningSubagents}
            onPlan={() => openWorkspace('plan')}
            onAgents={() => openWorkspace('agents')}
          />
        </View>

        <Composer sessionId={sessionId} uiState={uiState} />
      </KeyboardAvoidingView>

      {/* ── The desktop's three panes, as side sheets ─────────────────── */}
      {session ? (
        <LeftPaneSheet
          open={pane === 'sessions'}
          onClose={() => setPane(null)}
          session={session}
          onSelectSession={switchSession}
          onOpenWorkspace={() => openWorkspace()}
        />
      ) : null}

      <SessionControlsSheet
        open={pane === 'controls'}
        onClose={() => setPane(null)}
        sessionId={sessionId}
        agentId={session?.agent ?? ''}
      />

      <SideSheet
        open={pane === 'workspace'}
        onClose={() => setPane(null)}
        title="Workspace"
        side="right"
      >
        <View style={{ marginHorizontal: -10, marginVertical: -10, flex: 1 }}>
          <WorkspaceRail
            sessionId={sessionId}
            initialTab={workspaceTab}
            onOpenSession={switchSession}
          />
        </View>
      </SideSheet>

      <SessionSearchSheet
        open={searchOpen}
        sessionId={sessionId}
        onClose={() => setSearchOpen(false)}
        onNewTask={() => {
          setSearchOpen(false)
          openNewTask(undefined, session?.project ?? undefined)
        }}
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

      <AttentionPill />

      <ActionSheet
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        onDismiss={() => setPendingSurface(null)}
        title={session?.name}
        eyebrow={session?.agent}
        actions={[
          {
            label: timelineDetail === 'simple' ? 'Show technical detail' : 'Simplify the timeline',
            hint: 'Simple folds tool runs to one line; detailed expands steps and output',
            icon:
              timelineDetail === 'simple' ? (
                <SlidersHorizontal size={18} color={palette.ink2} />
              ) : (
                <List size={18} color={palette.ink2} />
              ),
            onPress: () => {
              void haptic('select')
              setTimelineDetail(timelineDetail === 'simple' ? 'detailed' : 'simple')
            },
          },
          {
            label: 'Retry last prompt',
            hint: 'Re-send your most recent message to the agent',
            icon: <RotateCcw size={18} color={palette.ink2} />,
            disabled: busy,
            onPress: () => {
              if (resendLastUserPrompt(sessionId)) toast({ message: 'Prompt re-sent', tone: 'ok' })
              else toast({ message: 'Nothing to re-send yet', tone: 'muted' })
            },
          },
          {
            label: 'Start another task',
            hint: 'Open a new session without losing this conversation',
            icon: <Zap size={18} color={palette.accent} />,
            onPress: () => openNewTask(undefined, session?.project ?? undefined),
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
            icon: <Search size={18} color={palette.ink2} />,
            onPress: () => setPendingSurface('search'),
          },
          {
            label: 'Open workspace full screen',
            hint: 'Plan, agents, git, files, browser and terminal',
            icon: <ListTree size={18} color={palette.ink2} />,
            onPress: () => navigation.navigate('SessionPanel', { sessionId }),
          },
          {
            label: 'Save to project memory',
            hint: 'Store this conversation as a memory on the desktop',
            icon: <BookmarkPlus size={18} color={palette.ink2} />,
            onPress: () => void saveMemory(),
          },
          {
            label: 'Copy transcript as JSON',
            hint: 'Put the whole conversation on the clipboard',
            icon: <Archive size={18} color={palette.ink2} />,
            onPress: () => {
              try {
                Clipboard.setString(
                  JSON.stringify({ session: session ?? null, messages: conversation.messages }, null, 2),
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
                    void loadSnapshot()
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
 * plan, no subagents, Ready) renders nothing. */

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
          backgroundColor: palette.surface,
          paddingLeft: 4,
          paddingRight: 4,
          paddingVertical: 4,
          gap: 2,
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
