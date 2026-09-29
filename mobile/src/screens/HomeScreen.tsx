/**
 * Home — the Control Deck.
 *
 * Composition follows the desktop `StationHome` top to bottom: a control-deck
 * header (brand, eyebrow, attention pill, live count, quick launch, New), the
 * anchor strip that jumps between sections, then Sessions (triage → active →
 * workspace groups with filters and search), Phone, Automations and Skills.
 *
 * Ranking, headlines, counts and workspace grouping come from the desktop's own
 * `deriveHomeView`, so a session floats to the top here for the same reasons it
 * does there. Two native deviations: the anchor strip is pinned under the header
 * rather than sticky-in-flow, and touch targets are 44px rather than the
 * desktop's hover-sized 36px.
 */

import * as React from 'react'
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useNavigation } from '@react-navigation/native'
import type { DrawerNavigationProp } from '@react-navigation/drawer'
import {
  Archive,
  ArchiveRestore,
  ChevronRight,
  Copy,
  GitFork,
  Menu,
  MoreHorizontal,
  Play,
  Plus,
  Search,
  Star,
  Trash2,
  Zap,
} from 'lucide-react-native'

import { getConversation, useStore } from '@app/store'
import { deriveHomeView, type HomeFilter } from '@/lib/homeView'
import { firstOpenApprovalId } from '@/lib/sessionState'
import { basename, relativeTime } from '@/lib/format'
import type { Session } from '@/types/session'
import { useOpenSession, type DrawerParamList } from '@app/navigation'
import { mobileApi } from '@app/lib/api'
import { deviceBaseUrl, deviceRoutes } from '@app/lib/native'
import {
  Button,
  Card,
  CardHeader,
  Chip,
  Dot,
  Dots,
  EmptyState,
  GlassSurface,
  IconButton,
  Mono,
  Segmented,
  StatusPill,
  TextField,
} from '@app/components/ui'
import { NewTaskSheet } from '@app/components/NewTaskSheet'
import { CommandPalette } from '@app/components/CommandPalette'
import { FloatingAttentionPill } from '@app/components/FloatingAttentionPill'
import { AutomationsSection, SkillsSection } from '@app/components/home/Sections'

const FILTERS: Array<{ value: HomeFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'attention', label: 'Attention' },
  { value: 'starred', label: 'Starred' },
  { value: 'archived', label: 'Archived' },
]

/** The desktop's anchor strip, in the same order as its home sections. */
const ANCHORS = ['Sessions', 'Phone', 'Automations', 'Skills'] as const
type Anchor = (typeof ANCHORS)[number]

