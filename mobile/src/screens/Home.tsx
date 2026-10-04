/**
 * Home — Projects. The default tab: hero with the live truth, filter strip,
 * the needs-you triage with inline actions, running agents, and collapsible
 * project groups. Pull-to-refresh stays.
 */

import * as React from 'react'
import { Animated, Pressable, RefreshControl, ScrollView, View, type StyleProp, type ViewStyle } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'

import { deriveHomeView, type HomeFilter } from '@/lib/homeView'
import { MemorySection } from './Session'
import { basename } from '@/lib/format'
import { describeApproval } from '@/lib/approvals'
import { getConversation, useStore, useConversation } from '@/store'
import { firstOpenApprovalId, uiStateDisplay } from '@/lib/sessionState'
import type { RootStack } from '../navigation'
import type { Session } from '@/types/session'
import { agentHue, color } from '../design/tokens'
import { MONO, W_SEMI } from '../design/fonts'
import { ChevronDown, ChevronRight, Folder, Plus, Search, Sliders, Star, Trash } from '../design/icons'
import { useShell } from '../shell'
import { Btn, Chip, Dot, Empty, Loader, Pill, Search as SearchWell, Sheet, Tap, Text, haptic, type Tone } from '../ui'

export function HomeScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStack>>()
  const shell = useShell()
  const insets = useSafeAreaInsets()

  const sessions = useStore((s) => s.sessions)
  const loading = useStore((s) => s.sessionsLoading)
  const starred = useStore((s) => s.starred)
  const connection = useStore((s) => s.connection)
  const desktopName = useStore((s) => s.desktopName)
  const notices = useStore((s) => s.notices)
  const revisions = useStore((s) => s.revisions)
  const agents = useStore((s) => s.agents)
  const respondToApproval = useStore((s) => s.respondToApproval)
  const resumeSession = useStore((s) => s.resumeSession)
  const toggleStar = useStore((s) => s.toggleStar)
  const removeSession = useStore((s) => s.removeSession)
  const openSessionStore = useStore((s) => s.openSession)
  const loadSnapshot = useStore((s) => s.loadSnapshot)
  const loadPending = useStore((s) => s.loadPending)

  const [filter, setFilter] = React.useState<HomeFilter>('all')
  const [search, setSearch] = React.useState('')
  const [collapsed, setCollapsed] = React.useState<Record<string, boolean>>({})
  const [busy, setBusy] = React.useState<Record<string, boolean>>({})
  const [refreshing, setRefreshing] = React.useState(false)
  const [workspaceSettings, setWorkspaceSettings] = React.useState<string | null | undefined>(undefined)
  const [pendingDelete, setPendingDelete] = React.useState<Session | null>(null)
  const [deleting, setDeleting] = React.useState(false)

  const openSession = React.useCallback(
    (session: Session) => {
      void openSessionStore(session.id)
      navigation.navigate('Session', { sessionId: session.id })
    },
    [navigation, openSessionStore],
  )

  const providerNameFor = React.useCallback(
    (id: string) => agents.find((agent) => agent.id === id)?.name ?? id,
    [agents],
  )

  React.useEffect(() => {
    void loadSnapshot(filter === 'archived')
  }, [filter, loadSnapshot])

  React.useEffect(() => {
    void loadPending()
  }, [loadPending])

  const view = React.useMemo(
    () =>
      deriveHomeView({
        sessions,
        connection,
        search,
        filter,
        starredSet: new Set(starred),
        getConversation,
        providerNameFor,
        notices,
        now: Date.now(),
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sessions, connection, search, filter, starred, providerNameFor, notices, revisions],
  )

  const onRefresh = React.useCallback(async () => {
    setRefreshing(true)
    try {
      await loadSnapshot(filter === 'archived')
    } finally {
      setRefreshing(false)
    }
  }, [filter, loadSnapshot])

  const filters: Array<{ id: HomeFilter; label: string; count: number }> = [
    { id: 'all', label: 'All', count: view.counts.total },
    { id: 'attention', label: 'Attention', count: view.counts.attention },
    { id: 'active', label: 'Active', count: view.counts.running },
    { id: 'starred', label: 'Starred', count: starred.length },
    { id: 'archived', label: 'Archived', count: view.counts.archived },
  ]

  const liveTone: Tone = connection === 'connected' ? 'green' : connection === 'connecting' || connection === 'reconnecting' ? 'orange' : 'red'
  const liveLabel = connection === 'connected' ? 'Live' : connection

  return (
    <View className="flex-1 bg-canvas">
      <ScrollView
        className="flex-1 bg-canvas"
        contentContainerStyle={{ paddingBottom: insets.bottom + 110 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void onRefresh()}
            tintColor={color.ink3}
            colors={[color.accent]}
            progressBackgroundColor={color.card}
          />
        }
      >
        {/* Hero — `.hero` 14px 16px 0, the accent verb on a 36pt circle */}
        <View className="px-4" style={{ paddingTop: insets.top + 14 }}>
          <View className="flex-row items-end gap-2.5">
            <Text className="text-large-title font-bold text-ink" style={{ letterSpacing: -0.5 }}>
              Projects
            </Text>
            <View className="flex-1" />
            <Tap
              accessibilityRole="button"
              accessibilityLabel="New session"
              onPress={() => {
                void haptic('light')
                shell.openNewTask()
              }}
              squeeze={0.92}
              className="h-9 w-9 shrink-0 items-center justify-center rounded-full bg-field"
            >
              <Plus size={20} color={color.ink} stroke={2} />
            </Tap>
          </View>
          <View className="mt-[7px] flex-row items-center gap-1.5">
            <Dot tone={liveTone} pulse={connection !== 'connected'} size={7} />
            <Text className="min-w-0 flex-1 text-sub text-ink-2" numberOfLines={1}>
              <Text className="font-medium text-ink-2">{liveLabel}</Text> · {desktopName || 'desktop'} · {view.workspaces.length} projects · {view.counts.total} sessions
            </Text>
          </View>
        </View>

        {/* Search — `.search`, 6pt above / 4pt below the gutters */}
        <View className="mx-4 mt-1.5 mb-1">
          <SearchWell
            value={search}
            onChangeText={setSearch}
            placeholder="Search sessions, projects, agents"
            icon={<Search size={15} color={color.ink3} />}
          />
        </View>

        {/* Chips — `.chips` 10px 16px 2px, 8pt apart */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 8, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 2 }}
        >
          {filters.map((f) => (
            <Chip
              key={f.id}
              label={f.label}
              count={f.count}
              dot={f.id === 'attention' && f.count > 0 ? 'orange' : undefined}
              on={filter === f.id}
              onPress={() => setFilter(f.id)}
            />
          ))}
        </ScrollView>

        {/* Needs you */}
        <View className="mt-[26px] px-4 pb-[9px]">
          <View className="flex-row items-baseline gap-2">
            <Text className="text-[13px] font-semibold text-ink-2">Needs You</Text>
            <Text className="text-[12px] font-medium text-ink-3" style={{ fontVariant: ['tabular-nums'] }}>
              {view.attention.length}
            </Text>
          </View>
        </View>

        {loading && sessions.length === 0 ? (
          <Skeleton />
        ) : view.attention.length === 0 ? (
          <View className="mx-4 items-center rounded-[16px] border border-dashed border-line px-6 py-8">
            <Text className="text-[15px] font-semibold text-ink-2">All clear</Text>
            <Text className="mt-1 text-center text-[12.5px] text-ink-3">No sessions need you right now.</Text>
          </View>
        ) : (
          view.attention.map(({ session, uiState, headline, idleFor }) => {
            const isPaused = uiState === 'paused'
            const isFailed = uiState === 'failed'
            const display = uiStateDisplay(uiState)
            const approval = firstOpenApprovalId(getConversation(session.id))
              ? describeApproval(latestApprovalPrompt(session.id), [])
              : undefined
            const allow = approval?.options.find((option) => option.kind === 'allow')
            const isBusy = !!busy[session.id]
            return (
              <View key={session.id} className="mx-4 mb-2.5 rounded-[16px] bg-surface px-4 pb-3 pt-3.5">
                <View className="flex-row items-center gap-2.5">
                  <Text className="min-w-0 flex-1 text-[15.5px] font-semibold text-ink" numberOfLines={1}>
                    {session.name}
                  </Text>
                  <Pill label={display.label} tone={display.tone} pulse={display.pulse} />
                  {idleFor ? (
                    <Text className="shrink-0 text-[13px] text-ink-3" style={{ fontVariant: ['tabular-nums'] }}>
                      {idleFor}
                    </Text>
                  ) : null}
                </View>
                <Text className="mt-1.5 text-[12px] leading-[18px] text-ink-2" numberOfLines={2} style={{ fontFamily: MONO }}>
                  {headline}
                </Text>
                <View className="mt-[11px] flex-row justify-end gap-2">
                  {isFailed ? (
                    <Btn
                      size="sm"
                      label={isBusy ? 'Retrying…' : 'Retry'}
                      disabled={isBusy}
                      onPress={() => {
                        setBusy((m) => ({ ...m, [session.id]: true }))
                        void resumeSession(session.id).finally(() => setBusy((m) => ({ ...m, [session.id]: false })))
                      }}
                    />
                  ) : isPaused ? (
                    <Btn
                      size="sm"
                      kind="primary"
                      label={isBusy ? 'Resuming…' : 'Resume'}
                      disabled={isBusy}
                      onPress={() => {
                        setBusy((m) => ({ ...m, [session.id]: true }))
                        void resumeSession(session.id).finally(() => setBusy((m) => ({ ...m, [session.id]: false })))
                      }}
                    />
                  ) : approval && allow ? (
                    <Btn
                      size="sm"
                      kind="primary"
                      label={allow.label}
                      onPress={() => {
                        const requestId = firstOpenApprovalId(getConversation(session.id))
                        if (requestId) respondToApproval(session.id, requestId, allow.value)
                      }}
                    />
                  ) : null}
                  <Btn size="sm" kind="ghost" label="Open" after={<ChevronRight size={13} color={color.accent} stroke={2.4} />} onPress={() => openSession(session)} />
                </View>
              </View>
            )
          })
        )}

        {/* Active */}
        <View className="mt-[26px] px-4 pb-[9px]">
          <View className="flex-row items-baseline gap-2">
            <Text className="text-[13px] font-semibold text-ink-2">Active</Text>
            <Text className="text-[12px] font-medium text-ink-3" style={{ fontVariant: ['tabular-nums'] }}>
              {view.active.length} running
            </Text>
          </View>
        </View>
        {view.active.length === 0 ? (
          <View className="mx-4 rounded-[16px] border border-dashed border-line px-4 py-6">
            <Text className="text-center text-[12.5px] text-ink-3">No agents running.</Text>
          </View>
        ) : (
          view.active.map(({ session, task, runtime }) => (
            <ActiveCard
              key={session.id}
              session={session}
              task={task}
              runtime={runtime}
              providerName={providerNameFor(session.agent)}
              onOpen={() => openSession(session)}
            />
          ))
        )}

        {/* Projects */}
        <View className="mt-[26px] px-4 pb-[9px]">
          <View className="flex-row items-baseline gap-2">
            <Text className="text-[13px] font-semibold text-ink-2">Projects</Text>
            <Text className="text-[12px] font-medium text-ink-3" style={{ fontVariant: ['tabular-nums'] }}>
              {view.workspaces.length}
            </Text>
          </View>
        </View>

        {loading && sessions.length === 0 ? null : view.workspaces.length === 0 ? (
          <Empty
            title={sessions.length === 0 ? 'No workspaces yet' : 'No matches'}
            note={
              sessions.length === 0
                ? 'Launch an agent in a project folder on the desktop and it appears here.'
                : 'Try another filter or clear search.'
            }
            action={sessions.length === 0 ? <Btn kind="primary" label="New Session" onPress={() => shell.openNewTask()} /> : undefined}
          />
        ) : (
          view.workspaces.map((ws) => {
            const isCollapsed = !!collapsed[ws.id]
            return (
              <View key={ws.id} className="mx-4 mb-3 overflow-hidden rounded-[16px] bg-surface">
                <Pressable
                  accessibilityRole="button"
                  accessibilityState={{ expanded: !isCollapsed }}
                  onPress={() => {
                    void haptic('light')
                    setCollapsed((prev) => ({ ...prev, [ws.id]: !prev[ws.id] }))
                  }}
                  className="flex-row items-center gap-[11px] px-4 py-3"
                >
                  <View className="size-[30px] shrink-0 items-center justify-center rounded-lg bg-field">
                    <Folder size={15} color={color.ink2} />
                  </View>
                  <View className="min-w-0 flex-1">
                    <Text className="text-[15.5px] font-semibold text-ink" numberOfLines={1}>
                      {ws.name}
                    </Text>
                    <View className="mt-1 flex-row items-center gap-1.5">
                      {ws.counts.attention > 0 ? (
                        <View className="h-[19px] flex-row items-center gap-1 rounded-full bg-orange-tint px-2">
                          <View className="size-[5px] rounded-full bg-orange" />
                          <Text className="text-[10.5px] font-semibold text-orange">{ws.counts.attention} need you</Text>
                        </View>
                      ) : null}
                      {ws.counts.running > 0 ? (
                        <View className="h-[19px] flex-row items-center gap-1 rounded-full bg-green-tint px-2">
                          <View className="size-[5px] rounded-full bg-green" />
                          <Text className="text-[10.5px] font-semibold text-green">{ws.counts.running} running</Text>
                        </View>
                      ) : null}
                      {ws.counts.attention === 0 && ws.counts.running === 0 ? (
                        <Text className="text-[11px] text-ink-3" style={{ fontFamily: MONO }} numberOfLines={1}>
                          {ws.project ?? 'No folder — inbox'}
                        </Text>
                      ) : null}
                    </View>
                    {ws.counts.attention > 0 || ws.counts.running > 0 ? (
                      <Text className="mt-0.5 text-[11px] text-ink-3" style={{ fontFamily: MONO }} numberOfLines={1}>
                        {ws.project ?? 'No folder — inbox'}
                      </Text>
                    ) : null}
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`New session in ${ws.name}`}
                    onPress={() => shell.openNewTask(ws.project ?? undefined)}
                    hitSlop={6}
                    className="size-[27px] shrink-0 items-center justify-center rounded-full bg-field"
                  >
                    <Plus size={13} color={color.ink2} stroke={2.2} />
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Settings for ${ws.name}`}
                    onPress={() => {
                      void haptic('light')
                      setWorkspaceSettings(ws.project ?? null)
                    }}
                    hitSlop={6}
                    className="size-[27px] shrink-0 items-center justify-center rounded-full bg-field"
                  >
                    <Sliders size={13} color={color.ink2} stroke={2.2} />
                  </Pressable>
                  {isCollapsed ? <ChevronRight size={15} color={color.ink3} /> : <ChevronDown size={15} color={color.ink3} />}
                </Pressable>
                {!isCollapsed
                  ? ws.sessions.map(({ session, uiState }, index) => (
                      <React.Fragment key={session.id}>
                        {index > 0 ? <View className="ml-9 mr-4 h-px bg-line" /> : null}
                        <SessionLine
                          session={session}
                          uiState={uiState}
                          starred={starred.includes(session.id)}
                          onOpen={() => openSession(session)}
                          onStar={() => toggleStar(session.id)}
                          onLongPress={() => setPendingDelete(session)}
                        />
                      </React.Fragment>
                    ))
                  : null}
              </View>
            )
          })
        )}
      </ScrollView>

      {/* Deleting a session — held behind a long press so the row keeps its
          one-tap job (open), and behind a confirm because it cannot be undone
          from the phone. */}
      <Sheet
        open={pendingDelete !== null}
        onClose={() => (deleting ? undefined : setPendingDelete(null))}
        title="Delete session"
        glyph={<Trash size={19} color={color.red} />}
      >
        <View className="px-4 pb-2 pt-3">
          <Text className="text-body leading-[22px] text-ink">
            Delete “{pendingDelete?.name}”?
          </Text>
          <Text className="mt-2 text-meta leading-[19px] text-ink-2">
            The session and its transcript are removed from the desktop. This cannot be undone from the phone.
          </Text>
        </View>
        <View className="gap-3 px-4 pt-2">
          <Btn
            kind="danger"
            size="lg"
            wide
            label={deleting ? 'Deleting…' : 'Delete session'}
            disabled={deleting}
            onPress={() => {
              const target = pendingDelete
              if (!target) return
              setDeleting(true)
              void removeSession(target.id).finally(() => {
                setDeleting(false)
                setPendingDelete(null)
              })
            }}
          />
          <Btn kind="plate" size="lg" wide label="Keep it" onPress={() => setPendingDelete(null)} />
        </View>
      </Sheet>

      {/* Workspace settings — reached from the sliders on a project row. The
          same per-project memory flag the session's controls sheet shows, so
          the two can never disagree. */}
      <Sheet
        open={workspaceSettings !== undefined}
        onClose={() => setWorkspaceSettings(undefined)}
        title={workspaceSettings ? basename(workspaceSettings) : 'Workspace'}
        glyph={<Sliders size={19} color={color.ink2} />}
      >
        <WorkspaceSettings project={workspaceSettings ?? null} />
      </Sheet>
    </View>
  )
}

/** What a project can be configured for, from the place it is listed. */
function WorkspaceSettings({ project }: { project: string | null }) {
  if (!project) {
    return (
      <View className="mx-4 my-4 rounded-card border-[1.5px] border-dashed px-5 py-8" style={{ borderColor: color.edge }}>
        <Text className="text-center text-body font-semibold text-ink-2" weight={W_SEMI}>
          Inbox has no settings
        </Text>
        <Text className="mt-1.5 text-center text-meta leading-[19px] text-ink-3">
          Sessions without a project folder run in the daemon's working directory, so there is no project to
          configure.
        </Text>
      </View>
    )
  }
  return (
    <View className="pt-2">
      <Text className="mx-4 mb-1 text-cap font-semibold uppercase text-ink-3" style={{ letterSpacing: 0.5 }}>
        Folder
      </Text>
      <Text className="mx-4 mb-3 text-mono-small text-ink-2" style={{ fontFamily: MONO }}>
        {project}
      </Text>
      <MemorySection project={project} />
    </View>
  )
}

/** The newest open approval's raw prompt, for the triage Allow button. */
function latestApprovalPrompt(sessionId: string): string {
  const conversation = getConversation(sessionId)
  for (let i = conversation.messages.length - 1; i >= 0; i--) {
    const parts = conversation.messages[i].parts
    for (let j = parts.length - 1; j >= 0; j--) {
      const part = parts[j] as { kind: string; decision?: string; prompt?: string }
      if (part.kind === 'approval' && part.decision === undefined) return part.prompt ?? ''
    }
  }
  return ''
}

function ActiveCard({
  session,
  task,
  runtime,
  providerName,
  onOpen,
}: {
  session: Session
  task?: string
  runtime?: string
  providerName: string
  onOpen: () => void
}) {
  const conversation = useConversation(session.id)
  const activity = conversation.activity
  return (
    <Tap
      accessibilityRole="button"
      accessibilityLabel={`Open ${session.name}`}
      onPress={() => {
        void haptic('light')
        onOpen()
      }}
      className="mx-4 mb-2.5 flex-row items-center gap-3 rounded-[16px] bg-surface px-4 py-[13px]"
    >
      <View className="min-w-0 flex-1">
        <Text className="text-[15.5px] font-medium text-ink" numberOfLines={1}>
          {session.name}
        </Text>
        <Text className="mt-0.5 text-[13px] text-ink-2" numberOfLines={1}>
          {providerName} · {session.project ? basename(session.project) : 'no project'}
        </Text>
        {task ? (
          <Text className="mt-1 text-[11px] text-ink-3" style={{ fontFamily: MONO }} numberOfLines={1}>
            {task}
          </Text>
        ) : null}
      </View>
      <View className="shrink-0 items-end gap-1.5">
        <Loader label={activity?.label} />
        <Text className="text-[10.5px] text-ink-3" style={{ fontFamily: MONO, fontVariant: ['tabular-nums'] }} numberOfLines={1}>
          {activity?.detail ?? runtime ?? ''}
        </Text>
      </View>
    </Tap>
  )
}

function SessionLine({
  session,
  uiState,
  starred,
  onOpen,
  onStar,
  onLongPress,
}: {
  session: Session
  uiState: string
  starred: boolean
  onOpen: () => void
  onStar: () => void
  /** Long press opens the row's own actions — today, deleting it. */
  onLongPress?: () => void
}) {
  const display = uiStateDisplay(uiState as never)
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={session.name}
      onPress={() => {
        void haptic('light')
        onOpen()
      }}
      onLongPress={() => {
        void haptic('medium')
        onLongPress?.()
      }}
      delayLongPress={350}
      className="flex-row items-center gap-2.5 px-4 py-[11px]"
    >
      <View className="size-2 shrink-0 rounded-full" style={{ backgroundColor: agentHue(session.agent) }} />
      <View className="min-w-0 flex-1">
        <View className="flex-row items-center gap-2">
          <Text className="shrink text-[15px] text-ink" numberOfLines={1}>
            {session.name}
          </Text>
          <Pill label={display.label} tone={display.tone} pulse={display.pulse} className="h-5 px-2" />
        </View>
      </View>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={starred ? 'Unstar' : 'Star'}
        onPress={() => {
          void haptic('select')
          onStar()
        }}
        hitSlop={8}
        className="shrink-0 p-0.5"
      >
        <Star size={15} color={starred ? color.orange : color.ink4} fill={starred} />
      </Pressable>
      <ChevronRight size={14} color={color.ink3} stroke={2} />
    </Pressable>
  )
}

/* ── Loading skeleton ─────────────────────────────────────────────────────── */

function Block({ children, style }: { children?: React.ReactNode; style?: StyleProp<ViewStyle> }) {
  const breathe = React.useRef(new Animated.Value(1)).current
  React.useEffect(() => {
    const loop = Animated.loop(Animated.sequence([
      Animated.timing(breathe, { toValue: 0.55, duration: 800, useNativeDriver: true }),
      Animated.timing(breathe, { toValue: 1, duration: 800, useNativeDriver: true }),
    ]))
    loop.start()
    return () => loop.stop()
  }, [breathe])
  return (
    <Animated.View style={[{ opacity: breathe }, style]} className="mx-4 mb-2.5 rounded-[16px] bg-surface px-4 pb-3 pt-3.5">
      {children}
    </Animated.View>
  )
}

function Bar({ width }: { width: ViewStyle['width'] }) {
  return <View className="h-3 rounded-[6px] bg-field" style={{ width }} />
}

function Skeleton() {
  return (
    <View>
      <Block style={{ paddingTop: 16, paddingBottom: 20 }}>
        <View className="flex-row items-center gap-2.5">
          <Bar width={120} />
          <View className="h-6 w-[84px] rounded-full bg-field" />
        </View>
        <View style={{ marginTop: 12 }}>
          <Bar width="76%" />
        </View>
      </Block>
      <Block>
        <Bar width="55%" />
        <View style={{ marginTop: 10, opacity: 0.6 }}>
          <Bar width="35%" />
        </View>
      </Block>
      <Block style={{ paddingTop: 14, paddingBottom: 16 }}>
        <View className="flex-row items-center gap-2.5">
          <View className="size-9 rounded-[10px] bg-field" />
          <View className="flex-1">
            <Bar width="60%" />
            <View style={{ marginTop: 9, opacity: 0.6 }}>
              <Bar width="80%" />
            </View>
          </View>
        </View>
        <View style={{ marginTop: 22 }}>
          <Bar width="70%" />
        </View>
      </Block>
    </View>
  )
}
