/**
 * System — the machinery hub.
 *
 * QAI SIGNAL DECK
 * ---------------
 * Everything the daemon owns that is not a session lives here: the engine
 * roster, token spend, MCP servers, browser engines, standalone terminals,
 * rooms, remote access, and the daemon's own settings. Each row is an honest
 * readout first — a real count or state fetched from the daemon — and a
 * destination second. A hub of unadorned labels would be indistinguishable
 * from settings you can edit in place; the number on the row is what says
 * "this is live, and there is more behind it".
 *
 * Terminals and rooms render inline: they are short lists with one verb each
 * (create/close, open channel), and pushing a screen for four rows is a
 * hallway with no rooms in it.
 */

import * as React from 'react'
import { Text, View } from 'react-native'
import { useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import {
  BarChart3,
  Bot,
  Cpu,
  Globe,
  Plus,
  Server,
  Settings2,
  Terminal as TerminalIcon,
  Trash2,
  Users,
  Wifi,
} from 'lucide-react-native'

import type { RootStackParamList } from '@app/navigation'
import { useStore } from '@app/store'
import { browserApi, mcpApi, remoteApi, terminalsApi, roomsApi } from '@app/lib/api'
import { palette } from '@app/design/tokens'
import { ListCard, ScreenScaffold, Section } from '@app/components/Screen'
import {
  Badge,
  Button,
  Chevron,
  Dot,
  EmptyState,
  Field,
  IconButton,
  IconTile,
  ListRow,
  Mono,
  RowSkeleton,
  ErrorState,
  haptic,
  toast,
} from '@app/components/ui'
import { AutomationsSection, SkillsSection } from '@app/components/home/Sections'

interface SystemFacts {
  mcpCount: number | null
  browsersRunning: number | null
  tunnel: string | null
}

export function SystemScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const agents = useStore((s) => s.agents)
  const connection = useStore((s) => s.connection)

  const [facts, setFacts] = React.useState<SystemFacts>({ mcpCount: null, browsersRunning: null, tunnel: null })
  const [refreshing, setRefreshing] = React.useState(false)

  const loadFacts = React.useCallback(async () => {
    // Every readout is best-effort: one unreachable surface must not blank
    // the others. `null` means "not read", and the row shows a dash for it.
    const [mcp, browsers, tunnel] = await Promise.all([
      mcpApi.list().then((res) => res.servers?.length ?? 0).catch(() => null),
      browserApi
        .status()
        .then((res) => (res.sessions ?? []).length)
        .catch(() => null),
      remoteApi
        .status()
        .then((res) => {
          const parts: string[] = []
          const tailscale = res.tailscale as { enabled?: boolean } | undefined
          const cloudflare = res.cloudflare as { enabled?: boolean } | undefined
          if (tailscale?.enabled) parts.push('tailscale')
          if (cloudflare?.enabled) parts.push('cloudflare')
          return parts.length ? parts.join(' + ') : 'local only'
        })
        .catch(() => null),
    ])
    setFacts({ mcpCount: mcp, browsersRunning: browsers, tunnel })
  }, [])

  React.useEffect(() => {
    void loadFacts()
  }, [loadFacts])

  const onRefresh = React.useCallback(async () => {
    setRefreshing(true)
    try {
      await Promise.all([loadFacts()])
    } finally {
      setRefreshing(false)
    }
  }, [loadFacts])

  const readyEngines = agents.filter((agent) => agent.available !== false).length

  return (
    <ScreenScaffold
      title="System"
      eyebrow="Daemon machinery"
      subtitle="Everything the desktop runs that is not a session."
      onRefresh={() => void onRefresh()}
      refreshing={refreshing}
      contentClassName="pb-12 gap-6"
    >
      {/* ── Engines & spend ─────────────────────────────────────────── */}
      <Section enterIndex={0} eyebrow="Compute" title="Engines & spend">
        <ListCard inset={64}>
          <Destination
            title="Agents & providers"
            subtitle={
              agents.length === 0
                ? 'The engine roster on the desktop'
                : `${readyEngines} of ${agents.length} ready`
            }
            icon={<Bot size={17} color={palette.ink2} />}
            trailing={
              <View className="flex-row items-center gap-2">
                {agents.length > 0 ? (
                  <Badge tone={readyEngines > 0 ? 'ok' : 'wait'} outline mono>
                    {readyEngines}/{agents.length}
                  </Badge>
                ) : null}
                <Chevron />
              </View>
            }
            onPress={() => navigation.navigate('Agents')}
          />
          <Destination
            title="Usage ledger"
            subtitle="Token spend and cost, per session"
            icon={<BarChart3 size={17} color={palette.ink2} />}
            onPress={() => navigation.navigate('Usage')}
          />
        </ListCard>
      </Section>

      {/* ── Tooling ─────────────────────────────────────────────────── */}
      <Section enterIndex={1} eyebrow="Tooling" title="Surfaces the agents drive">
        <ListCard inset={64}>
          <Destination
            title="MCP servers"
            subtitle="External tools this desktop can call"
            icon={<Server size={17} color={palette.ink2} />}
            trailing={
              <View className="flex-row items-center gap-2">
                {facts.mcpCount !== null ? (
                  <Badge tone="muted" outline mono>
                    {facts.mcpCount}
                  </Badge>
                ) : null}
                <Chevron />
              </View>
            }
            onPress={() => navigation.navigate('Mcp')}
          />
          <Destination
            title="Browser engines"
            subtitle="CDP browsers, mirrored and drivable"
            icon={<Globe size={17} color={palette.ink2} />}
            trailing={
              <View className="flex-row items-center gap-2">
                {facts.browsersRunning !== null ? (
                  <Badge tone={facts.browsersRunning > 0 ? 'ok' : 'muted'} outline mono>
                    {facts.browsersRunning} {facts.browsersRunning === 1 ? 'engine' : 'engines'}
                  </Badge>
                ) : null}
                <Chevron />
              </View>
            }
            onPress={() => navigation.navigate('Browsers')}
          />
          <TerminalsSection />
          <RoomsSection />
        </ListCard>
      </Section>

      {/* ── Access ──────────────────────────────────────────────────── */}
      <Section enterIndex={2} eyebrow="Access" title="Reachability">
        <ListCard inset={64}>
          <Destination
            title="Remote access"
            subtitle="Tunnels, endpoints and paired devices"
            icon={<Wifi size={17} color={palette.ink2} />}
            trailing={
              <View className="flex-row items-center gap-2">
                {facts.tunnel ? (
                  <Badge tone={facts.tunnel === 'local only' ? 'muted' : 'ok'} outline mono>
                    {facts.tunnel}
                  </Badge>
                ) : null}
                <Chevron />
              </View>
            }
            onPress={() => navigation.navigate('Remote')}
          />
          <Destination
            title="Daemon settings"
            subtitle="Read and edit the daemon's own configuration"
            icon={<Settings2 size={17} color={palette.ink2} />}
            onPress={() => navigation.navigate('Daemon')}
          />
        </ListCard>
        {connection !== 'connected' ? (
          <Text className="px-1 text-[11.5px] leading-[16px] text-ink-3">
            Readouts are stale while the link is down ({connection}).
          </Text>
        ) : null}
      </Section>

      {/* ── Prompt machinery ────────────────────────────────────────── */}
      <Section enterIndex={3} eyebrow="Prompt library" title="Skills">
        <SkillsSection />
      </Section>

      <Section enterIndex={4} eyebrow="Automations" title="Run on demand">
        <AutomationsSection />
      </Section>
    </ScreenScaffold>
  )
}