export function HomeScreen() {
  const navigation = useNavigation<DrawerNavigationProp<DrawerParamList>>()
  const scrollRef = React.useRef<ScrollView>(null)
  const offsets = React.useRef(new Map<Anchor, number>())

  const sessions = useStore((state) => state.sessions)
  const agents = useStore((state) => state.agents)
  const connection = useStore((state) => state.connection)
  const desktopName = useStore((state) => state.desktopName)
  const notices = useStore((state) => state.notices)
  const starred = useStore((state) => state.starred)
  const revisions = useStore((state) => state.revisions)
  const sessionsLoading = useStore((state) => state.sessionsLoading)
  const loadSnapshot = useStore((state) => state.loadSnapshot)
  const respondToApproval = useStore((state) => state.respondToApproval)
  const toggleStar = useStore((state) => state.toggleStar)

  const removeSession = useStore((state) => state.removeSession)
  const resumeSession = useStore((state) => state.resumeSession)
  const forkSession = useStore((state) => state.forkSession)

  const [filter, setFilter] = React.useState<HomeFilter>('all')
  const [search, setSearch] = React.useState('')
  const [refreshing, setRefreshing] = React.useState(false)
  const [newOpen, setNewOpen] = React.useState(false)
  const [quickOpen, setQuickOpen] = React.useState(false)
  const [quickAgent, setQuickAgent] = React.useState<string | undefined>()
  const [cmdOpen, setCmdOpen] = React.useState(false)
  const [menuSession, setMenuSession] = React.useState<string | null>(null)

  const providerNameFor = React.useCallback(
    (agentId: string) => agents.find((agent) => agent.id === agentId)?.name ?? agentId,
    [agents],
  )

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
        // `revisions` re-derives headlines and previews as conversations stream;
        // the value itself is not read.
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sessions, connection, search, filter, starred, notices, providerNameFor, revisions],
  )

  const readyAgents = agents.filter((agent) => agent.available)
  const live = connection === 'connected'

  async function onRefresh() {
    setRefreshing(true)
    await loadSnapshot()
    setRefreshing(false)
  }

  function approve(sessionId: string) {
    const requestId = firstOpenApprovalId(getConversation(sessionId))
    if (!requestId) return
    respondToApproval(sessionId, requestId, 'allow')
  }

  async function archive(sessionId: string, restore: boolean) {
    try {
      if (restore) await mobileApi.restore(sessionId)
      else await mobileApi.archive(sessionId)
    } finally {
      void loadSnapshot()
    }
  }

  const openSession = useOpenSession()
  const jumpTo = (anchor: Anchor) =>
    scrollRef.current?.scrollTo({ y: offsets.current.get(anchor) ?? 0, animated: true })

  return (
    <SafeAreaView className="flex-1 bg-canvas" edges={['top']}>
      {/* ── Control-deck header ─────────────────────────────────────────── */}
      <GlassSurface effect="regular" radius={0} className="border-b border-line">
        <View className="gap-2.5 px-3 pt-2 pb-3">
          <View className="flex-row items-center gap-2">
            <IconButton label="Menu" onPress={() => navigation.openDrawer()} className="size-10">
              <Menu size={18} color="#f5f5f7" />
            </IconButton>
            <View className="min-w-0 flex-1 pl-0.5">
              <Mono className="text-[9px] font-semibold uppercase tracking-[0.2em] text-ink-3">Control Deck</Mono>
              <Text className="text-[17px] font-bold tracking-tight text-ink" numberOfLines={1}>
                {desktopName}
              </Text>
            </View>
            <StatusPill
              tone={view.counts.attention > 0 ? 'red' : 'green'}
              label={view.counts.attention > 0 ? `${view.counts.attention} need you` : 'All clear'}
            />
          </View>

          <View className="flex-row flex-wrap items-center gap-2">
            <View className="flex-row items-center gap-1.5">
              <Dot tone={live ? 'green' : connection === 'offline' ? 'red' : 'orange'} pulse={!live} />
              <Text className="text-[11px] font-medium text-ink-3">{live ? 'System live' : connection}</Text>
            </View>
            <Chip tone={view.counts.running > 0 ? 'accent' : 'dim'} label={`${view.counts.running} live`} />
            <Chip label={`${view.counts.total} sessions`} />
            {view.counts.paused > 0 ? <Chip tone="orange" label={`${view.counts.paused} paused`} /> : null}
            <View className="flex-1" />
            <Pressable
              onPress={() => setQuickOpen(true)}
              className="min-h-9 flex-row items-center gap-1.5 rounded-control border border-line-strong bg-surface/80 px-3 active:bg-hover"
            >
              <Zap size={12} color="#ff9f0a" />
              <Text className="text-[12px] font-medium text-ink-2">Quick launch</Text>
              <Mono className="text-[10px] font-semibold">{readyAgents.length}</Mono>
            </Pressable>
            <Pressable
              onPress={() => {
                setQuickAgent(undefined)
                setNewOpen(true)
              }}
              accessibilityLabel="New task"
              className="min-h-9 flex-row items-center gap-1.5 rounded-control bg-accent px-3.5 active:bg-accent-hover"
            >
              <Plus size={14} color="#0a1628" />
              <Text className="text-[13px] font-bold text-accent-ink">New</Text>
            </Pressable>
          </View>
        </View>
      </GlassSurface>

      {/* ── Anchor strip ────────────────────────────────────────────────── */}
      <GlassSurface effect="clear" radius={0} className="border-b border-line">
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-2 px-3 py-2.5">
          {ANCHORS.map((anchor) => (
            <Pressable
              key={anchor}
              onPress={() => jumpTo(anchor)}
              className="min-h-8 flex-row items-center rounded-control border border-line bg-field/80 px-3 active:bg-hover"
            >
              <Text className="text-[11px] font-semibold tracking-wide text-ink-2">{anchor}</Text>
            </Pressable>
          ))}
        </ScrollView>
      </GlassSurface>

      <ScrollView
        ref={scrollRef}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#7e7e86" />}
        contentContainerClassName="gap-6 px-4 py-4 pb-14"
      >
        {/* ── Sessions ──────────────────────────────────────────────────── */}
        <View
          onLayout={(event) => offsets.current.set('Sessions', event.nativeEvent.layout.y)}
          className="gap-3"
        >
          {view.attention.length > 0 ? (
            <View className="gap-2">
              <Mono className="text-[10px] font-semibold uppercase tracking-[0.18em] text-red">
                Needs Attention
              </Mono>
              {view.attention.map((entry) => (
                <View key={entry.session.id} className="gap-2.5 rounded-card border border-red-border bg-red-tint/50 p-3.5">
                  <View className="flex-row items-center gap-2">
                    <Dot
                      tone={entry.uiState === 'failed' ? 'red' : entry.uiState === 'paused' ? 'dim' : 'orange'}
                    />
                    <Text className="min-w-0 flex-1 text-[14px] font-semibold text-ink" numberOfLines={1}>
                      {entry.session.name}
                    </Text>
                    {entry.idleFor ? <Mono className="text-[10px] font-medium">{entry.idleFor}</Mono> : null}
                  </View>
                  <Text className="text-[13px] leading-5 text-ink-2" numberOfLines={2}>
                    {entry.headline}
                  </Text>
                  <View className="flex-row items-center gap-2 pt-0.5">
                    {entry.uiState === 'approval' ? (
                      <Button
                        variant="primary"
                        label="Approve"
                        className="min-h-[40px] px-4"
                        onPress={() => approve(entry.session.id)}
                      />
                    ) : null}
                    <Button
                      variant="surface"
                      label="Open"
                      className="min-h-[40px] px-4"
                      onPress={() => openSession(entry.session.id)}
                    />
                  </View>
                </View>
              ))}
            </View>
          ) : null}

          {view.active.length > 0 ? (
            <View className="gap-2">
              <Mono className="text-[10px] font-semibold uppercase tracking-[0.18em] text-accent">
                Active · {view.active.length} running
              </Mono>
              {view.active.map((entry) => (
                <Pressable
                  key={entry.session.id}
                  onPress={() => openSession(entry.session.id)}
                  className="flex-row items-center gap-2.5 rounded-card border border-line bg-surface px-3.5 py-3 active:bg-hover"
                >
                  <Dot tone="accent" pulse />
                  <Text className="min-w-0 flex-1 text-[13px] font-medium text-ink" numberOfLines={1}>
                    {entry.task ?? entry.session.name}
                  </Text>
                  <Mono className="text-[10px] font-medium">{entry.runtime}</Mono>
                </Pressable>
              ))}
            </View>
          ) : null}

          <View className="gap-2.5">
            <View className="flex-row items-baseline justify-between">
              <Mono className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-3">
                Workspaces · {view.workspaces.length}
              </Mono>
              <Mono className="text-[10px] font-medium">{view.filtered.length} sessions</Mono>
            </View>
            <Segmented options={FILTERS} value={filter} onChange={setFilter} />
            <TextField
              value={search}
              onChangeText={setSearch}
              placeholder="Search sessions"
              autoCapitalize="none"
              autoCorrect={false}
              leading={<Search size={14} color="#7e7e86" />}
            />
          </View>

          {sessionsLoading && sessions.length === 0 ? (
            <View className="items-center py-10">
              <Dots label="Loading sessions…" />
            </View>
          ) : view.workspaces.length === 0 ? (
            <Card>
              <EmptyState
                title="No sessions here"
                body="Start an agent on your desktop, or tap New to launch one from here. Pull to refresh."
              />
            </Card>
          ) : (
            view.workspaces.map((workspace) => (
              <Card key={workspace.id}>
                <CardHeader
                  title={workspace.name}
                  right={
                    <View className="flex-row items-center gap-1.5">
                      {workspace.counts.attention > 0 ? (
                        <Chip tone="red" label={`${workspace.counts.attention} need you`} />
                      ) : null}
                      {workspace.counts.running > 0 ? (
                        <Chip tone="accent" label={`${workspace.counts.running} running`} />
                      ) : null}
                      <IconButton
                        label="New session here"
                        onPress={() => {
                          setQuickAgent(undefined)
                          setNewOpen(true)
                        }}
                        className="size-8"
                      >
                        <Plus size={15} color="#b0b0b6" />
                      </IconButton>
                    </View>
                  }
                />
                <View>
                  {workspace.sessions.map(({ session }) => (
                    <SessionRow
                      key={session.id}
                      session={session}
                      onPress={() => openSession(session.id)}
                      starred={starred.includes(session.id)}
                      onToggleStar={() => toggleStar(session.id)}
                      onArchive={() => void archive(session.id, session.status === 'archived')}
                      onMenu={() => setMenuSession(session.id)}
                    />
                  ))}
                </View>
              </Card>
            ))
          )}
        </View>

        {/* ── Phone ─────────────────────────────────────────────────────── */}
        <View onLayout={(event) => offsets.current.set('Phone', event.nativeEvent.layout.y)} className="gap-2">
          <SectionHeading eyebrow="Phone" title="Connection" />
          <PhoneCard />
        </View>

        {/* ── Automations ───────────────────────────────────────────────── */}
        <View
          onLayout={(event) => offsets.current.set('Automations', event.nativeEvent.layout.y)}
          className="gap-2"
        >
          <SectionHeading eyebrow="Automations" title="Scheduled and idle-time tasks" />
          <AutomationsSection />
        </View>

        {/* ── Skills ────────────────────────────────────────────────────── */}
        <View onLayout={(event) => offsets.current.set('Skills', event.nativeEvent.layout.y)} className="gap-2">
          <SectionHeading eyebrow="Prompt library" title="Skills" />
          <SkillsSection />
        </View>
      </ScrollView>

      <NewTaskSheet
        open={newOpen}
        initialAgent={quickAgent}
        onClose={() => setNewOpen(false)}
        onCreated={(session) => openSession(session.id)}
      />

      <QuickLaunch
        open={quickOpen}
        agents={readyAgents}
        onClose={() => setQuickOpen(false)}
        onPick={(agentId) => {
          setQuickOpen(false)
          setQuickAgent(agentId)
          setNewOpen(true)
        }}
      />

      <CommandPalette
        open={cmdOpen}
        onClose={() => setCmdOpen(false)}
        onNewTask={() => {
          setQuickAgent(undefined)
          setNewOpen(true)
        }}
      />

      <FloatingAttentionPill />

      {/* Session context menu */}
      {menuSession ? (
        <SessionContextMenu
          sessionId={menuSession}
          sessionName={sessions.find((s) => s.id === menuSession)?.name ?? 'Session'}
          sessionStatus={sessions.find((s) => s.id === menuSession)?.status ?? 'idle'}
          onClose={() => setMenuSession(null)}
          onDelete={async () => {
            await removeSession(menuSession)
            setMenuSession(null)
          }}
          onResume={async () => {
            await resumeSession(menuSession)
            setMenuSession(null)
          }}
          onFork={async () => {
            const forked = await forkSession(menuSession)
            if (forked) openSession(forked.id)
            setMenuSession(null)
          }}
          onArchive={() => {
            void archive(menuSession, false)
            setMenuSession(null)
          }}
          onRestore={() => {
            void archive(menuSession, true)
            setMenuSession(null)
          }}
        />
      ) : null}
    </SafeAreaView>
  )
}

