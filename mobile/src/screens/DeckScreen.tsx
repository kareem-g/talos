/**
 * Deck — the home.
 *
 * EMBER CLAY REDESIGN — "the kiln board"
 * --------------------------------------
 * A phone-native cousin of the desktop StationHome, not a copy of it. The
 * desktop reads as a mission-control grid: a sticky control-deck header, a
 * triage timeline pinned left, workspaces grouped right, a filter tablist and
 * search riding above the workspace column. This page keeps that skeleton but
 * stacks it for one thumb:
 *
 *   1. Fleet hero   — the desktop's "fleet state is the hero" thesis as one
 *      kiln slab: a single large need-you number, live + workspace counts, and
 *      the connection truth. A statement, not a toolbar.
 *   2. Signal       — the desktop's triage timeline (vertical rule, state dots)
 *      compressed to phone width. Approvable in place.
 *   3. In motion    — the desktop's active grid as a horizontal rail of slabs.
 *      Ambient, glanceable, no actions.
 *   4. Ground       — the desktop's right column: filter tabs + search pinned
 *      above workspace slabs grouped by folder.
 *
 * Ranking, headlines and grouping still come from the shared `deriveHomeView`,
 * so a session surfaces here for exactly the reasons it does on the desktop.
 * Only the presentation is native.
 */

import * as React from 'react'
import { Pressable, ScrollView, Text, View } from 'react-native'
import {
  ChevronRight,
  Flame,
  Play,
  Search,
  SlidersHorizontal,
  Sparkles,
} from 'lucide-react-native'

