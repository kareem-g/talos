/**
 * Deck — the command centre.
 *
 * QAI SIGNAL DECK
 * ---------------
 * A phone-native cousin of the desktop StationHome, not a copy of it. The
 * desktop reads as a mission-control grid: a sticky control-deck header, a
 * triage timeline pinned left, workspaces grouped right. This page keeps that
 * skeleton but stacks it for one thumb, and it answers four questions in
 * order, each one a section:
 *
 *   1. Fleet status — the hero readout: one large need-you number, live and
 *      workspace counts, and the connection truth. A statement, not a toolbar.
 *   2. Needs you    — the triage queue. Approvable, retryable and resumable
 *      IN PLACE, because the situations where a session waits on you are
 *      exactly when you are doing something else.
 *   3. Running      — the live rail: what is working right now, ambient and
 *      glanceable, no actions (a running agent moves itself to "Needs you"
 *      when it changes state).
 *   4. Quick launch + recent — the two verbs: start something new with a
 *      ready engine, or jump back into where you were.
 *
 * Browsing *everything* (search, filters, archive, workspace groups) lives in
 * the Sessions tab — the Deck is triage, not a list. Ranking, headlines and
 * grouping still come from the shared `deriveHomeView`, so a session surfaces
 * here for exactly the reasons it does on the desktop.
 */

import * as React from 'react'
import { Pressable, ScrollView, Text, View } from 'react-native'
import { ChevronRight, Search, Zap } from 'lucide-react-native'

