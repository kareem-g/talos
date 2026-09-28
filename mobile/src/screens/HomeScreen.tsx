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
  Menu,
  Plus,
  Search,
  Star,
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

  const [filter, setFilter] = React.useState<HomeFilter>('all')
  const [search, setSearch] = React.useState('')
  const [refreshing, setRefreshing] = React.useState(false)
  const [newOpen, setNewOpen] = React.useState(false)
  const [quickOpen, setQuickOpen] = React.useState(false)
  const [quickAgent, setQuickAgent] = React.useState<string | undefined>()

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
      <GlassSurface radius={0} className="border-b border-line">
        <View className="gap-2 px-3 pt-1.5 pb-2.5">
          <View className="flex-row items-center gap-1">
            <IconButton label="Menu" onPress={() => navigation.openDrawer()} className="size-9">
              <Menu size={18} color="#f2f2f3" />
            </IconButton>
            <View className="min-w-0 flex-1 pl-1">
              <Mono className="text-[9.5px] uppercase tracking-[0.16em] text-ink-3">Control deck</Mono>
              <Text className="text-[15px] font-semibold text-ink" numberOfLines={1}>
                {desktopName}
              </Text>
            </View>
            <StatusPill
              tone={view.counts.attention > 0 ? 'red' : 'green'}
              label={view.counts.attention > 0 ? `${view.counts.attention} need you` : 'all clear'}
            />
          </View>

          <View className="flex-row flex-wrap items-center gap-1.5">
            <View className="flex-row items-center gap-1.5">
              <Dot tone={live ? 'green' : connection === 'offline' ? 'red' : 'orange'} pulse={!live} />
              <Text className="text-[10.5px] text-ink-3">{live ? 'system live' : connection}</Text>
            </View>
            <Chip tone={view.counts.running > 0 ? 'accent' : 'dim'} label={`${view.counts.running} live`} />
            <Chip label={`${view.counts.total} sessions`} />
            {view.counts.paused > 0 ? <Chip tone="orange" label={`${view.counts.paused} paused`} /> : null}
            <View className="flex-1" />
            <Pressable
              onPress={() => setQuickOpen(true)}
              className="min-h-8 flex-row items-center gap-1.5 rounded-control border border-line bg-surface px-2.5 active:bg-hover"
            >
              <Zap size={12} color="#db6d28" />
              <Text className="text-[11px] text-ink-2">Quick launch</Text>
              <Mono className="text-[10px]">{readyAgents.length}</Mono>
            </Pressable>
            <Pressable
              onPress={() => {
                setQuickAgent(undefined)
                setNewOpen(true)
              }}
              accessibilityLabel="New task"
              className="min-h-8 flex-row items-center gap-1 rounded-control bg-ink px-3 active:opacity-90"
            >
              <Plus size={13} color="#131315" />
              <Text className="text-[11.5px] font-semibold text-canvas">New</Text>
            </Pressable>
          </View>
        </View>
      </GlassSurface>

      {/* ── Anchor strip ────────────────────────────────────────────────── */}
      <View className="flex-row gap-1.5 border-b border-line bg-canvas px-3 py-2">
        {ANCHORS.map((anchor) => (
          <Pressable
            key={anchor}
            onPress={() => jumpTo(anchor)}
            className="min-h-7 flex-row items-center rounded-control border border-line bg-inset px-2.5 active:bg-hover"
          >
            <Mono className="text-[10px] uppercase tracking-[0.12em] text-ink-2">{anchor}</Mono>
          </Pressable>
        ))}
      </View>

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
            <View className="gap-1.5">
              <Mono className="text-[10.5px] uppercase tracking-[0.14em] text-ink-3">
                Triage · needs you
              </Mono>
              {view.attention.map((entry) => (
                <View key={entry.session.id} className="gap-2 rounded-xl border border-line bg-surface p-3">
                  <View className="flex-row items-center gap-2">
                    <Dot
                      tone={entry.uiState === 'failed' ? 'red' : entry.uiState === 'paused' ? 'dim' : 'orange'}
                    />
                    <Text className="min-w-0 flex-1 text-[13px] font-medium text-ink" numberOfLines={1}>
                      {entry.session.name}
                    </Text>
                    {entry.idleFor ? <Mono className="text-[10.5px]">{entry.idleFor}</Mono> : null}
                  </View>
                  <Text className="text-[12px] leading-5 text-ink-2" numberOfLines={2}>
                    {entry.headline}
                  </Text>
                  <View className="flex-row items-center gap-2">
                    {entry.uiState === 'approval' ? (
                      <Button
                        variant="primary"
                        label="Approve"
                        className="min-h-9 px-3"
                        onPress={() => approve(entry.session.id)}
                      />
                    ) : null}
                    <Button
                      variant="ghost"
                      label="Open"
                      className="min-h-9 px-3"
                      onPress={() => openSession(entry.session.id)}
                    />
                  </View>
                </View>
              ))}
            </View>
          ) : null}

          {view.active.length > 0 ? (
            <View className="gap-1.5">
              <Mono className="text-[10.5px] uppercase tracking-[0.14em] text-ink-3">
                Active · {view.active.length} running
              </Mono>
              {view.active.map((entry) => (
                <Pressable
                  key={entry.session.id}
                  onPress={() => openSession(entry.session.id)}
                  className="flex-row items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2.5 active:bg-hover"
                >
                  <Dot tone="accent" pulse />
                  <Text className="min-w-0 flex-1 text-[12.5px] text-ink" numberOfLines={1}>
                    {entry.task ?? entry.session.name}
                  </Text>
                  <Mono className="text-[10.5px]">{entry.runtime}</Mono>
                </Pressable>
              ))}
            </View>
          ) : null}

          <View className="gap-2">
            <View className="flex-row items-baseline justify-between">
              <Mono className="text-[10.5px] uppercase tracking-[0.14em] text-ink-3">
                Workspaces · {view.workspaces.length}
              </Mono>
              <Mono className="text-[10.5px]">{view.filtered.length} sessions</Mono>
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
    </SafeAreaView>
  )
}

