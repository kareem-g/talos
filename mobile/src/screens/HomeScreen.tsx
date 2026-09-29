/**
 * Home — where the user decides what to work on next.
 *
 * THE INFORMATION HIERARCHY IS THE DESIGN
 * ----------------------------------------
 * This app is a remote control for a fleet of agents, and exactly one question
 * dominates: *is anything waiting on me?* Everything on this screen is ordered
 * by that question, not by what the data happens to be grouped into.
 *
 *   1. Needs you     — a human is blocked. Approvable in place, from the list.
 *   2. Live          — working right now. Ambient, glanceable, no actions.
 *   3. Everything    — the rest, grouped by workspace.
 *
 * What changed from the previous version, and why:
 *
 * - **The attention list got its own screen position.** Previously it was
 *   rendered, then `Active`, then filters, then the workspace cards, all inside
 *   one long scroll — so the thing that needed action was above the fold only
 *   when nothing else was wrong. It is now the first thing under the header,
 *   and it collapses entirely when empty rather than reserving space.
 *
 * - **Filters moved out of the scroll body.** A filter row that scrolls away is
 *   a filter row you cannot use. Search and filter sit in a sticky sub-header.
 *
 * - **The anchor strip is gone.** It was a desktop affordance ("Sessions /
 *   Phone / Automations / Skills") that made sense for a sidebar and only added
 *   a row of buttons on a phone. The sections below the session list are
 *   reachable by scrolling, which is what a thumb expects.
 *
 * - **Counts moved into the header.** "3 need you" belongs next to the thing
 *   that needs you, not buried above a filter row.
 *
 * - **Approve is inline.** The single most common action on this screen — one
 *   tap, from the list, without opening a session — is now a button on the card.
 *
 * Ranking, headlines, and grouping still come from the shared `deriveHomeView`,
 * so a session floats to the top here for exactly the reasons it does on the
 * desktop. Only the presentation is native.
 */

import * as React from 'react'
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native'
import { useNavigation } from '@react-navigation/native'
import type { DrawerNavigationProp } from '@react-navigation/drawer'
import {
  AlertTriangle,
  Archive,
  ArchiveRestore,
  ChevronRight,
  GitFork,
  MoreHorizontal,
  Play,
  Plus,
  Search,
  Star,
  Trash2,
} from 'lucide-react-native'

import { deriveHomeView, type HomeFilter } from '@/lib/homeView'
import { firstOpenApprovalId } from '@/lib/sessionState'
import { relativeTime } from '@/lib/format'
import type { Session } from '@/types/session'
import { getConversation, useStore } from '@app/store'
import { useOpenSession, type DrawerParamList } from '@app/navigation'
import { mobileApi } from '@app/lib/api'
import { deviceBaseUrl, deviceRoutes } from '@app/lib/native'
import { agentColor, palette } from '@app/design/tokens'
import {
  Badge,
  Button,
  Card,
  CopyButton,
  Dot,
  EmptyState,
  ErrorState,
  Eyebrow,
  Field,
  IconButton,
  Loading,
  MenuButton,
  Mono,
  ScreenHeader,
  Segmented,
  StatusPill,
  haptic,
} from '@app/components/ui'
import { Sheet } from '@app/components/Sheet'
import { NewTaskSheet } from '@app/components/NewTaskSheet'
import { CommandPalette } from '@app/components/CommandPalette'
import { FloatingAttentionPill } from '@app/components/FloatingAttentionPill'
import { AutomationsSection, SkillsSection } from '@app/components/home/Sections'

const FILTERS: Array<{ value: HomeFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'active', label: 'Live' },
  { value: 'attention', label: 'Needs you' },
  { value: 'starred', label: 'Starred' },
  { value: 'archived', label: 'Archived' },
]