/** iOS section heading: tight-tracked eyebrow over a bold title. */
function SectionHeading({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <View className="gap-1">
      <Mono className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-3">{eyebrow}</Mono>
      <Text className="text-[22px] font-bold tracking-tight text-ink" style={{ letterSpacing: -0.5 }}>{title}</Text>
    </View>
  )
}

/** A session row inside a workspace card. */
function SessionRow({
  session,
  onPress,
  starred,
  onToggleStar,
  onArchive,
  onMenu,
}: {
  session: Session
  onPress: () => void
  starred: boolean
  onToggleStar: () => void
  onArchive: () => void
  onMenu: () => void
}) {
  return (
    <Pressable
      onPress={onPress}
      className="min-h-[52px] flex-row items-center gap-2 border-b border-line px-3.5 py-3 active:bg-hover-2"
    >
      <View className="min-w-0 flex-1">
        <Text className="text-[14px] font-medium text-ink" numberOfLines={1}>
          {session.name}
        </Text>
        <Mono className="mt-1 text-[11px]" numberOfLines={1}>
          {session.agent}
          {session.project ? ` · ${basename(session.project)}` : ''} · {relativeTime(session.updated_at)}
        </Mono>
      </View>
      <IconButton label={starred ? 'Unstar' : 'Star'} onPress={onToggleStar} className="size-9">
        <Star size={15} color={starred ? '#db6d28' : '#7e7e86'} fill={starred ? '#db6d28' : 'transparent'} />
      </IconButton>
      <IconButton
        label={session.status === 'archived' ? 'Restore' : 'Archive'}
        onPress={onArchive}
        className="size-9"
      >
        {session.status === 'archived' ? (
          <ArchiveRestore size={15} color="#7e7e86" />
        ) : (
          <Archive size={15} color="#7e7e86" />
        )}
      </IconButton>
      <IconButton label="More actions" onPress={onMenu} className="size-9">
        <MoreHorizontal size={15} color="#7e7e86" />
      </IconButton>
      <ChevronRight size={16} color="#7e7e86" />
    </Pressable>
  )
}