import { deriveHomeView } from '@/lib/homeView'
import { firstOpenApprovalId } from '@/lib/sessionState'
import { getConversation, useStore } from '@app/store'
import { navigateToTab, useNewTask, useOpenSession } from '@app/navigation'
import { agentColor, palette } from '@app/design/tokens'
import {
  BrandMark,
  Button,
  Card,
  Dot,
  EmptyState,
  Mono,
  StatusPill,
  haptic,
  toast,
} from '@app/components/ui'
import { ScreenScaffold, Section } from '@app/components/Screen'
import {
  AllClear,
  AttentionCard,
  LiveRow,
  SessionListSkeleton,
  SessionRow,
} from '@app/components/session/SessionRow'

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
  const resumeSession = useStore((state) => state.resumeSession)
  const resendLastUserPrompt = useStore((state) => state.resendLastUserPrompt)

  const openSession = useOpenSession()
  const openNewTask = useNewTask()

  const [refreshing, setRefreshing] = React.useState(false)

  const providerNameFor = React.useCallback(
    (agentId: string) => agents.find((agent) => agent.id === agentId)?.name ?? agentId,
    [agents],
  )

  const view = React.useMemo(
    () =>
      deriveHomeView({
        sessions,
        connection,
        search: '',
        filter: 'all',
        starredSet: new Set(starred),
        getConversation,
        providerNameFor,
        notices,
        now: Date.now(),
        // `revisions` re-derives headlines and previews as conversations
        // stream; the value itself is never read.
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sessions, connection, starred, notices, providerNameFor, revisions],
  )

  const live = connection === 'connected'
  const needsYou = view.counts.attention

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
      // The status says blocked but no open card is loaded — the transcript
      // has the truth; open it rather than toasting at the user.
      openSession(sessionId)
      return
    }
    respondToApproval(sessionId, requestId, 'allow')
    toast({ message: 'Approved', tone: 'ok' })
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

  const readyAgents = React.useMemo(
    () => agents.filter((agent) => agent.available !== false).slice(0, 8),
    [agents],
  )

  const recent = React.useMemo(
    () =>
      view.filtered
        .filter(({ uiState }) => uiState !== 'archived')
        .slice(0, 5),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [view, revisions],
  )

  return (
    <ScreenScaffold
      title={desktopName}
      eyebrow="QAI · Command deck"
      onRefresh={() => void onRefresh()}
      refreshing={refreshing}
      contentClassName="gap-6 pb-12"
      headerLeft={
        <View style={{ paddingLeft: 10, justifyContent: 'center' }}>
          <BrandMark size={20} />
        </View>
      }
      headerRight={
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Search all sessions"
          onPress={() => {
            void haptic('light')
            navigateToTab('Sessions')
          }}
          className="mr-3 min-h-9 flex-row items-center gap-1.5 rounded-sm border border-line px-3 active:bg-raised"
        >
          <Search size={13} color={palette.ink3} />
          <Text className="text-[12px] text-ink-3">Search</Text>
        </Pressable>
      }
      below={
        /* The filter bar's quiet line: how many sessions, how many paused, and
           whether the system is live. It scrolls away with the title — the
           hero below takes over. */
        <View className="flex-row items-center gap-2">
          <Mono className="text-[11px] text-ink-3" style={{ fontVariant: ['tabular-nums'] }}>
            {view.counts.total} sessions
            {view.counts.paused > 0 ? ` · ${view.counts.paused} paused` : ''}
          </Mono>
          <View style={{ flex: 1 }} />
          <View className="flex-row items-center gap-1.5">
            <Dot tone={live ? 'ok' : 'danger'} pulse={!live} />
            <Text className="text-[11px] leading-[14px] text-ink-3">
              {live ? 'link live' : 'link down'}
            </Text>
          </View>
        </View>
      }
    >
      {/* ── 1. Fleet status ────────────────────────────────────────────
          The desktop's thesis ("the fleet's state is the hero") as one cut
          slab: a single large need-you number, live + workspace counts beside
          it, and the signal edge underneath when something burns. */}
      <View className="px-4">
        <FleetHero
          needsYou={needsYou}
          running={view.counts.running}
          workspaces={view.workspaces.length}
          live={live}
        />
      </View>

      {/* ── 2. Needs you ─────────────────────────────────────────────── */}
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
                onApprove={
                  entry.uiState === 'approval' ? () => approve(entry.session.id) : undefined
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

      {/* ── 3. Running ───────────────────────────────────────────────── */}
      {view.active.length > 0 ? (
        <Section
          eyebrow={`${view.active.length} live`}
          title="Running now"
          enterIndex={1}
        >
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

      {/* ── 4. Quick launch ────────────────────────────────────────────
          The desktop's quick-launch provider picker, as a thumb rail: one
          tap opens the new-task sheet with the engine already chosen. Only
          engines the daemon reports as available are offered — a chip for an
          uninstalled CLI is a button that lies. */}
      {readyAgents.length > 0 ? (
        <Section eyebrow="Quick launch" title="Start an engine" enterIndex={2}>
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 8, paddingRight: 16 }}
            style={{ marginHorizontal: -16, paddingHorizontal: 16 }}
          >
            {readyAgents.map((agent) => (
              <QuickLaunchChip
                key={agent.id}
                id={agent.id}
                name={agent.name}
                onPress={() => openNewTask(agent.id)}
              />
            ))}
          </ScrollView>
        </Section>
      ) : null}

      {/* ── 5. Recent ────────────────────────────────────────────────── */}
      <Section
        eyebrow="Recent"
        title="Jump back in"
        enterIndex={3}
        action={
          <Text
            accessibilityRole="button"
            accessibilityLabel="See all sessions"
            onPress={() => {
              void haptic('light')
              navigateToTab('Sessions')
            }}
            className="flex-row items-center gap-0.5 pb-1"
            style={{ color: palette.accent }}
          >
            <Text className="text-[12.5px] font-semibold text-accent">All sessions</Text>
            <ChevronRight size={14} color={palette.accent} />
          </Text>
        }
      >
        {sessionsLoading && sessions.length === 0 ? (
          <SessionListSkeleton count={4} />
        ) : recent.length === 0 ? (
          <Card>
            <EmptyState
              title="Nothing here yet"
              body="Start an agent from this phone, or open one on your desktop and it will appear."
              icon={<Zap size={22} color={palette.ink3} />}
              action={
                <Button
                  size="sm"
                  variant="primary"
                  label="New task"
                  accessibilityLabel="Start a new task"
                  onPress={() => openNewTask()}
                />
              }
            />
          </Card>
        ) : (
          <Card>
            {recent.map(({ session }, index) => (
              <SessionRow
                key={session.id}
                session={session}
                providerName={providerNameFor(session.agent)}
                starred={starred.includes(session.id)}
                enterIndex={index}
                onOpen={() => openSession(session.id)}
              />
            ))}
          </Card>
        )}
      </Section>

      {/* The link state, stated plainly — a dashboard that never says whether
          its numbers are live makes you trust the wrong thing. */}
      <View className="items-center px-4">
        <Mono className="text-[10px] text-ink-4">
          {live ? 'live from the daemon · pull to refresh' : 'showing last synced state'}
        </Mono>
      </View>
    </ScreenScaffold>
  )
}