export function HomeScreen() {
  const navigation = useNavigation<DrawerNavigationProp<DrawerParamList>>()

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
  const [newAgent, setNewAgent] = React.useState<string | undefined>()
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
    if (!requestId) return
    void haptic('success')
    respondToApproval(sessionId, requestId, 'allow')
  }

  async function toggleArchive(sessionId: string, archived: boolean) {
    void haptic('light')
    try {
      if (archived) await mobileApi.restore(sessionId)
      else await mobileApi.archive(sessionId)
    } finally {
      void loadSnapshot()
    }
  }

  const openSession = useOpenSession()
  const openNewTask = (agent?: string) => {
    setNewAgent(agent)
    setNewOpen(true)
  }

  return (
    <View className="flex-1 bg-canvas">
      {/* ── Header ────────────────────────────────────────────────────────
          The counts live here, beside the name, because "3 need you" is a
          statement about the whole system, not about the list below it. */}
      <ScreenHeader
        title={desktopName}
        subtitle={live ? 'Connected' : connection === 'offline' ? 'Offline' : 'Connecting…'}
        left={<MenuButton onPress={() => navigation.openDrawer()} />}
        right={
          <View className="flex-row items-center gap-2">
            <IconButton label="Search sessions and actions" size={40} onPress={() => setCmdOpen(true)}>
              <Search size={19} color={palette.ink2} />
            </IconButton>
            <Button
              variant="primary"
              label="New"
              accessibilityLabel="Start a new task"
              compact
              icon={<Plus size={15} color={palette.accentInk} />}
              onPress={() => openNewTask()}
            />
          </View>
        }
      />

      {/* ── Sticky triage bar ─────────────────────────────────────────────
          Search and filter do not scroll away: filtering something you cannot
          see the controls for is the most common way a long list becomes
          unusable. */}
      <View className="gap-2.5 border-b border-line bg-chrome px-4 py-3">
        <View className="flex-row items-center gap-2">
          <StatusPill
            tone={needsYou > 0 ? 'wait' : 'ok'}
            label={needsYou > 0 ? `${needsYou} need you` : 'All clear'}
            pulse={needsYou > 0}
          />
          {view.counts.running > 0 ? (
            <Badge tone="accent" outline>
              {view.counts.running} live
            </Badge>
          ) : null}
          <View className="flex-1" />
          <View className="flex-row items-center gap-1.5">
            <Dot tone={live ? 'ok' : 'danger'} pulse={!live} />
            <Text className="text-[11px] text-ink-3">{live ? 'Live' : 'Offline'}</Text>
          </View>
        </View>
        <Field
          value={search}
          onChangeText={setSearch}
          placeholder="Search sessions"
          autoCapitalize="none"
          autoCorrect={false}
          returnKeyType="search"
          accessibilityLabel="Search sessions"
          leading={<Search size={16} color={palette.ink3} />}
        />
        <Segmented
          options={FILTERS}
          value={filter}
          onChange={setFilter}
          label="Filter sessions"
        />
      </View>

      <ScrollView
        className="flex-1"
        contentContainerClassName="gap-5 px-4 pb-8 pt-4"
        contentInsetAdjustmentBehavior="automatic"
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
            Highest priority, always first, and absent entirely when nothing
            needs attention — no empty section, no reserved space. */}
        {view.attention.length > 0 ? (
          <View className="gap-2.5">
            <Eyebrow className="text-wait">Needs you</Eyebrow>
            {view.attention.map((entry) => (
              <AttentionCard
                key={entry.session.id}
                session={entry.session}
                headline={entry.headline}
                uiState={entry.uiState}
                idleFor={entry.idleFor}
                onApprove={entry.uiState === 'approval' ? () => approve(entry.session.id) : undefined}
                onOpen={() => openSession(entry.session.id)}
              />
            ))}
          </View>
        ) : null}

        {/* ── 2. Live ────────────────────────────────────────────────────
            Ambient. No actions — these need attention only when they change
            state, and then they move themselves to "Needs you". */}
        {view.active.length > 0 ? (
          <View className="gap-2.5">
            <Eyebrow className="text-accent">Live · {view.active.length}</Eyebrow>
            <Card>
              {view.active.map((entry, index) => (
                <Pressable
                  key={entry.session.id}
                  accessibilityRole="button"
                  accessibilityLabel={`${entry.task ?? entry.session.name}, ${entry.runtime}`}
                  accessibilityHint="Opens the session"
                  onPress={() => {
                    void haptic('light')
                    openSession(entry.session.id)
                  }}
                  className={[
                    'min-h-14 flex-row items-center gap-3 px-4 py-3 active:bg-pressed',
                    index > 0 && 'border-t border-line',
                  ].join(' ')}
                >
                  <View className="size-2 rounded-full" style={{ backgroundColor: agentColor(entry.session.agent) }} />
                  <View className="min-w-0 flex-1">
                    <Text className="text-[14px] font-medium text-ink" numberOfLines={1}>
                      {entry.task ?? entry.session.name}
                    </Text>
                    <Text className="mt-0.5 text-[11px] text-ink-3" numberOfLines={1}>
                      {entry.session.agent}
                    </Text>
                  </View>
                  <Mono className="shrink-0 text-[11px]">{entry.runtime}</Mono>
                  <ChevronRight size={16} color={palette.ink3} />
                </Pressable>
              ))}
            </Card>
          </View>
        ) : null}

        {/* ── 3. Everything else ─────────────────────────────────────────
            Grouped by workspace, because "which project is this?" is the
            question that makes a long session list navigable. */}
        <View className="gap-2.5">
          <View className="flex-row items-baseline justify-between">
            <Eyebrow>Workspaces · {view.workspaces.length}</Eyebrow>
            <Mono className="text-[10px]">{view.filtered.length} shown</Mono>
          </View>

          {sessionsLoading && sessions.length === 0 ? (
            <Loading label="Loading sessions…" />
          ) : view.workspaces.length === 0 ? (
            <Card>
              <EmptyState
                title={search || filter !== 'all' ? 'Nothing matches' : 'No sessions yet'}
                body={
                  search || filter !== 'all'
                    ? 'Try a different search or filter.'
                    : 'Start an agent from here, or open one on your desktop.'
                }
                action={
                  search || filter !== 'all' ? (
                    <Button
                      variant="secondary"
                      label="Clear filters"
                      accessibilityLabel="Clear search and filter"
                      compact
                      onPress={() => {
                        setSearch('')
                        setFilter('all')
                      }}
                    />
                  ) : (
                    <Button
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
            view.workspaces.map((workspace) => (
              <Card key={workspace.id}>
                <View className="flex-row items-center gap-2 border-b border-line px-4 py-3">
                  <Text className="min-w-0 flex-1 text-[15px] font-semibold text-ink" numberOfLines={1}>
                    {workspace.name}
                  </Text>
                  {workspace.counts.attention > 0 ? (
                    <Badge tone="wait">{workspace.counts.attention} need you</Badge>
                  ) : null}
                  {workspace.counts.running > 0 ? (
                    <Badge tone="accent" outline>
                      {workspace.counts.running} live
                    </Badge>
                  ) : null}
                  <IconButton
                    label={`New task in ${workspace.name}`}
                    size={36}
                    onPress={() => openNewTask()}
                  >
                    <Plus size={17} color={palette.ink2} />
                  </IconButton>
                </View>
                {workspace.sessions.map(({ session }) => (
                  <SessionRow
                    key={session.id}
                    session={session}
                    starred={starred.includes(session.id)}
                    onOpen={() => openSession(session.id)}
                    onToggleStar={() => {
                      void haptic('light')
                      toggleStar(session.id)
                    }}
                    onArchive={() => void toggleArchive(session.id, session.status === 'archived')}
                    onMenu={() => setMenuSession(session.id)}
                  />
                ))}
              </Card>
            ))
          )}
        </View>

        {/* ── Secondary sections ───────────────────────────────────────────
            Automations and skills are configuration, not triage, so they sit
            below the fold rather than competing with sessions for attention. */}
        <View className="gap-2.5">
          <Eyebrow>Automations</Eyebrow>
          <AutomationsSection />
        </View>
        <View className="gap-2.5">
          <Eyebrow>Prompt library</Eyebrow>
          <SkillsSection />
        </View>

        {/* ── This device ─────────────────────────────────────────────────
            Pairing state and the routes the app can reach the daemon on.
            Last, because it is rarely the thing you are looking for. */}
        <View className="gap-2.5">
          <Eyebrow>This device</Eyebrow>
          <ConnectionCard />
        </View>
      </ScrollView>

      <NewTaskSheet
        open={newOpen}
        initialAgent={newAgent}
        onClose={() => setNewOpen(false)}
        onCreated={(session) => openSession(session.id)}
      />

      <CommandPalette
        open={cmdOpen}
        onClose={() => setCmdOpen(false)}
        onNewTask={() => openNewTask()}
      />

      <FloatingAttentionPill />

      {menuSession ? (
        <SessionActionSheet
          session={sessions.find((s) => s.id === menuSession)}
          onClose={() => setMenuSession(null)}
          onDelete={async () => {
            setMenuSession(null)
            await removeSession(menuSession)
          }}
          onResume={async () => {
            setMenuSession(null)
            const forked = await resumeSession(menuSession)
            if (forked) openSession(menuSession)
          }}
          onFork={async () => {
            setMenuSession(null)
            const forked = await forkSession(menuSession)
            if (forked) openSession(forked.id)
          }}
          onArchive={() => {
            void toggleArchive(menuSession, false)
            setMenuSession(null)
          }}
          onRestore={() => {
            void toggleArchive(menuSession, true)
            setMenuSession(null)
          }}
        />
      ) : null}
    </View>
  )
}

