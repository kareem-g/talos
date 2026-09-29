/**
 * Deck — the control deck.
 *
 * THE INFORMATION HIERARCHY *IS* THE DESIGN
 * ------------------------------------------
 * This app is a remote control for a fleet of agents, and exactly one question
 * dominates: **is anything waiting on me?** Everything on this page is ordered
 * by that question, not by what the data happens to be grouped into.
 *
 *   1. Needs you   — a human is blocked. Approvable in place, from the list.
 *   2. Live        — working right now. Ambient, glanceable, no actions.
 *   3. Workspaces  — everything else, grouped by the folder it belongs to.
 *
 * Why that order and not the desktop's (filter bar, then a two-column grid of
 * triage-left / workspaces-right): on a phone there is no second column to put
 * triage beside, so a two-column layout either squeezes both into unreadable
 * halves or becomes a top/bottom stack — which is this. The desktop's left
 * column *is* the first thing you read; so is this.
 *
 * What this page deliberately does not have:
 *
 *   - **No search field above the fold.** It is one tap away in the app bar
 *     (⌘-equivalent), and a permanent 48pt field pushes the triage list — the
 *     reason the page exists — below the fold on a small phone.
 *   - **No filter chips inline.** The same reason. They live in the filter
 *     sheet, which the funnel button in the app bar opens. A control you have
 *     to scroll to is a control you cannot use.
 *   - **No "Quick launch" row of provider pills.** The desktop has one because
 *     its New-session dialog is three steps deep. The FAB opens a sheet that is
 *     *one* step, and adding a second way to start a task to the home page
 *     would be two entry points for one verb.
 *
 * The connection state is not part of this page. It is a strip above every
 * page, because "the desktop is unreachable" is a fact about the app rather
 * than about this screen, and a phone in a pocket is the thing you are least
 * likely to be looking at and most likely to be confused by.
 *
 * Ranking, headlines, and grouping all come from the shared `deriveHomeView`,
 * so a session floats to the top here for exactly the reasons it does on the
 * desktop. Only the presentation is native.
 */

import * as React from 'react'
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native'
import { Search, SlidersHorizontal, Sparkles } from 'lucide-react-native'

import { deriveHomeView, type HomeFilter } from '@/lib/homeView'
import { firstOpenApprovalId } from '@/lib/sessionState'
import { getConversation, useStore } from '@app/store'
import { mobileApi } from '@app/lib/api'
import { deviceBaseUrl, deviceRoutes } from '@app/lib/native'
import { useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { useNewTask, useOpenSession, type RootStackParamList } from '@app/navigation'
import { palette } from '@app/design/tokens'
import { ConfirmDialog, PickerSheet } from '@app/components/Sheet'
import {
  Badge,
  Button,
  Card,
  CopyButton,
  Dot,
  EmptyState,
  Eyebrow,
  FilterChips,
  Mono,
  StatusPill,
  haptic,
  toast,
} from '@app/components/ui'
import { Section } from '@app/components/Screen'
import {
  AllClear,
  AttentionCard,
  LiveRow,
  SessionActionsSheet,
  SessionListSkeleton,
  SessionRow,
  WorkspaceGroup,
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
    <View className="flex-1 bg-canvas">
      <DeckHeader
        desktopName={desktopName}
        needsYou={needsYou}
        running={view.counts.running}
        live={live}
        filtering={filtering}
        onSearch={() => {
          setQuery('')
          setFilterOpen(true)
        }}
        onFilter={() => setFilterOpen(true)}
      />

      <ScrollView
        contentContainerClassName="gap-6 pb-8"
        showsVerticalScrollIndicator={false}
        keyboardShouldPersistTaps="handled"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={onRefresh}
            tintColor={palette.ink3}
            colors={[palette.accent]}
            progressBackgroundColor={palette.surface}
          />
        }
      >
        {/* ── 1. Needs you ───────────────────────────────────────────────
            Highest priority, always first. Absent entirely when nothing needs
            attention *and* nothing is running — no empty section, no reserved
            space. When something is running but nothing is blocked, "All
            clear" is still shown: the difference between "nothing needs you"
            and "the app is disconnected" matters, and silence does not
            distinguish them. */}
        {!filtering && needsYou > 0 ? (
          <Section eyebrow="Triage" title="Needs you" enterIndex={0}>
            <View className="gap-2.5">
              {view.attention.map((entry, index) => (
                <AttentionCard
                  key={entry.session.id}
                  session={entry.session}
                  headline={entry.headline}
                  uiState={entry.uiState}
                  idleFor={entry.idleFor}
                  providerName={entry.providerName}
                  enterIndex={index}
                  onApprove={entry.uiState === 'approval' ? () => approve(entry.session.id) : undefined}
                  onOpen={() => openSession(entry.session.id)}
                />
              ))}
            </View>
          </Section>
        ) : null}

        {/* ── 2. Live ────────────────────────────────────────────────────
            Ambient. No actions: a running agent needs attention only when it
            *changes* state, and when it does it moves itself to "Needs you".
            A live halo is the whole affordance — enough to know something is
            in flight from across the room, not enough to nag. */}
        {!filtering && view.active.length > 0 ? (
          <Section eyebrow={`${view.active.length} running`} title="Live" enterIndex={needsYou > 0 ? 1 : 0}>
            <Card>
              {view.active.map((entry, index) => (
                <View key={entry.session.id}>
                  {index > 0 ? <View className="h-px bg-line" style={{ marginLeft: 16 }} /> : null}
                  <LiveRow
                    session={entry.session}
                    task={entry.task}
                    runtime={entry.runtime}
                    providerName={providerNameFor(entry.session.agent)}
                    onOpen={() => openSession(entry.session.id)}
                  />
                </View>
              ))}
            </Card>
          </Section>
        ) : null}

        {/* ── The all-clear state ─────────────────────────────────────────
            Shown when nothing is blocked *and* nothing is live, so the page is
            never just an empty list with no explanation. */}
        {!filtering && needsYou === 0 && view.active.length === 0 ? (
          <View className="px-4">
            <AllClear count={0} />
          </View>
        ) : null}

        {/* ── The filter row ──────────────────────────────────────────────
            Deliberately *here* and not above the fold. On a small phone a
            filter row pinned under the header pushes the triage list — the
            reason this page exists — below the fold. Down here it is one tap
            from the content it filters and out of the way of the question the
            page is answering, and it is reachable from the app bar's funnel
            too for anyone who wants it first. */}
        {view.filtered.length > 0 || filtering ? (
          <View className="px-4">
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
          </View>
        ) : null}

        {/* ── 4. Workspaces ──────────────────────────────────────────────
            Grouped by folder, because "which project is this?" is the
            question that makes a long session list navigable. Collapsed by
            default when a workspace is quiet, open when it has something
            waiting, so the list opens at the right altitude. */}
        <Section
          eyebrow={filtering ? 'Filtered' : 'Workspaces'}
          title={filtering ? `${view.filtered.length} matching` : `${view.workspaces.length} ${view.workspaces.length === 1 ? 'workspace' : 'workspaces'}`}
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
            <View className="gap-2.5">
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

        {/* ── Automations ────────────────────────────────────────────────
            Configuration, not triage, so it sits below the fold rather than
            competing with sessions for the eye. */}
        <Section eyebrow="Automations" title="Run on demand" enterIndex={3}>
          <AutomationsSection />
        </Section>

        {/* ── Skills ─────────────────────────────────────────────────────
            Shared with the desktop: the daemon owns `.agentdeck/skills/`, so
            toggling one here changes what the desktop injects into every
            turn. That makes this the one home-page section that is genuinely
            remote control rather than a local convenience. */}
        <Section eyebrow="Prompt library" title="Skills" enterIndex={4}>
          <SkillsSection />
        </Section>

        {/* ── This device ─────────────────────────────────────────────────
            Last, because it is rarely the thing you are looking for — but it
            is the answer to "why did my task fail with a network error", so
            it has to be on the page rather than three menus deep. */}
        <Section eyebrow="This device" title="Routes" enterIndex={5}>
          <ConnectionCard />
        </Section>
      </ScrollView>

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
    </View>
  )
}