import { deriveHomeView, type HomeFilter } from '@/lib/homeView'
import { firstOpenApprovalId } from '@/lib/sessionState'
import { getConversation, useStore } from '@app/store'
import { mobileApi } from '@app/lib/api'
import { deviceBaseUrl, deviceRoutes } from '@app/lib/native'
import { useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { useNewTask, useOpenSession, type RootStackParamList } from '@app/navigation'
import { agentColor, palette } from '@app/design/tokens'
import { ConfirmDialog, PickerSheet } from '@app/components/Sheet'
import {
  Badge,
  BrandMark,
  Button,
  Card,
  CardHeader,
  CopyButton,
  Dot,
  EmptyState,
  FilterChips,
  IconButton,
  Mono,
  SearchField,
  StatusPill,
  haptic,
  toast,
} from '@app/components/ui'
import { ScreenScaffold, Section } from '@app/components/Screen'
import {
  AllClear,
  SessionActionsSheet,
  SessionListSkeleton,
  SessionRow,
  WorkspaceGroup,
  stateTone,
} from '@app/components/session/SessionRow'
import { AutomationsSection, SkillsSection } from '@app/components/home/Sections'

const FILTERS: Array<{ value: HomeFilter; label: string }> = [
  { value: 'all', label: 'Everything' },
  { value: 'attention', label: 'Needs you' },
  { value: 'active', label: 'Live' },
  { value: 'starred', label: 'Starred' },
  { value: 'archived', label: 'Archived' },
]

export function DeckScreen() {
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

  const openSession = useOpenSession()
  const openNewTask = useNewTask()

  const [refreshing, setRefreshing] = React.useState(false)
  const [filterOpen, setFilterOpen] = React.useState(false)
  const [filter, setFilter] = React.useState<HomeFilter>('all')
  const [query, setQuery] = React.useState('')
  const [menuSession, setMenuSession] = React.useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = React.useState<string | null>(null)
  const [busyDelete, setBusyDelete] = React.useState(false)

  const providerNameFor = React.useCallback(
    (agentId: string) => agents.find((agent) => agent.id === agentId)?.name ?? agentId,
    [agents],
  )

  const view = React.useMemo(
    () =>
      deriveHomeView({
        sessions,
        connection,
        search: query,
        filter,
        starredSet: new Set(starred),
        getConversation,
        providerNameFor,
        notices,
        now: Date.now(),
        // `revisions` re-derives headlines and previews as conversations
        // stream; the value itself is never read.
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sessions, connection, query, filter, starred, notices, providerNameFor, revisions],
  )

  const live = connection === 'connected'
  const needsYou = view.counts.attention
  const filtering = filter !== 'all' || query.trim().length > 0

  const onRefresh = React.useCallback(async () => {
    setRefreshing(true)
    try {
      await loadSnapshot()
    } finally {
      setRefreshing(false)
    }
  }, [loadSnapshot])

  function approve(sessionId: string) {
    const requestId = firstOpenApprovalId(getConversation(sessionId))
    if (!requestId) {
      toast({ message: 'Nothing left to approve in that session.', tone: 'muted' })
      return
    }
    respondToApproval(sessionId, requestId, 'allow')
    toast({ message: 'Approved', tone: 'ok' })
  }

  async function toggleArchive(sessionId: string, archived: boolean) {
    try {
      if (archived) await mobileApi.restore(sessionId)
      else await mobileApi.archive(sessionId)
      toast({ message: archived ? 'Restored' : 'Archived', tone: 'ok' })
    } catch (cause) {
      toast({
        message: archived ? 'Could not restore that session' : 'Could not archive that session',
        detail: cause instanceof Error ? cause.message : undefined,
        tone: 'danger',
      })
    } finally {
      void loadSnapshot()
    }
  }

  async function doDelete(sessionId: string) {
    setBusyDelete(true)
    const name = sessions.find((session) => session.id === sessionId)?.name ?? 'Session'
    const ok = await removeSession(sessionId)
    setBusyDelete(false)
    setConfirmDelete(null)
    setMenuSession(null)
    toast(
      ok
        ? { message: `Deleted “${name}”` }
        : { message: `Could not delete “${name}”`, tone: 'danger' },
    )
  }

  return (
    <ScreenScaffold
      title={desktopName}
      eyebrow="Fleet board"
      onRefresh={() => void onRefresh()}
      refreshing={refreshing}
      contentClassName="gap-6 pb-12"
      headerLeft={
        <View style={{ paddingLeft: 8, justifyContent: 'center' }}>
          <BrandMark size={22} />
        </View>
      }
      headerRight={
        <View className="flex-row items-center gap-0.5">
          <IconButton
            label="Search sessions"
            size={38}
            onPress={() => {
              void haptic('light')
              setQuery('')
              setFilterOpen(true)
            }}
          >
            <Search size={19} color={palette.ink2} />
          </IconButton>
          <IconButton
            label={filtering ? 'Change the active filter' : 'Filter sessions'}
            size={38}
            active={filtering}
            onPress={() => {
              void haptic('light')
              setFilterOpen(true)
            }}
          >
            <SlidersHorizontal size={19} color={filtering ? palette.accent : palette.ink2} />
          </IconButton>
        </View>
      }
      below={
        /* The desktop's subtle filter bar, as a scrolling line: how many
           sessions, how many paused, and whether the system is live. It
           scrolls away with the title — the hero below takes over. */
        <View className="flex-row items-center gap-2">
          <Text className="text-[11.5px] leading-[15px] text-ink-3">
            {view.counts.total} sessions
            {view.counts.paused > 0 ? ` · ${view.counts.paused} paused` : ''}
          </Text>
          <View style={{ flex: 1 }} />
          <View className="flex-row items-center gap-1.5">
            <Dot tone={live ? 'ok' : 'danger'} pulse={!live} />
            <Text className="text-[11.5px] leading-[15px] text-ink-3">
              {live ? 'system live' : 'offline'}
            </Text>
          </View>
        </View>
      }
    >
      {/* ── 0. Fleet hero ───────────────────────────────────────────────
          The desktop's thesis ("the fleet's state is the hero") as one kiln
          slab: a single large need-you number, live + workspace counts beside
          it, and the connection truth. Tapping it filters to what needs you. */}
      <View className="px-4">
        <FleetHero
          needsYou={needsYou}
          running={view.counts.running}
          workspaces={view.workspaces.length}
          live={live}
          onPress={() => {
            void haptic('light')
            setFilter(needsYou > 0 ? 'attention' : 'active')
          }}
        />
      </View>

      {/* ── 1. Signal ───────────────────────────────────────────────────
          The desktop's triage timeline: a vertical rule with state dots, one
          row per blocked session. Approvable in place — the situations where
          a session waits on you are exactly when you are doing something else. */}
      {!filtering && needsYou > 0 ? (
        <Section eyebrow="Signal" title="Needs you" enterIndex={0}>
          <TriageTimeline
            entries={view.attention}
            onApprove={(id, uiState) => {
              if (uiState === 'approval') approve(id)
            }}
            onOpen={(id) => openSession(id)}
          />
        </Section>
      ) : null}

      {/* ── 2. In motion ────────────────────────────────────────────────
          The desktop's active grid as a horizontal rail: one slab per running
          agent, task + runtime + provider. Ambient — it moves itself to
          Signal when it needs you. */}
      {!filtering && view.active.length > 0 ? (
        <Section
          eyebrow={`${view.active.length} running`}
          title="In motion"
          enterIndex={needsYou > 0 ? 1 : 0}
        >
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 10, paddingHorizontal: 16 }}
            style={{ marginHorizontal: -16 }}
          >
            {view.active.map((entry) => (
              <LiveSlab
                key={entry.session.id}
                name={entry.task ?? entry.session.name}
                provider={providerNameFor(entry.session.agent)}
                runtime={entry.runtime}
                agentId={entry.session.agent}
                onOpen={() => openSession(entry.session.id)}
              />
            ))}
          </ScrollView>
        </Section>
      ) : null}

      {!filtering && needsYou === 0 && view.active.length === 0 ? (
        <View className="px-4">
          <AllClear count={0} />
        </View>
      ) : null}

      {/* ── 3. Ground ───────────────────────────────────────────────────
          The desktop's right column: the filter tablist and search ride above
          the workspace slabs, because they describe the list below them — not
          the page above. Workspaces stay grouped by folder. */}
      <Section
        eyebrow={filtering ? 'Filtered' : 'Ground'}
        title={
          filtering
            ? `${view.filtered.length} matching`
            : `${view.workspaces.length} ${view.workspaces.length === 1 ? 'workspace' : 'workspaces'}`
        }
        enterIndex={2}
        action={
          filtering ? (
            <Button
              size="sm"
              variant="secondary"
              label="Clear"
              accessibilityLabel="Clear filters and search"
              onPress={() => {
                setFilter('all')
                setQuery('')
              }}
            />
          ) : null
        }
      >
        <SearchField
          value={query}
          onChangeText={setQuery}
          placeholder="Search workspaces, sessions, agents…"
          accessibilityLabel="Search sessions"
        />
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="pr-4">
          <FilterChips
            label="Filter sessions"
            value={filter}
            onChange={(value) => {
              void haptic('light')
              setFilter(value as HomeFilter)
            }}
            options={[
              { value: 'all' as HomeFilter, label: 'Everything', count: view.counts.total },
              { value: 'attention' as HomeFilter, label: 'Needs you', count: view.counts.attention },
              { value: 'active' as HomeFilter, label: 'Live', count: view.counts.running },
              { value: 'starred' as HomeFilter, label: 'Starred', count: starred.length },
              { value: 'archived' as HomeFilter, label: 'Archived', count: view.counts.archived },
            ]}
          />
        </ScrollView>

        {sessionsLoading && sessions.length === 0 ? (
          <SessionListSkeleton />
        ) : view.workspaces.length === 0 ? (
          <Card>
            <EmptyState
              title={filtering ? 'Nothing matches' : 'No sessions yet'}
              body={
                filtering
                  ? 'Try a different search, or clear the filter to see everything.'
                  : 'Start an agent from here, or open one on your desktop and it will appear.'
              }
              icon={filtering ? <Search size={22} color={palette.ink3} /> : <Sparkles size={22} color={palette.ink3} />}
              action={
                filtering ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    label="Clear filters"
                    onPress={() => {
                      setFilter('all')
                      setQuery('')
                    }}
                  />
                ) : (
                  <Button
                    size="sm"
                    variant="primary"
                    label="New task"
                    accessibilityLabel="Start a new task"
                    onPress={() => openNewTask()}
                  />
                )
              }
            />
          </Card>
        ) : (
          <View className="gap-3">
            {view.workspaces.map((workspace) => (
              <WorkspaceGroup
                key={workspace.id}
                name={workspace.name}
                project={workspace.project}
                total={workspace.sessions.length}
                attention={workspace.counts.attention}
                running={workspace.counts.running}
                defaultOpen={workspace.counts.attention > 0 || view.workspaces.length <= 2}
                onNewTask={() => openNewTask(undefined, workspace.project ?? undefined)}
              >
                {workspace.sessions.map(({ session, uiState }, index) => (
                  <SessionRow
                    key={session.id}
                    session={session}
                    state={uiState}
                    providerName={providerNameFor(session.agent)}
                    hideWorkspace
                    starred={starred.includes(session.id)}
                    enterIndex={index}
                    onOpen={() => openSession(session.id)}
                    onToggleStar={() => {
                      void toggleStar(session.id)
                      toast({
                        message: starred.includes(session.id) ? 'Star removed' : 'Starred',
                        tone: 'muted',
                        haptic: 'light',
                      })
                    }}
                    onArchive={() => void toggleArchive(session.id, session.status === 'archived')}
                    onMore={() => setMenuSession(session.id)}
                  />
                ))}
              </WorkspaceGroup>
            ))}
          </View>
        )}
      </Section>

      {/* ── Below the fold: configuration, not triage ─────────────────── */}
      <Section eyebrow="Automations" title="Run on demand" enterIndex={3}>
        <AutomationsSection />
      </Section>

      <Section eyebrow="Prompt library" title="Skills" enterIndex={4}>
        <SkillsSection />
      </Section>

      <Section eyebrow="This device" title="Routes" enterIndex={5}>
        <ConnectionCard />
      </Section>

      <PickerSheet
        open={filterOpen}
        onClose={() => setFilterOpen(false)}
        title="Filter sessions"
        subtitle={`${sessions.length} total`}
        value={filter}
        onSelect={(value) => setFilter(value as HomeFilter)}
        options={FILTERS.map((entry) => ({
          value: entry.value,
          label: entry.label,
          count:
            entry.value === 'all'
              ? sessions.length
              : entry.value === 'attention'
                ? view.counts.attention
                : entry.value === 'active'
                  ? view.counts.running
                  : entry.value === 'starred'
                    ? starred.length
                    : view.counts.archived,
        }))}
        searchable
        emptyLabel="No sessions"
      />

      <SessionActionsSheet
        session={menuSession ? sessions.find((s) => s.id === menuSession) : undefined}
        providerName={menuSession ? providerNameFor(sessions.find((s) => s.id === menuSession)?.agent ?? '') : undefined}
        starred={menuSession ? starred.includes(menuSession) : false}
        onClose={() => setMenuSession(null)}
        onStar={() => {
          if (menuSession) toggleStar(menuSession)
        }}
        onResume={() => {
          if (!menuSession) return
          void resumeSession(menuSession).then((ok) => {
            if (ok) {
              setMenuSession(null)
              openSession(menuSession)
            } else {
              toast({ message: 'Could not resume that session', tone: 'danger' })
            }
          })
        }}
        onFork={() => {
          if (!menuSession) return
          void forkSession(menuSession).then((forked) => {
            if (forked) {
              setMenuSession(null)
              openSession(forked.id)
              toast({ message: 'Forked into a new session', tone: 'ok' })
            } else {
              toast({ message: 'Could not fork that session', tone: 'danger' })
            }
          })
        }}
        onArchive={() => {
          if (menuSession) void toggleArchive(menuSession, false)
          setMenuSession(null)
        }}
        onRestore={() => {
          if (menuSession) void toggleArchive(menuSession, true)
          setMenuSession(null)
        }}
        onDelete={() => {
          if (menuSession) setConfirmDelete(menuSession)
        }}
      />

      <ConfirmDialog
        open={confirmDelete !== null}
        busy={busyDelete}
        title="Delete this session?"
        body={`“${sessions.find((s) => s.id === confirmDelete)?.name ?? 'This session'}” and its full history will be removed from the desktop. This cannot be undone.`}
        confirmLabel="Delete forever"
        onClose={() => setConfirmDelete(null)}
        onConfirm={() => confirmDelete && void doDelete(confirmDelete)}
      />
    </ScreenScaffold>
  )
}