/* ── A row that goes somewhere ───────────────────────────────────────────────
 * The muted icon tile and the chevron together are the whole visual vocabulary
 * of "this is navigation, not a value". */

function Destination({
  title,
  subtitle,
  icon,
  trailing,
  onPress,
}: {
  title: string
  subtitle: string
  icon: React.ReactNode
  trailing?: React.ReactNode
  onPress: () => void
}) {
  return (
    <ListRow
      title={title}
      subtitle={subtitle}
      leading={<IconTile icon={icon} tone="accent" size={34} />}
      trailing={trailing ?? <Chevron />}
      onPress={() => {
        void haptic('light')
        onPress()
      }}
      accessibilityLabel={title}
      accessibilityHint={subtitle}
    />
  )
}

/* ── Standalone terminals (inline) ────────────────────────────────────────────
 * Station-level PTYs the daemon owns (`term-*`), created with a working
 * directory and closed here. I/O for these lives on the desktop; what the
 * phone can honestly do is create, list and close — so that is all it offers. */

function TerminalsSection() {
  const [open, setOpen] = React.useState(false)
  const [terminals, setTerminals] = React.useState<Array<{ id: string; cwd?: string }> | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [cwd, setCwd] = React.useState('')

  const load = React.useCallback(async () => {
    setError(null)
    try {
      setTerminals((await terminalsApi.list()).terminals ?? [])
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not list terminals')
      setTerminals(null)
    }
  }, [])

  async function toggle() {
    const next = !open
    setOpen(next)
    if (next && terminals === null) await load()
  }

  async function create() {
    setBusy(true)
    try {
      await terminalsApi.create(cwd.trim() || undefined)
      setCwd('')
      await load()
      toast({ message: 'Terminal created on the desktop', tone: 'ok' })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not create a terminal')
    } finally {
      setBusy(false)
    }
  }

  async function close(id: string) {
    setBusy(true)
    try {
      await terminalsApi.close(id)
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not close that terminal')
    } finally {
      setBusy(false)
    }
  }

  return (
    <View>
      <ListRow
        title="Terminals"
        subtitle="Standalone shells on the desktop"
        leading={<IconTile icon={<TerminalIcon size={17} color={palette.ink2} />} tone="accent" size={34} />}
        trailing={
          <View className="flex-row items-center gap-2">
            {terminals !== null && terminals.length > 0 ? (
              <Badge tone="ok" outline mono>
                {terminals.length}
              </Badge>
            ) : null}
            <Chevron />
          </View>
        }
        onPress={() => {
          void haptic('light')
          void toggle()
        }}
        accessibilityLabel="Terminals"
        expanded={open}
      />
      {open ? (
        <View className="gap-2 border-t border-line px-4 py-3" style={{ backgroundColor: palette.well }}>
          {error ? <ErrorState message={error} onRetry={() => void load()} /> : null}
          {terminals === null && !error ? <RowSkeleton /> : null}
          {terminals !== null && terminals.length === 0 ? (
            <Text className="text-[12px] leading-[16px] text-ink-3">No standalone terminals are open.</Text>
          ) : null}
          {(terminals ?? []).map((terminal) => (
            <View
              key={terminal.id}
              className="flex-row items-center gap-3 rounded-md border border-line bg-surface py-2 pl-3.5 pr-1.5"
            >
              <Dot tone="ok" />
              <View className="min-w-0 flex-1">
                <Mono className="text-[12px] text-ink" numberOfLines={1}>
                  {terminal.id}
                </Mono>
                {terminal.cwd ? (
                  <Mono className="mt-0.5 text-[10.5px] text-ink-3" numberOfLines={1}>
                    {terminal.cwd}
                  </Mono>
                ) : null}
              </View>
              <IconButton
                label={`Close terminal ${terminal.id}`}
                size={32}
                disabled={busy}
                onPress={() => void close(terminal.id)}
              >
                <Trash2 size={14} color={palette.ink3} />
              </IconButton>
            </View>
          ))}
          <View className="flex-row items-center gap-2">
            <Field
              containerClassName="flex-1"
              mono
              value={cwd}
              onChangeText={setCwd}
              placeholder="Working directory (optional)"
              accessibilityLabel="New terminal working directory"
              autoCapitalize="none"
              autoCorrect={false}
            />
            <Button
              size="md"
              variant="secondary"
              label="Create"
              icon={<Plus size={14} color={palette.ink2} />}
              disabled={busy}
              onPress={() => void create()}
            />
          </View>
        </View>
      ) : null}
    </View>
  )
}