/* ── Attention card ──────────────────────────────────────────────────────────
 * The most important component on the screen. It has to communicate four things
 * without the user reading carefully: that a human is blocking, what is being
 * asked, how long it has waited, and what to do about it. */

const ATTENTION_TONE = {
  approval: 'wait',
  input: 'wait',
  paused: 'info',
  failed: 'danger',
} as const

function AttentionCard({
  session,
  headline,
  uiState,
  idleFor,
  onApprove,
  onOpen,
}: {
  session: Session
  headline: string
  uiState: string
  idleFor?: string
  onApprove?: () => void
  onOpen: () => void
}) {
  const tone = ATTENTION_TONE[uiState as keyof typeof ATTENTION_TONE] ?? 'wait'
  return (
    <View
      accessible={false}
      className="gap-3 rounded-lg border border-wait-border bg-wait-soft p-4"
    >
      <View className="flex-row items-start gap-2.5">
        <View className="mt-1.5">
          <Dot tone={tone} pulse={tone === 'wait'} />
        </View>
        <View className="min-w-0 flex-1">
          <Text className="text-[15px] font-semibold text-ink" numberOfLines={1}>
            {session.name}
          </Text>
          <Text className="mt-0.5 text-[11px] text-ink-3" numberOfLines={1}>
            {session.agent}
            {idleFor ? ` · waiting ${idleFor}` : ''}
          </Text>
        </View>
      </View>

      <Text className="text-[13px] leading-[18px] text-ink-2" numberOfLines={3}>
        {headline}
      </Text>

      <View className="flex-row gap-2">
        {onApprove ? (
          <Button
            variant="primary"
            label="Approve"
            accessibilityLabel={`Approve the pending request in ${session.name}`}
            compact
            onPress={onApprove}
          />
        ) : null}
        <Button
          variant="secondary"
          label="Open"
          accessibilityLabel={`Open ${session.name}`}
          compact
          onPress={onOpen}
        />
      </View>
    </View>
  )
}