/* ── Fleet hero ────────────────────────────────────────────────────────────────
 * The desktop's "fleet state is the hero" as one kiln slab: a single large
 * need-you number on the left, live + workspace counts stacked right, the
 * ember edge underneath when something burns. Tapping filters to Signal. */

function FleetHero({
  needsYou,
  running,
  workspaces,
  live,
  onPress,
}: {
  needsYou: number
  running: number
  workspaces: number
  live: boolean
  onPress: () => void
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={needsYou > 0 ? `${needsYou} sessions need you` : 'Nothing needs you'}
      accessibilityHint="Filters the list to what needs you"
      onPress={onPress}
      className="overflow-hidden rounded-lg border border-line bg-surface active:bg-raised"
    >
      {/* Ember edge: heat when something burns, quiet hairline when clear. */}
      <View style={{ height: 3, backgroundColor: needsYou > 0 ? palette.wait : palette.line }} />
      <View className="flex-row items-center gap-4 px-4 py-4">
        <View
          className="size-11 items-center justify-center rounded-md"
          style={{ backgroundColor: needsYou > 0 ? palette.waitSoft : palette.okSoft }}
        >
          <Flame size={20} color={needsYou > 0 ? palette.wait : palette.ok} />
        </View>
        <View className="min-w-0 flex-1">
          <Text
            className="text-ink"
            style={{ fontSize: 34, lineHeight: 38, fontWeight: '800', letterSpacing: -0.8, fontVariant: ['tabular-nums'] }}
            numberOfLines={1}
          >
            {needsYou}
          </Text>
          <Text className="mt-0.5 text-[12.5px] leading-[17px] text-ink-2" numberOfLines={1}>
            {needsYou === 0 ? 'All clear — nothing waits on you' : needsYou === 1 ? 'session needs you' : 'sessions need you'}
          </Text>
        </View>
        <View className="shrink-0 items-end gap-1.5">
          {running > 0 ? (
            <Badge tone="accent" outline>
              {running} live
            </Badge>
          ) : null}
          <Text className="text-[11.5px] leading-[15px] text-ink-3" style={{ fontVariant: ['tabular-nums'] }}>
            {workspaces} {workspaces === 1 ? 'workspace' : 'workspaces'}
          </Text>
          <View className="flex-row items-center gap-1.5">
            <Dot tone={live ? 'ok' : 'danger'} pulse={!live} />
            <Text className="text-[11px] leading-[14px] text-ink-3">{live ? 'Live' : 'Offline'}</Text>
          </View>
        </View>
      </View>
    </Pressable>
  )
}

