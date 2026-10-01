/**
 * Home — the station, ported from the desktop's StationHome.
 *
 * QAI · WARM STUDIO
 * -----------------
 * The desktop home answers the fleet questions in one scroll, and so does
 * this screen, in the desktop's own order:
 *
 *   1. Triage — "needs you": every blocked session with its inline action
 *      (Allow / Retry / Resume), because the situations where a session waits
 *      on you are exactly when you are doing something else.
 *   2. Active — what is running right now, ambient and glanceable.
 *   3. Workspaces — the full session list grouped by project, with the
 *      desktop's filter tablist (all / active / attention / starred /
 *      archived) and search riding above it.
 *   4. Automations and Skills — the desktop's anchor sections.
 *   5. Device — the connection truth and the route to Configuration.
 *
 * Ranking, headlines and grouping come from the shared `deriveHomeView`, so a
 * session surfaces here for exactly the reasons it does on the desktop.
 */

import * as React from 'react'
import {Pressable, View} from 'react-native'
import { Text } from '@app/components/Text'
import { Plus, Search, Wifi } from 'lucide-react-native'

import { deriveHomeView, type HomeFilter } from '@/lib/homeView'
import { firstOpenApprovalId } from '@/lib/sessionState'
import { getConversation, useStore } from '@app/store'
import { mobileApi } from '@app/lib/api'
import { navigationRef, useOpenSession } from '@app/navigation'
import { openNewTask } from '@app/lib/newTask'
import { palette } from '@app/design/tokens'
import { ConfirmDialog } from '@app/components/Sheet'
import {
  Badge,
  Button,
  Card,
  Dot,
  EmptyState,
  FilterChips,
  Mono,
  SearchField,
  haptic,
  toast,
} from '@app/components/ui'
import { ScreenScaffold, Section } from '@app/components/Screen'
import { FleetBand } from '@app/components/home/FleetBand'
import { DrawerButton } from '@app/components/Drawer'
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