/* ── Session row ───────────────────────────────────────────────────────────────
 * Three actions inline (star, archive, more) plus the row itself. The row is the
 * tap target; the icons are separate 44pt targets via hitSlop, so they never
 * steal a tap meant for the row. */

function SessionRow({
  session,
  starred,
  onOpen,
  onToggleStar,
  onArchive,
  onMenu,
}: {
  session: Session
  starred: boolean
  onOpen: () => void
  onToggleStar: () => void
  onArchive: () => void
  onMenu: () => void
}) {
  const archived = session.status === 'archived'
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={session.name}
      accessibilityHint={`${session.agent}, updated ${relativeTime(session.updated_at)}. Opens the session.`}
      onPress={() => {
        void haptic('light')
        onOpen()
      }}
      className="min-h-14 flex-row items-center gap-2 border-b border-line px-4 py-2.5 active:bg-pressed"
    >
      <View
        className="size-2 shrink-0 rounded-full"
        style={{ backgroundColor: archived ? palette.ink3 : agentColor(session.agent) }}
        accessibilityElementsHidden
      />
      <View className="min-w-0 flex-1">
        <Text className="text-[14px] font-medium text-ink" numberOfLines={1}>
          {session.name}
        </Text>
        <Text className="mt-0.5 text-[11px] text-ink-3" numberOfLines={1}>
          {session.agent} · {relativeTime(session.updated_at)}
        </Text>
      </View>

      <IconButton
        label={starred ? `Unstar ${session.name}` : `Star ${session.name}`}
        size={36}
        onPress={onToggleStar}
      >
        <Star
          size={16}
          color={starred ? palette.wait : palette.ink3}
          fill={starred ? palette.wait : 'transparent'}
        />
      </IconButton>
      <IconButton
        label={archived ? `Restore ${session.name}` : `Archive ${session.name}`}
        size={36}
        onPress={onArchive}
      >
        {archived ? (
          <ArchiveRestore size={16} color={palette.ink3} />
        ) : (
          <Archive size={16} color={palette.ink3} />
        )}
      </IconButton>
      <IconButton label={`More actions for ${session.name}`} size={36} onPress={onMenu}>
        <MoreHorizontal size={16} color={palette.ink3} />
      </IconButton>
    </Pressable>
  )
}

/* ── Connection card ──────────────────────────────────────────────────────────
 * Which route the app is using, and what it can fall back to. Shown with a copy
 * button per route, because the first thing anyone does with a "cannot reach
 * your desktop" error is read the URL out loud. */