/** How this device reaches the daemon, and the routes it can fall back to. */
function PhoneCard() {
  const connection = useStore((state) => state.connection)
  const routes = deviceRoutes()
  const active = deviceBaseUrl()
  return (
    <Card>
      <CardHeader
        title="Connection Routes"
        right={<Chip tone={connection === 'connected' ? 'green' : 'orange'} label={connection} />}
      />
      <View className="gap-2.5 p-4">
        <Text className="text-[13px] leading-5 text-ink-2">
          Best first. The app moves to the next route automatically when the active one stops responding.
        </Text>
        {routes.length === 0 ? (
          <Text className="text-[13px] text-ink-3">Not paired.</Text>
        ) : (
          routes.map((route, index) => (
            <View key={route} className="flex-row items-center gap-2.5 rounded-xl bg-field/60 px-3 py-2">
              <Dot tone={route === active ? 'green' : 'dim'} />
              <Mono className="min-w-0 flex-1 text-[11px] font-medium text-ink" numberOfLines={1}>
                {route}
              </Mono>
              {route === active ? (
                <Chip tone="accent" label="Active" />
              ) : (
                <Mono className="text-[10px] font-semibold text-ink-3">#{index + 1}</Mono>
              )}
            </View>
          ))
        )}
      </View>
    </Card>
  )
}