export function HomeScreen() {
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
  const resumeSession = useStore((state) => state.resumeSession)
  const forkSession = useStore((state) => state.forkSession)
  const resendLastUserPrompt = useStore((state) => state.resendLastUserPrompt)
  const toggleStar = useStore((state) => state.toggleStar)
  const removeSession = useStore((state) => state.removeSession)

  const pendingActions = useStore((state) => state.pendingActions)
  const loadPending = useStore((state) => state.loadPending)

  const openSession = useOpenSession()

  const [refreshing, setRefreshing] = React.useState(false)
  const [filter, setFilter] = React.useState<HomeFilter>('all')
  const [query, setQuery] = React.useState('')
  const [menuSession, setMenuSession] = React.useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = React.useState<string | null>(null)
  const [busyDelete, setBusyDelete] = React.useState(false)

  const providerNameFor = React.useCallback(
    (agentId: string) => agents.find((agent) => agent.id === agentId)?.name ?? agentId,
    [agents],
  )

  // The archived filter needs rows the default snapshot omits; widen it while
  // the filter is on, and restore the narrower snapshot when leaving.
  React.useEffect(() => {
    void loadSnapshot(filter === 'archived')
  }, [filter, loadSnapshot])

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
      await loadSnapshot(filter === 'archived')
    } finally {
      setRefreshing(false)
    }
  }, [filter, loadSnapshot])

  /**
   * Answer a pending request straight from the Deck.
   *
   * The request id comes from the session's own `/api/mobile/pending` row when
   * the pending sweep has one — that is the whole point of this screen, since
   * it means an approval can be resolved without opening the transcript. When
   * the sweep has not caught up we fall back to the loaded card, and to opening
   * the session if even that is missing, rather than toasting at the user about
   * something they cannot see.
   */
  React.useEffect(() => {
    // The Deck is where approvals are answered, so it owns the pending sweep.
    void loadPending()
  }, [loadPending])

  /**
   * The daemon's record of what a blocked session is waiting for, if the sweep
   * has one. Shaped for the card, which only needs the tool, the ask and the
   * risk — the options and selection mode stay in the transcript, where there
   * is room to render them properly.
   */
  const pendingFor = React.useCallback(
    (sessionId: string) => {
      const action = pendingActions.find((candidate) => candidate.session_id === sessionId)
      if (!action) return undefined
      return {
        id: action.id,
        kind: action.kind,
        toolName: action.tool_name,
        prompt: action.prompt,
        risk: action.risk_level,
      }
    },
    [pendingActions],
  )

  function respond(sessionId: string, decision: 'allow' | 'deny', requestId?: string) {
    const id = requestId ?? firstOpenApprovalId(getConversation(sessionId))
    if (!id) {
      openSession(sessionId)
      return
    }
    respondToApproval(sessionId, id, decision)
    toast(
      decision === 'allow'
        ? { message: 'Approved', tone: 'ok' }
        : { message: 'Denied', tone: 'info' },
    )
  }

  /** Retry a failed turn: bring the engine back, then re-send the last prompt. */
  function retry(sessionId: string) {
    void resumeSession(sessionId).then((ok) => {
      if (!ok) {
        toast({ message: 'Could not resume that session', tone: 'danger' })
        return
      }
      if (resendLastUserPrompt(sessionId)) toast({ message: 'Retrying the last prompt', tone: 'ok' })
    })
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
      void loadSnapshot(filter === 'archived')
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

  const menuRow = menuSession ? sessions.find((s) => s.id === menuSession) : undefined

  return (
    <ScreenScaffold
      title="Deck"
      eyebrow={`QAI · ${desktopName}`}
      onRefresh={() => void onRefresh()}
      refreshing={refreshing}
      contentClassName="gap-6 pb-12"
      headerLeft={<DrawerButton />}
      headerRight={
        <View className="mr-3">
          <Button
            size="sm"
            variant="primary"
            label="New"
            icon={<Plus size={14} color={palette.accentInk} strokeWidth={2.4} />}
            accessibilityLabel="Start a new task"
            onPress={() => {
              void haptic('medium')
              openNewTask()
            }}
          />
        </View>
      }
      below={
        <View className="flex-row items-center gap-2">
          <Mono className="text-[10.5px] text-ink-3" style={{ fontVariant: ['tabular-nums'] }}>
            {view.counts.total} sessions
            {view.counts.paused > 0 ? ` · ${view.counts.paused} paused` : ''}
          </Mono>
          <View style={{ flex: 1 }} />
          <View className="flex-row items-center gap-1.5">
            <Dot tone={live ? 'ok' : 'danger'} pulse={!live} />
            <Text className="text-[10.5px] leading-[14px] text-ink-3">
              {live ? 'link live' : 'link down'}
            </Text>
          </View>
        </View>
      }
    >
      {/* ── 0. The fleet, as one strip ──────────────────────────────── */}
      <View className="px-4">
        <FleetBand sessions={sessions} onOpen={openSession} />
      </View>

      {/* ── 1. Triage — needs you ───────────────────────────────────── */}
      <Section eyebrow="Triage" title={needsYou > 0 ? 'Needs you' : 'Queue clear'} enterIndex={0}>
        {needsYou === 0 ? (
          <AllClear count={view.counts.running} />
        ) : (
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
                pending={pendingFor(entry.session.id)}
                onApprove={
                  entry.uiState === 'approval'
                    ? () => respond(entry.session.id, 'allow', pendingFor(entry.session.id)?.id)
                    : undefined
                }
                onDeny={
                  entry.uiState === 'approval'
                    ? () => respond(entry.session.id, 'deny', pendingFor(entry.session.id)?.id)
                    : undefined
                }
                secondaryAction={
                  entry.uiState === 'failed'
                    ? { label: 'Retry', onPress: () => retry(entry.session.id) }
                    : entry.uiState === 'paused'
                      ? {
                          label: 'Resume',
                          onPress: () => {
                            void resumeSession(entry.session.id).then((ok) => {
                              toast(
                                ok
                                  ? { message: 'Resumed', tone: 'ok' }
                                  : { message: 'Could not resume that session', tone: 'danger' },
                              )
                            })
                          },
                        }
                      : undefined
                }
                onOpen={() => openSession(entry.session.id)}
              />
            ))}
          </View>
        )}
      </Section>

      {/* ── 2. Active — what is running ─────────────────────────────── */}
      {view.active.length > 0 ? (
        <Section eyebrow={`${view.active.length} live`} title="Active" enterIndex={1}>
          <Card>
            {view.active.map((entry, index) => (
              <LiveRow
                key={entry.session.id}
                session={entry.session}
                task={entry.task}
                runtime={entry.runtime}
                providerName={providerNameFor(entry.session.agent)}
                enterIndex={index}
                onOpen={() => openSession(entry.session.id)}
              />
            ))}
          </Card>
        </Section>
      ) : null}

      {/* ── 3. Workspaces — the desktop's filter tablist + search + groups ── */}
      <Section
        eyebrow={filtering ? 'Filtered' : 'Sessions'}
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
              variant="ghost"
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
          placeholder="Search sessions, agents, workspaces…"
          accessibilityLabel="Search sessions"
        />
        <FilterChips
          label="Filter sessions"
          value={filter}
          onChange={(value) => {
            void haptic('light')
            setFilter(value as HomeFilter)
          }}
          options={[
            { value: 'all' as HomeFilter, label: 'All', count: view.counts.total },
            { value: 'attention' as HomeFilter, label: 'Needs you', count: view.counts.attention, tone: 'wait' },
            { value: 'active' as HomeFilter, label: 'Active', count: view.counts.running, tone: 'ok' },
            { value: 'starred' as HomeFilter, label: 'Starred', count: starred.length },
            { value: 'archived' as HomeFilter, label: 'Archived', count: view.counts.archived },
          ]}
        />

        {sessionsLoading && sessions.length === 0 ? (
          <SessionListSkeleton count={5} />
        ) : view.workspaces.length === 0 ? (
          <Card>
            <EmptyState
              title={filtering ? 'Nothing matches' : 'No sessions yet'}
              body={
                filtering
                  ? 'Try a different search, or clear the filter to see everything.'
                  : 'Start an agent from here, or open one on your desktop and it will appear.'
              }
              icon={filtering ? <Search size={22} color={palette.ink3} /> : <Plus size={22} color={palette.ink3} />}
              action={
                filtering ? (
                  <Button
                    size="sm"
                    variant="ghost"
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
                total={workspace.counts.total}
                attention={workspace.counts.attention}
                running={workspace.counts.running}
                defaultOpen={workspace.counts.attention > 0 || view.workspaces.length <= 3}
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

      {/* ── 4. Automations + Skills — the desktop's anchor sections ─── */}
      <Section eyebrow="Automations" title="Run on demand" enterIndex={3}>
        <AutomationsSection />
      </Section>

      <Section eyebrow="Prompt library" title="Skills" enterIndex={4}>
        <SkillsSection />
      </Section>

      {/* ── 5. Device — the connection truth and the route to Config ── */}
      <Section eyebrow="This device" title="Connection" enterIndex={5}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open configuration"
          accessibilityHint="Routes, alerts, tunnels, daemon settings"
          onPress={() => {
            void haptic('light')
            if (navigationRef.isReady()) navigationRef.navigate('Main', { screen: 'Device' } as never)
          }}
          className="flex-row items-center gap-3 rounded-lg border border-line bg-surface px-4 py-3.5 active:bg-raised"
        >
          <View
            style={{
              width: 38,
              height: 38,
              borderRadius: 12,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: palette.accentSoft,
            }}
          >
            <Wifi size={17} color={palette.accent} strokeWidth={1.8} />
          </View>
          <View className="min-w-0 flex-1">
            <Text className="text-[13.5px] leading-[19px] font-semibold text-ink" numberOfLines={1}>
              {live ? `Connected to ${desktopName}` : connection}
            </Text>
            <Text className="mt-0.5 text-[11.5px] leading-[15px] text-ink-3" numberOfLines={1}>
              Routes, alerts, MCP, tunnels and daemon settings
            </Text>
          </View>
          <Badge tone={live ? 'ok' : 'danger'} outline mono>
            {live ? 'live' : 'down'}
          </Badge>
        </Pressable>
      </Section>

      <SessionActionsSheet
        session={menuRow}
        providerName={menuRow ? providerNameFor(menuRow.agent) : undefined}
        starred={menuSession ? starred.includes(menuSession) : false}
        onClose={() => setMenuSession(null)}
        onStar={() => {
          if (menuSession) toggleStar(menuSession)
        }}
        onResume={() => {
          if (!menuSession) return
          void resumeSession(menuSession).then((ok) => {
            if (ok) {
              const id = menuSession
              setMenuSession(null)
              openSession(id)
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
