/**
 * Station — the daemon's world, as a status board.
 *
 * The desktop scatters this across two sidebar groups and a Configuration page:
 * the engine roster, the CDP browser fleet, the PTY list, room channels, MCP
 * servers, tunnels, the usage ledger, skills and automations. On a phone they
 * collapse into one hub, because the question a phone is asked is not "where is
 * the setting" but "is any of it broken".
 *
 * So every row carries a live readout rather than a description. The counts are
 * fetched tolerantly: a surface that cannot be reached shows an em dash and
 * still navigates, because a hub that fails to render when one daemon endpoint
 * is down is worse than useless — it is the screen you opened *because*
 * something was down.
 */

import * as React from 'react'
import { View } from 'react-native'
import {
  Activity,
  Box,
  Globe,
  Link2,
  LayoutGrid,
  Terminal as TerminalIcon,
  Users,
} from 'lucide-react-native'

import { useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'

import { Section, ScreenScaffold, ListCard } from '@app/components/Screen'
import { Card, Chevron, IconTile, ListRow, Mono, StatusPill, formatCost, formatCount } from '@app/components/ui'
import { DrawerButton } from '@app/components/Drawer'
import { useStore } from '@app/store'
import { mcpApi, remoteApi, roomsApi, terminalsApi } from '@app/lib/api'
import { palette } from '@app/design/tokens'
import type { RootStackParamList } from '@app/navigation'

type Nav = NativeStackNavigationProp<RootStackParamList>

/** A readout that is allowed to be absent — a hub must render while degraded. */
type Counts = {
  terminals: number | null
  rooms: number | null
  mcp: number | null
  tunnelsUp: number | null
}

const EMPTY: Counts = { terminals: null, rooms: null, mcp: null, tunnelsUp: null }

export function StationScreen() {
  const navigation = useNavigation<Nav>()
  const sessions = useStore((state) => state.sessions)
  const agents = useStore((state) => state.agents)
  const desktopName = useStore((state) => state.desktopName)
  const connection = useStore((state) => state.connection)

  const [counts, setCounts] = React.useState<Counts>(EMPTY)

  React.useEffect(() => {
    let cancelled = false
    // `allSettled`: one dead endpoint must not blank the board.
    void Promise.allSettled([
      terminalsApi.list(),
      roomsApi.list(),
      mcpApi.list(),
      remoteApi.endpoints(),
    ]).then(([terminals, rooms, mcp, endpoints]) => {
      if (cancelled) return
      const value = <T,>(result: PromiseSettledResult<T>): T | null =>
        result.status === 'fulfilled' ? result.value : null
      const terminalList = value(terminals) as unknown[] | null
      const roomList = value(rooms) as unknown[] | null
      const serverList = value(mcp) as unknown[] | null
      const endpointList = value(endpoints) as unknown[] | null
      setCounts({
        terminals: terminalList?.length ?? null,
        rooms: roomList?.length ?? null,
        mcp: serverList?.length ?? null,
        tunnelsUp:
          endpointList?.filter((endpoint) => (endpoint as { reachable?: boolean }).reachable).length ?? null,
      })
    })
    return () => {
      cancelled = true
    }
  }, [])

  const ready = agents.filter((agent) => agent.available).length
  const live = sessions.filter((session) => session.status === 'running' || session.status === 'starting').length
  const blocked = sessions.filter(
    (session) =>
      session.status === 'waiting_for_approval' ||
      session.status === 'waiting_for_input' ||
      session.status === 'error',
  ).length
  const cost = sessions.reduce((sum, session) => sum + (session.cost ?? 0), 0)

  // Terminals and rooms only exist inside a session on the daemon's model —
  // they are session-rail tabs on the desktop, not station-wide surfaces — so
  // Station opens them on the most recently touched session, and says so when
  // there is none rather than offering a dead tap.
  const host = React.useMemo(() => {
    const ordered = sessions
      .filter((session) => session.status !== 'archived')
      .slice()
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    return ordered[0]?.id ?? null
  }, [sessions])

  const count = (value: number | null, plural: string, singular = plural): string =>
    value === null ? '—' : `${value} ${value === 1 ? singular : plural}`

  return (
    <ScreenScaffold
      title="Station"
      eyebrow={desktopName ? `${desktopName} · the daemon` : 'The daemon'}
      subtitle="Engines, terminals, servers and tunnels on the desktop."
      headerLeft={<DrawerButton />}
    >
      <View className="px-4">
        <Card className="p-4">
          <View className="flex-row items-center gap-3">
            <StatusPill
              tone={connection === 'connected' ? 'accent' : connection === 'reconnecting' || connection === 'connecting' ? 'wait' : 'danger'}
              label={
                connection === 'connected'
                  ? 'Connected'
                  : connection === 'connecting'
                    ? 'Connecting'
                    : connection === 'reconnecting'
                      ? 'Reconnecting'
                      : connection === 'unauthorized'
                        ? 'Revoked'
                        : 'Offline'
              }
            />
            <View className="flex-1" />
            <Mono className="text-[10.5px]">{`${sessions.length} sessions`}</Mono>
          </View>
          <View className="mt-3 flex-row items-center gap-4">
            <View className="flex-1">
              <Mono className="text-[10px] uppercase text-ink-3">Ready engines</Mono>
              <Mono className="mt-1 text-[19px] font-semibold text-ink">{`${ready}/${agents.length}`}</Mono>
            </View>
            <View className="flex-1">
              <Mono className="text-[10px] uppercase text-ink-3">Live</Mono>
              <Mono className="mt-1 text-[19px] font-semibold" >{formatCount(live)}</Mono>
            </View>
            <View className="flex-1">
              <Mono className="text-[10px] uppercase text-ink-3">Blocked</Mono>
              <Mono className="mt-1 text-[19px] font-semibold">{formatCount(blocked)}</Mono>
            </View>
            <View className="flex-1">
              <Mono className="text-[10px] uppercase text-ink-3">Spend</Mono>
              <Mono className="mt-1 text-[19px] font-semibold">{formatCost(cost)}</Mono>
            </View>
          </View>
        </Card>
      </View>

      <Section eyebrow="Run" className="mt-5">
        <ListCard inset={64}>
          <ListRow
            leading={<IconTile icon={<LayoutGrid size={17} color={palette.accent} />} />}
            title="Agents"
            subtitle="the engine roster and what each one can do"
            meta={agents.length > 0 ? `${ready} ready` : undefined}
            trailing={<Chevron />}
            onPress={() => navigation.navigate('Agents')}
            accessibilityLabel="Open agents"
          />
          <ListRow
            leading={<IconTile icon={<Box size={17} color={palette.accent} />} />}
            title="API providers"
            subtitle="OpenAI- or Anthropic-compatible endpoints you added"
            trailing={<Chevron />}
            onPress={() => navigation.navigate('Providers')}
            accessibilityLabel="Open API providers"
          />
          <ListRow
            leading={<IconTile icon={<Globe size={17} color={palette.accent} />} />}
            title="Browser engines"
            subtitle="the CDP fleet, one per session"
            trailing={<Chevron />}
            onPress={() => navigation.navigate('Browsers')}
            accessibilityLabel="Open browser engines"
          />
          <ListRow
            leading={<IconTile icon={<TerminalIcon size={17} color={palette.accent} />} />}
            title="Terminals"
            subtitle={host ? 'PTY sessions on the desktop' : 'open a session to reach its terminals'}
            meta={count(counts.terminals, 'open')}
            disabled={!host}
            trailing={<Chevron />}
            onPress={host ? () => navigation.navigate('SessionPanel', { sessionId: host, tab: 'terminals' }) : undefined}
            accessibilityLabel="Open terminals"
          />
          <ListRow
            leading={<IconTile icon={<Users size={17} color={palette.accent} />} />}
            title="Rooms"
            subtitle="rosters and their channel sessions"
            meta={count(counts.rooms, 'channels', 'channel')}
            trailing={<Chevron />}
            onPress={() => navigation.navigate('Rooms')}
            accessibilityLabel="Open rooms"
          />
        </ListCard>
      </Section>

      <Section eyebrow="Connect" className="mt-5">
        <ListCard inset={64}>
          <ListRow
            leading={<IconTile icon={<Box size={17} color={palette.accent} />} />}
            title="MCP servers"
            subtitle="tools exposed to every agent"
            meta={count(counts.mcp, 'servers', 'server')}
            trailing={<Chevron />}
            onPress={() => navigation.navigate('Mcp')}
            accessibilityLabel="Open MCP servers"
          />
          <ListRow
            leading={<IconTile icon={<Link2 size={17} color={palette.accent} />} />}
            title="Tunnels & remote access"
            subtitle="Tailscale, Cloudflare, paired devices"
            meta={count(counts.tunnelsUp, 'up')}
            trailing={<Chevron />}
            onPress={() => navigation.navigate('Remote')}
            accessibilityLabel="Open remote access"
          />
        </ListCard>
      </Section>

      <Section eyebrow="Account" className="mt-5">
        <ListCard inset={64}>
          <ListRow
            leading={<IconTile icon={<Activity size={17} color={palette.accent} />} />}
            title="Usage"
            subtitle="tokens and cost, by session"
            meta={formatCost(cost)}
            trailing={<Chevron />}
            onPress={() => navigation.navigate('Usage')}
            accessibilityLabel="Open usage"
          />
        </ListCard>
      </Section>

      <Section eyebrow="System" className="mt-5">
        <ListCard inset={64}>
          <ListRow
            leading={<IconTile icon={<LayoutGrid size={17} color={palette.accent} />} />}
            title="Daemon settings"
            subtitle="every key the daemon reports, editable"
            trailing={<Chevron />}
            onPress={() => navigation.navigate('Daemon')}
            accessibilityLabel="Open daemon settings"
          />
        </ListCard>
      </Section>
    </ScreenScaffold>
  )
}