/* ── Fleet hero ────────────────────────────────────────────────────────────────
 * The desktop's "fleet state is the hero" as one cut slab: a single large
 * need-you number on the left, live + workspace counts stacked right, the
 * signal edge underneath when something needs a human. */

function FleetHero({
  needsYou,
  running,
  workspaces,
  live,
}: {
  needsYou: number
  running: number
  workspaces: number
  live: boolean
}) {
  return (
    <View
      accessible
      accessibilityRole="text"
      accessibilityLabel={
        needsYou > 0
          ? `${needsYou} sessions need you. ${running} running across ${workspaces} workspaces.`
          : `Nothing needs you. ${running} running across ${workspaces} workspaces.`
      }
      className="overflow-hidden rounded-lg border border-line bg-surface"
    >
      {/* Signal edge: lit amber when a human is the bottleneck, a quiet
          hairline when the fleet is clear. */}
      <View style={{ height: 2, backgroundColor: needsYou > 0 ? palette.wait : palette.lineStrong }} />
      <View className="flex-row items-center gap-4 px-4 py-4">
        <View className="min-w-0 flex-1">
          <Text
            className={needsYou > 0 ? 'text-wait' : 'text-ink'}
            style={{ fontSize: 40, lineHeight: 44, fontWeight: '800', letterSpacing: -1, fontVariant: ['tabular-nums'] }}
            numberOfLines={1}
          >
            {needsYou}
          </Text>
          <Text className="mt-1 text-[12px] leading-[16px] text-ink-2" numberOfLines={1}>
            {needsYou === 0
              ? 'All clear — nothing waits on you'
              : needsYou === 1
                ? 'session needs you'
                : 'sessions need you'}
          </Text>
        </View>
        <View className="shrink-0 items-end gap-2">
          {running > 0 ? (
            <View className="flex-row items-center gap-1.5">
              <Dot tone="ok" pulse />
              <Text className="text-[12px] font-semibold text-ink-2" style={{ fontVariant: ['tabular-nums'] }}>
                {running} running
              </Text>
            </View>
          ) : null}
          <Text className="text-[11.5px] leading-[15px] text-ink-3" style={{ fontVariant: ['tabular-nums'] }}>
            {workspaces} {workspaces === 1 ? 'workspace' : 'workspaces'}
          </Text>
          <StatusPill tone={live ? 'ok' : 'danger'} label={live ? 'Link live' : 'Link down'} size="sm" />
        </View>
      </View>
    </View>
  )
}

/* ── Quick-launch chip ──────────────────────────────────────────────────────────
 * One ready engine, as a thumb target: agent-hue dot, name, and the promise
 * that a tap opens the new-task sheet with this engine preselected. */

function QuickLaunchChip({ id, name, onPress }: { id: string; name: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`Start a task with ${name}`}
      onPress={() => {
        void haptic('light')
        onPress()
      }}
      className="min-h-10 flex-row items-center gap-2 rounded-md border border-line bg-surface px-3.5 active:bg-raised"
    >
      <View style={{ width: 7, height: 7, borderRadius: 2, backgroundColor: agentColor(id) }} />
      <Text className="text-[13px] font-semibold text-ink">{name}</Text>
      <Zap size={12} color={palette.ink4} />
    </Pressable>
  )
}