/** Session context menu — delete, resume, fork, archive/restore. */
function SessionContextMenu({
  sessionId,
  sessionName,
  sessionStatus,
  onClose,
  onDelete,
  onResume,
  onFork,
  onArchive,
  onRestore,
}: {
  sessionId: string
  sessionName: string
  sessionStatus: string
  onClose: () => void
  onDelete: () => void
  onResume: () => void
  onFork: () => void
  onArchive: () => void
  onRestore: () => void
}) {
  const [confirmDelete, setConfirmDelete] = React.useState(false)
  const isArchived = sessionStatus === 'archived'
  const canResume = sessionStatus === 'needs_resume' || sessionStatus === 'exited' || sessionStatus === 'idle'

  return (
    <View className="absolute inset-0 z-40 justify-end bg-black/70">
      <Pressable className="absolute inset-0" onPress={onClose} accessibilityLabel="Close" />
      <GlassSurface effect="regular" radius={24} className="border-t border-line-strong">
        <View className="p-4 pb-10">
          <View className="mb-4 flex-row items-center justify-between">
            <View className="min-w-0 flex-1">
              <Mono className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-3">Session Actions</Mono>
              <Text className="text-[16px] font-bold tracking-tight text-ink" numberOfLines={1}>
                {sessionName}
              </Text>
            </View>
            <Pressable onPress={onClose} className="size-9 items-center justify-center rounded-full active:bg-hover">
              <ChevronRight size={18} color="#86868e" style={{ transform: [{ rotate: '90deg' }] }} />
            </Pressable>
          </View>

          <View className="gap-1">
            {canResume ? (
              <Pressable
                onPress={onResume}
                className="min-h-12 flex-row items-center gap-3 rounded-xl px-3 active:bg-hover"
              >
                <Play size={16} color="#3fb950" />
                <View className="flex-1">
                  <Text className="text-[13px] font-medium text-ink">Resume session</Text>
                  <Text className="text-[11px] text-ink-3">Continue from where it left off</Text>
                </View>
              </Pressable>
            ) : null}

            <Pressable
              onPress={onFork}
              className="min-h-12 flex-row items-center gap-3 rounded-xl px-3 active:bg-hover"
            >
              <GitFork size={16} color="#5b8def" />
              <View className="flex-1">
                <Text className="text-[13px] font-medium text-ink">Fork session</Text>
                <Text className="text-[11px] text-ink-3">Create a copy with the same history</Text>
              </View>
            </Pressable>

            {isArchived ? (
              <Pressable
                onPress={onRestore}
                className="min-h-12 flex-row items-center gap-3 rounded-xl px-3 active:bg-hover"
              >
                <ArchiveRestore size={16} color="#db6d28" />
                <View className="flex-1">
                  <Text className="text-[13px] font-medium text-ink">Restore from archive</Text>
                </View>
              </Pressable>
            ) : (
              <Pressable
                onPress={onArchive}
                className="min-h-12 flex-row items-center gap-3 rounded-xl px-3 active:bg-hover"
              >
                <Archive size={16} color="#7e7e86" />
                <View className="flex-1">
                  <Text className="text-[13px] font-medium text-ink">Archive session</Text>
                </View>
              </Pressable>
            )}

            <View className="my-1 border-b border-line" />

            {!confirmDelete ? (
              <Pressable
                onPress={() => setConfirmDelete(true)}
                className="min-h-12 flex-row items-center gap-3 rounded-xl px-3 active:bg-red-tint"
              >
                <Trash2 size={16} color="#f85149" />
                <View className="flex-1">
                  <Text className="text-[13px] font-medium text-red">Delete session</Text>
                  <Text className="text-[11px] text-ink-3">Permanently remove this session</Text>
                </View>
              </Pressable>
            ) : (
              <View className="rounded-xl border border-red-border bg-red-tint p-3 gap-2">
                <Text className="text-[12.5px] text-ink">
                  Delete "{sessionName}"? This cannot be undone.
                </Text>
                <View className="flex-row gap-2">
                  <Button variant="danger" label="Delete forever" onPress={onDelete} />
                  <Button variant="ghost" label="Cancel" onPress={() => setConfirmDelete(false)} />
                </View>
              </View>
            )}
          </View>
        </View>
      </GlassSurface>
    </View>
  )
}