/* ── Triage timeline ───────────────────────────────────────────────────────────
 * The desktop's triage timeline, compressed: a vertical rule with state dots,
 * one row per blocked session. The dot + pill repeat the state in two
 * channels; the headline is the ask; Approve sits inline. */

function TriageTimeline({
  entries,
  onApprove,
  onOpen,
}: {
  entries: Array<{
    session: { id: string; name: string; agent: string }
    headline: string
    uiState: string
    idleFor?: string
    providerName?: string
  }>
  onApprove: (sessionId: string, uiState: string) => void
  onOpen: (sessionId: string) => void
}) {
  return (
    <Card className="overflow-hidden">
      <View style={{ position: 'relative' }}>
        {/* The rule the dots sit on. */}
        <View
          style={{
            position: 'absolute',
            left: 27,
            top: 18,
            bottom: 18,
            width: 1,
            backgroundColor: palette.lineStrong,
          }}
        />
        {entries.map((entry, index) => {
          const tone = stateTone(entry.uiState)
          return (
            <View key={entry.session.id}>
              {index > 0 ? <View className="h-px bg-line" style={{ marginLeft: 52 }} /> : null}
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`${entry.session.name}. ${entry.headline}`}
                accessibilityHint="Opens the session"
                onPress={() => {
                  void haptic('light')
                  onOpen(entry.session.id)
                }}
                className="flex-row gap-3 px-4 py-3.5 active:bg-raised"
              >
                <View style={{ width: 20, alignItems: 'center', paddingTop: 4 }}>
                  <Dot tone={tone} />
                </View>
                <View className="min-w-0 flex-1 gap-1">
                  <View className="flex-row items-center gap-2">
                    <Text className="min-w-0 flex-1 text-[15px] leading-[20px] font-semibold text-ink" numberOfLines={1}>
                      {entry.session.name}
                    </Text>
                    <StatusPill tone={tone} label={entry.uiState === 'approval' ? 'Approval' : entry.uiState === 'failed' ? 'Failed' : 'Needs you'} size="sm" />
                  </View>
                  <Text className="text-[12px] leading-[16px] text-ink-3" numberOfLines={1}>
                    {entry.providerName ?? entry.session.agent}
                    {entry.idleFor ? ` · waiting ${entry.idleFor}` : ''}
                  </Text>
                  {entry.headline ? (
                    <Text className="text-[13px] leading-[18px] text-ink-2" numberOfLines={2}>
                      {entry.headline}
                    </Text>
                  ) : null}
                  <View className="mt-1.5 flex-row items-center gap-2">
                    {entry.uiState === 'approval' ? (
                      <Button
                        variant="primary"
                        size="sm"
                        label="Approve"
                        accessibilityLabel={`Approve the pending request in ${entry.session.name}`}
                        onPress={() => {
                          void haptic('success')
                          onApprove(entry.session.id, entry.uiState)
                        }}
                      />
                    ) : null}
                    <View className="flex-row items-center gap-1">
                      <Text className="text-[12.5px] font-semibold text-ink-2">Open</Text>
                      <ChevronRight size={14} color={palette.ink3} />
                    </View>
                  </View>
                </View>
              </Pressable>
            </View>
          )
        })}
      </View>
    </Card>
  )
}