/** Desktop `SectionHeading`: mono eyebrow over a large title. */
function SectionHeading({ eyebrow, title }: { eyebrow: string; title: string }) {
  return (
    <View className="gap-0.5">
      <Mono className="text-[10.5px] uppercase tracking-[0.16em] text-ink-3">{eyebrow}</Mono>
      <Text className="text-[20px] font-semibold tracking-tight text-ink">{title}</Text>
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
}: {
  session: Session
  onPress: () => void
  starred: boolean
  onToggleStar: () => void
  onArchive: () => void
}) {
  return (
    <Pressable
      onPress={onPress}
      className="min-h-14 flex-row items-center gap-1 border-b border-line px-3 py-2.5 active:bg-hover"
    >
      <View className="min-w-0 flex-1">
        <Text className="text-[13.5px] text-ink" numberOfLines={1}>
          {session.name}
        </Text>
        <Mono className="mt-0.5 text-[10.5px]" numberOfLines={1}>
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
        title="Routes"
        right={<Chip tone={connection === 'connected' ? 'green' : 'orange'} label={connection} />}
      />
      <View className="gap-2 p-3">
        <Text className="text-[11.5px] leading-5 text-ink-2">
          Best first. The app moves to the next route on its own when the active one stops answering —
          leaving home, or the tailnet dropping, does not need a rescan.
        </Text>
        {routes.length === 0 ? (
          <Text className="text-[12px] text-ink-3">Not paired.</Text>
        ) : (
          routes.map((route, index) => (
            <View key={route} className="flex-row items-center gap-2">
              <Dot tone={route === active ? 'green' : 'dim'} />
              <Mono className="min-w-0 flex-1 text-[11px] text-ink" numberOfLines={1}>
                {route}
              </Mono>
              {route === active ? (
                <Chip tone="accent" label="active" />
              ) : (
                <Mono className="text-[10px]">#{index + 1}</Mono>
              )}
            </View>
          ))
        )}
      </View>
    </Card>
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
    <View className="absolute inset-0 z-30 justify-end bg-black/65">
      <Pressable className="absolute inset-0" onPress={onClose} accessibilityLabel="Close" />
      <GlassSurface radius={20} className="border-t border-line">
        <View className="p-3 pb-8">
          <View className="mb-2 flex-row items-center justify-between">
            <Mono className="text-[10px] uppercase tracking-[0.14em] text-ink-3">Quick launch</Mono>
            <Text className="text-[11px] text-ink-3">{agents.length} ready</Text>
          </View>
          <View className="flex-row flex-wrap gap-1.5">
            {agents.map((agent) => (
              <Pressable
                key={agent.id}
                onPress={() => onPick(agent.id)}
                className="min-h-11 flex-row items-center gap-2 rounded-xl border border-line bg-surface px-3 active:bg-hover"
              >
                <Zap size={14} color="#db6d28" />
                <Text className="text-[12.5px] text-ink">{agent.name}</Text>
              </Pressable>
            ))}
            {agents.length === 0 ? (
              <Text className="text-[12px] text-ink-3">No agent is ready on the desktop yet.</Text>
            ) : null}
          </View>
          <Text className="mt-2 text-[11px] leading-4 text-ink-3">
            Opens the new-task flow with that agent preselected, so the workspace, model and
            permissions are still yours to set.
          </Text>
        </View>
      </GlassSurface>
    </View>
  )
}