/**
 * Quick launch — the desktop's ready-provider popup. It does not start a session
 * on tap; it preselects the agent and opens the full new-task flow, so the
 * workspace, model and permissions are still configurable.
 */
function QuickLaunch({
  open,
  agents,
  onClose,
  onPick,
}: {
  open: boolean
  agents: Array<{ id: string; name: string }>
  onClose: () => void
  onPick: (agentId: string) => void
}) {
  if (!open) return null
  return (
    <View className="absolute inset-0 z-30 justify-end bg-black/70">
      <Pressable className="absolute inset-0" onPress={onClose} accessibilityLabel="Close" />
      <GlassSurface effect="regular" radius={24} className="border-t border-line-strong">
        <View className="p-4 pb-10">
          <View className="mb-3 flex-row items-center justify-between">
            <Mono className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-3">Quick Launch</Mono>
            <Text className="text-[12px] font-medium text-ink-3">{agents.length} ready</Text>
          </View>
          <View className="flex-row flex-wrap gap-2">
            {agents.map((agent) => (
              <Pressable
                key={agent.id}
                onPress={() => onPick(agent.id)}
                className="min-h-[44px] flex-row items-center gap-2 rounded-2xl border border-line bg-surface px-3.5 active:bg-hover"
              >
                <Zap size={14} color="#ff9f0a" />
                <Text className="text-[13px] font-medium text-ink">{agent.name}</Text>
              </Pressable>
            ))}
            {agents.length === 0 ? (
              <Text className="text-[13px] text-ink-3">No agent is ready on the desktop yet.</Text>
            ) : null}
          </View>
          <Text className="mt-3 text-[12px] leading-5 text-ink-3">
            Opens the new-task flow with that agent preselected.
          </Text>
        </View>
      </GlassSurface>
    </View>
  )
}