/* ── Header ────────────────────────────────────────────────────────────────────
 * A custom bar rather than the shared `AppBar`, because this page needs three
 * things the generic one has no room for: the two counts that answer the page's
 * question, a search entry point, and a filter entry point that shows whether a
 * filter is active. */

function DeckHeader({
  desktopName,
  needsYou,
  running,
  live,
  filtering,
  onSearch,
  onFilter,
}: {
  desktopName: string
  needsYou: number
  running: number
  live: boolean
  filtering: boolean
  onSearch: () => void
  onFilter: () => void
}) {
  return (
    <View className="border-b border-line bg-chrome px-4 pb-3 pt-2">
      <View className="flex-row items-center gap-3">
        <View className="min-w-0 flex-1">
          <Eyebrow>Control deck</Eyebrow>
          <Text
            className="text-[22px] font-bold text-ink"
            style={{ letterSpacing: -0.35 }}
            numberOfLines={1}
          >
            {desktopName}
          </Text>
        </View>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Search sessions"
          onPress={onSearch}
          hitSlop={8}
          className="size-10 items-center justify-center rounded-pill active:bg-raised"
        >
          <Search size={19} color={palette.ink2} />
        </Pressable>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={filtering ? 'Change the active filter' : 'Filter sessions'}
          onPress={onFilter}
          hitSlop={8}
          className="size-10 items-center justify-center rounded-pill active:bg-raised"
          style={filtering ? { backgroundColor: palette.accentSoft } : undefined}
        >
          <SlidersHorizontal size={19} color={filtering ? palette.accent : palette.ink2} />
        </Pressable>
      </View>

      {/* The counts sit under the title, not in a bar: "3 need you" is a
          statement about the whole station, and it belongs next to the name
          of the station. */}
      <View className="mt-2.5 flex-row items-center gap-2">
        <StatusPill
          tone={needsYou > 0 ? 'wait' : 'ok'}
          label={needsYou > 0 ? `${needsYou} need you` : 'All clear'}
          size="sm"
        />
        {running > 0 ? (
          <Badge tone="accent" outline>
            {running} live
          </Badge>
        ) : null}
        <View style={{ flex: 1 }} />
        <View className="flex-row items-center gap-1.5">
          <Dot tone={live ? 'ok' : 'danger'} pulse={!live} />
          <Text className="text-[11.5px] text-ink-3">{live ? 'Live' : 'Offline'}</Text>
        </View>
      </View>
    </View>
  )
}

/* ── Connection card ──────────────────────────────────────────────────────────────
 * Which route the app is using, and what it can fall back to. Every route has a
 * copy button, because the first thing anyone does with a "cannot reach your
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
      <View className="flex-row items-center gap-2 border-b border-line px-4 py-3">
        <Text className="min-w-0 flex-1 text-[14.5px] font-semibold text-ink">Reachable routes</Text>
        <Badge tone={connection === 'connected' ? 'ok' : 'wait'} outline>
          {connection === 'connected' ? 'connected' : connection}
        </Badge>
      </View>
      <View>
        {routes.map((route) => {
          const isActive = route === active
          return (
            <View
              key={route}
              className="min-h-13 flex-row items-center gap-2.5 px-4 py-2.5"
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