function ConnectionCard() {
  const connection = useStore((state) => state.connection)
  const routes = deviceRoutes()
  const active = deviceBaseUrl()

  if (routes.length === 0) {
    return (
      <Card>
        <EmptyState
          title="Not paired"
          body="Pair with your desktop to control your agents from here."
          icon={<AlertTriangle size={28} color={palette.ink3} />}
        />
      </Card>
    )
  }

  return (
    <Card>
      <View className="flex-row items-center gap-2 border-b border-line px-4 py-3">
        <Text className="min-w-0 flex-1 text-[15px] font-semibold text-ink">Routes</Text>
        <Badge tone={connection === 'connected' ? 'ok' : 'wait'} outline>
          {connection}
        </Badge>
      </View>
      <View className="gap-1">
        {routes.map((route) => {
          const isActive = route === active
          return (
            <View
              key={route}
              className={[
                'min-h-12 flex-row items-center gap-2.5 px-4 py-2',
                isActive && 'bg-accent-soft',
              ].join(' ')}
            >
              <Dot tone={isActive ? 'ok' : 'muted'} />
              <Mono className="min-w-0 flex-1 text-[11px] text-ink" numberOfLines={1}>
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

/* ── Session actions ───────────────────────────────────────────────────────────
 * Destructive actions live in a sheet behind an explicit confirm, never inline.
 * The previous version put a delete button directly in the row, one tap from
 * opening a session. */

function SessionActionSheet({
  session,
  onClose,
  onDelete,
  onResume,
  onFork,
  onArchive,
  onRestore,
}: {
  session?: Session
  onClose: () => void
  onDelete: () => void
  onResume: () => void
  onFork: () => void
  onArchive: () => void
  onRestore: () => void
}) {
  const [confirming, setConfirming] = React.useState(false)
  if (!session) return null

  const archived = session.status === 'archived'
  const canResume =
    session.status === 'needs_resume' || session.status === 'exited' || session.status === 'idle'

  return (
    <Sheet
      open
      onClose={onClose}
      eyebrow="Session"
      title={session.name}
    >
      {confirming ? (
        <View className="gap-3">
          <ErrorState message={`Delete "${session.name}"? This cannot be undone.`} />
          <View className="flex-row gap-2">
            <Button
              variant="danger"
              label="Delete forever"
              accessibilityLabel={`Permanently delete ${session.name}`}
              full
              onPress={onDelete}
            />
            <Button
              variant="secondary"
              label="Cancel"
              accessibilityLabel="Cancel deletion"
              full
              onPress={() => setConfirming(false)}
            />
          </View>
        </View>
      ) : (
        <View className="gap-1">
          {canResume ? (
            <SheetAction
              icon={<Play size={17} color={palette.ok} />}
              label="Resume session"
              hint="Continue from where it left off"
              onPress={onResume}
            />
          ) : null}
          <SheetAction
            icon={<GitFork size={17} color={palette.accent} />}
            label="Fork session"
            hint="Branch into a new session with the same history"
            onPress={onFork}
          />
          {archived ? (
            <SheetAction
              icon={<ArchiveRestore size={17} color={palette.wait} />}
              label="Restore from archive"
              hint="Bring this session back into the list"
              onPress={onRestore}
            />
          ) : (
            <SheetAction
              icon={<Archive size={17} color={palette.ink2} />}
              label="Archive session"
              hint="Hide it without losing its history"
              onPress={onArchive}
            />
          )}

          <View className="my-2 h-px bg-line" />

          <SheetAction
            icon={<Trash2 size={17} color={palette.danger} />}
            label="Delete session"
            hint="Permanently remove it and its history"
            tone="danger"
            onPress={() => {
              void haptic('warn')
              setConfirming(true)
            }}
          />
        </View>
      )}
    </Sheet>
  )
}

function SheetAction({
  icon,
  label,
  hint,
  onPress,
  tone = 'default',
}: {
  icon: React.ReactNode
  label: string
  hint?: string
  onPress: () => void
  tone?: 'default' | 'danger'
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityHint={hint}
      onPress={onPress}
      className="min-h-14 flex-row items-center gap-3 rounded-md px-3 py-2.5 active:bg-pressed"
    >
      {icon}
      <View className="min-w-0 flex-1">
        <Text
          className={['text-[14px] font-medium', tone === 'danger' ? 'text-danger' : 'text-ink'].join(' ')}
        >
          {label}
        </Text>
        {hint ? <Text className="mt-0.5 text-[12px] text-ink-3">{hint}</Text> : null}
      </View>
      <ChevronRight size={16} color={palette.ink3} />
    </Pressable>
  )
}