/* ── Rooms (inline) ───────────────────────────────────────────────────────────
 * Worker rosters you can fan a task out to. The roster itself is edited on
 * the desktop; from the phone you can see the rooms and open the channel
 * session of one — which is where a room task is actually watched and driven. */

function RoomsSection() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const [open, setOpen] = React.useState(false)
  const [rooms, setRooms] = React.useState<Array<{ id: string; name: string; session_id?: string; workers?: unknown[] }> | null>(null)
  const [error, setError] = React.useState<string | null>(null)

  const load = React.useCallback(async () => {
    setError(null)
    try {
      setRooms((await roomsApi.list()).rooms ?? [])
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load rooms')
      setRooms(null)
    }
  }, [])

  async function toggle() {
    const next = !open
    setOpen(next)
    if (next && rooms === null) await load()
  }

  return (
    <View>
      <ListRow
        title="Rooms"
        subtitle="Worker rosters for fan-out runs"
        leading={<IconTile icon={<Users size={17} color={palette.ink2} />} tone="accent" size={34} />}
        trailing={
          <View className="flex-row items-center gap-2">
            {rooms !== null && rooms.length > 0 ? (
              <Badge tone="muted" outline mono>
                {rooms.length}
              </Badge>
            ) : null}
            <Chevron />
          </View>
        }
        onPress={() => {
          void haptic('light')
          void toggle()
        }}
        accessibilityLabel="Rooms"
        expanded={open}
      />
      {open ? (
        <View className="gap-2 border-t border-line px-4 py-3" style={{ backgroundColor: palette.well }}>
          {error ? <ErrorState message={error} onRetry={() => void load()} /> : null}
          {rooms === null && !error ? <RowSkeleton /> : null}
          {rooms !== null && rooms.length === 0 ? (
            <EmptyState
              compact
              title="No rooms"
              body="A room is a roster of workers you can fan one task out to. Send /orchestrator inside a session, or build one on the desktop."
            />
          ) : null}
          {(rooms ?? []).map((room) => {
            const workers = Array.isArray(room.workers) ? room.workers.length : 0
            return (
              <ListRow
                key={room.id}
                title={room.name}
                subtitle={workers > 0 ? `${workers} ${workers === 1 ? 'worker' : 'workers'}` : 'no workers yet'}
                leading={<Cpu size={16} color={palette.accent} />}
                trailing={<Chevron />}
                onPress={() => {
                  if (!room.session_id) {
                    toast({ message: 'That room has no channel session yet', tone: 'muted' })
                    return
                  }
                  navigation.navigate('Session', { sessionId: room.session_id })
                }}
                accessibilityLabel={room.name}
                accessibilityHint={room.session_id ? 'Opens the room channel' : 'This room has no channel session yet'}
              />
            )
          })}
        </View>
      ) : null}
    </View>
  )
}