/* ── Live slab ─────────────────────────────────────────────────────────────────
 * One running agent as a kiln slab in the horizontal rail: agent dot + runtime
 * on top, task as the title, provider beneath. Tapping opens the session. */

function LiveSlab({
  name,
  provider,
  runtime,
  agentId,
  onOpen,
}: {
  name: string
  provider: string
  runtime: string
  agentId: string
  onOpen: () => void
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${name}, running, ${runtime}`}
      accessibilityHint="Opens the session"
      onPress={() => {
        void haptic('light')
        onOpen()
      }}
      className="rounded-lg border border-line bg-surface active:bg-raised"
      style={{ width: 240 }}
    >
      <View className="gap-2 p-3.5">
        <View className="flex-row items-center gap-2">
          <View
            className="size-2 rounded-full"
            style={{ backgroundColor: agentColor(agentId) }}
          />
          <Mono className="flex-1 text-[10.5px] uppercase text-ink-3" numberOfLines={1}>
            {provider}
          </Mono>
          <View className="flex-row items-center gap-1">
            <Play size={10} color={palette.ok} />
            <Mono className="text-[11px] text-ink-2" style={{ fontVariant: ['tabular-nums'] }}>
              {runtime}
            </Mono>
          </View>
        </View>
        <Text className="text-[14.5px] leading-[19px] font-medium text-ink" numberOfLines={2}>
          {name}
        </Text>
      </View>
      <View style={{ height: 2, backgroundColor: agentColor(agentId), opacity: 0.55 }} />
    </Pressable>
  )
}

/* ── Connection card ───────────────────────────────────────────────────────────
 * Which route the app is using, and what it can fall back to. Every route has
 * a copy button, because the first thing anyone does with a "cannot reach your
 * desktop" error is read the URL out loud. */

function ConnectionCard() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const connection = useStore((state) => state.connection)
  const routes = deviceRoutes()
  const active = deviceBaseUrl()

  if (routes.length === 0) {
    return (
      <Card>
        <EmptyState
          compact
          title="Not paired"
          body="Pair with your desktop to control your agents from here."
          action={
            <Button
              size="sm"
              variant="secondary"
              label="Open pairing"
              accessibilityLabel="Open the pairing screen"
              onPress={() => navigation.navigate('Pairing')}
            />
          }
        />
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader
        title="Reachable routes"
        right={
          <Badge tone={connection === 'connected' ? 'ok' : 'wait'} outline>
            {connection === 'connected' ? 'connected' : connection}
          </Badge>
        }
      />
      <View className="gap-0.5 p-1.5">
        {routes.map((route) => {
          const isActive = route === active
          return (
            <View
              key={route}
              className="min-h-13 flex-row items-center gap-2.5 rounded-md px-2.5 py-2.5"
              style={isActive ? { backgroundColor: palette.accentSoft } : undefined}
            >
              <Dot tone={isActive ? 'ok' : 'muted'} />
              <Mono className="min-w-0 flex-1 text-[12px] text-ink" numberOfLines={1}>
                {route}
              </Mono>
              {isActive ? <Badge tone="accent">Active</Badge> : null}
              <CopyButton value={route} label="Copy" accessibilityLabel={`Copy ${route}`} />
            </View>
          )
        })}
      </View>
    </Card>
  )
}
