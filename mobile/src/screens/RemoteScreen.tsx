/**
 * Remote access — tunnels and paired devices.
 *
 * The desktop's tunnels panel and its paired-devices list are two surfaces in
 * two places. From a phone they are one screen, because the question behind
 * both is the same: **can this phone reach the desktop, and who else can?**
 *
 * Reachability is the headline. A list of endpoints with a green dot each is
 * four rows to read to answer a yes/no question, so the reachable one is
 * promoted to a card and the unreachable ones are listed beneath it as
 * fallbacks. The paired-devices list matters for a different reason — it is
 * how you cut off a phone you lost — so it gets its own section and its own
 * confirm.
 */

import * as React from 'react'
import { Pressable, Text, View } from 'react-native'
import { useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { Cloud, Power, Smartphone } from 'lucide-react-native'

import { remoteApi } from '@app/lib/api'
import type { RootStackParamList } from '@app/navigation'
import { palette, radius } from '@app/design/tokens'
import { BackButton, ScreenScaffold, Section } from '@app/components/Screen'
import { rowEnterStyle, staggerDelay, useEnter } from '@app/components/motion'
import {
  Badge,
  Button,
  Card,
  CopyButton,
  Divider,
  Dot,
  EmptyState,
  Mono,
  haptic,
  toast,
} from '@app/components/ui'

interface TunnelEndpoint {
  base_url: string
  source: string
  host: string
  port: number
  secure: boolean
  reachable: boolean
  via?: string
}

interface PairedDevice {
  id: string
  name: string
  fingerprint?: string
  last_seen?: string
  paired_at?: string
}

export function RemoteScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const [endpoints, setEndpoints] = React.useState<TunnelEndpoint[]>([])
  const [devices, setDevices] = React.useState<PairedDevice[]>([])
  const [loading, setLoading] = React.useState(true)
  const [refreshing, setRefreshing] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState<string | null>(null)
  const [confirmRevoke, setConfirmRevoke] = React.useState<string | null>(null)

  const load = React.useCallback(async () => {
    setError(null)
    try {
      const [epRes, devRes] = await Promise.all([
        remoteApi.endpoints().catch(() => ({ endpoints: [] })),
        remoteApi.devices().catch(() => ({ devices: [] })),
      ])
      setEndpoints(epRes.endpoints ?? [])
      setDevices(devRes.devices ?? [])
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load remote access info')
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    void load()
  }, [load])

  async function refresh() {
    setRefreshing(true)
    await load()
    setRefreshing(false)
  }

  async function toggleTunnel(kind: 'tailscale' | 'cloudflare') {
    const stopping = endpoints.some((endpoint) => endpoint.source === kind && endpoint.reachable)
    setBusy(`${kind}-${stopping ? 'stop' : 'start'}`)
    setError(null)
    try {
      // The daemon answers a start with `{ ok, error? }` and a stop with an
      // empty body, so both are narrowed to the same shape before use rather
      // than being spread with a cast at the call site.
      const result: { ok: boolean; error?: string } = stopping
        ? await remoteApi.stop(kind)
        : await remoteApi.start(kind)
      if (!result.ok && result.error) setError(result.error)
      await load()
      toast({
        message: `${kind === 'tailscale' ? 'Tailscale' : 'Cloudflare'} tunnel ${
          result.ok ? (stopping ? 'stopped' : 'started') : 'did not start'
        }`,
        detail: result.error,
        tone: result.ok ? 'ok' : 'danger',
      })
    } catch (cause) {
      toast({
        message: 'That tunnel action failed',
        detail: cause instanceof Error ? cause.message : undefined,
        tone: 'danger',
      })
    } finally {
      setBusy(null)
    }
  }

  async function revokeDevice(id: string) {
    setBusy(`revoke-${id}`)
    try {
      await remoteApi.revoke(id)
      setConfirmRevoke(null)
      await load()
      toast({ message: 'Device revoked', tone: 'ok' })
    } catch (cause) {
      toast({
        message: 'Could not revoke that device',
        detail: cause instanceof Error ? cause.message : undefined,
        tone: 'danger',
      })
    } finally {
      setBusy(null)
    }
  }

  const reachable = endpoints.filter((endpoint) => endpoint.reachable)
  const unreachable = endpoints.filter((endpoint) => !endpoint.reachable)
  const tunnelState = (kind: 'tailscale' | 'cloudflare') =>
    endpoints.some((endpoint) => endpoint.source === kind && endpoint.reachable)

  return (
    <ScreenScaffold
      title="Remote access"
      eyebrow="Connectivity"
      subtitle="Tunnels that let this phone reach the desktop from outside your local network, and the devices allowed to."
      onRefresh={() => void refresh()}
      refreshing={refreshing}
      scroll
      contentClassName="px-4 pb-12 gap-5"
      headerLeft={<BackButton onPress={() => navigation.goBack()} label="Back to settings" />}
    >
      {error ? (
        <View
          accessible
          accessibilityRole="alert"
          style={{
            gap: 9,
            borderRadius: radius.md,
            borderWidth: 1,
            borderColor: palette.dangerBorder,
            backgroundColor: palette.dangerSoft,
            padding: 14,
          }}
        >
          <Text className="text-[13.5px] font-semibold text-ink">{error}</Text>
          <Button size="sm" variant="secondary" label="Retry" onPress={() => void load()} />
        </View>
      ) : null}

      {/* ── Reachability ────────────────────────────────────────────── */}
      <Section eyebrow="Reachability" title={reachable.length > 0 ? 'Reachable now' : 'Not reachable off-LAN'} enterIndex={0}>
        {reachable.length === 0 ? (
          <Card>
            <EmptyState
              title={loading ? 'Checking routes' : 'Local network only'}
              body={
                loading
                  ? 'Asking the desktop which routes answer.'
                  : 'No tunnel is up. Start one to reach this daemon from outside your local network.'
              }
            />
          </Card>
        ) : (
          <Card>
            {reachable.map((endpoint, index) => (
              <EndpointRow key={endpoint.base_url} endpoint={endpoint} index={index} primary />
            ))}
          </Card>
        )}
      </Section>

      {/* ── Tunnels ─────────────────────────────────────────────────── */}
      <Section eyebrow="Managed on the desktop" title="Tunnels" enterIndex={1}>
        <Card>
          <View style={{ gap: 12, padding: 14 }}>
            <TunnelRow
              name="Tailscale"
              hint="Best when you already run a tailnet — the phone joins it and the daemon needs no open ports."
              running={tunnelState('tailscale')}
              busy={busy}
              onToggle={() => void toggleTunnel('tailscale')}
            />
            <View style={{ height: 1, backgroundColor: palette.line }} />
            <TunnelRow
              name="Cloudflare"
              hint="A public HTTPS URL, no account on your network required. Use when Tailscale is not available."
              running={tunnelState('cloudflare')}
              busy={busy}
              onToggle={() => void toggleTunnel('cloudflare')}
            />
          </View>
        </Card>
      </Section>

      {/* ── Other routes ────────────────────────────────────────────── */}
      {unreachable.length > 0 ? (
        <Section eyebrow="Not answering" title="Other routes" enterIndex={2}>
          <Card>
            {unreachable.map((endpoint, index) => (
              <EndpointRow key={endpoint.base_url} endpoint={endpoint} index={index} />
            ))}
          </Card>
        </Section>
      ) : null}

      {/* ── Paired devices ──────────────────────────────────────────── */}
      <Section eyebrow="Security" title="Paired devices" enterIndex={3}>
        {devices.length === 0 ? (
          <Card>
            <EmptyState
              title="No paired devices"
              body="Devices that pair with this daemon appear here. Revoke one to cut it off immediately."
            />
          </Card>
        ) : (
          <Card>
            {devices.map((device, index) => (
              <DeviceRow
                key={device.id}
                device={device}
                index={index}
                confirming={confirmRevoke === device.id}
                busy={busy === `revoke-${device.id}`}
                onRevoke={() => {
                  void haptic('warn')
                  setConfirmRevoke(device.id)
                }}
                onConfirmRevoke={() => void revokeDevice(device.id)}
              />
            ))}
          </Card>
        )}
      </Section>
    </ScreenScaffold>
  )
}

function EndpointRow({
  endpoint,
  index,
  primary,
}: {
  endpoint: TunnelEndpoint
  index: number
  primary?: boolean
}) {
  const enter = useEnter(staggerDelay(index), false)
  return (
    <View style={rowEnterStyle(enter)}>
      {index > 0 ? <Divider inset={16} /> : null}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 11, padding: 14 }}>
        <Dot tone={endpoint.reachable ? 'ok' : 'muted'} />
        <View style={{ flex: 1, minWidth: 0, gap: 2 }}>
          <Mono className="text-[12.5px] text-ink" numberOfLines={1}>
            {endpoint.base_url}
          </Mono>
          <Text className="text-[11.5px] text-ink-3" numberOfLines={1}>
            {endpoint.source}
            {endpoint.via ? ` via ${endpoint.via}` : ''} · {endpoint.secure ? 'secure' : 'insecure'}
          </Text>
        </View>
        {primary ? (
          <Badge tone="ok" outline>
            reachable
          </Badge>
        ) : null}
        <CopyButton
          value={endpoint.base_url}
          label="Copy"
          accessibilityLabel={`Copy ${endpoint.base_url}`}
        />
      </View>
    </View>
  )
}

function TunnelRow({
  name,
  hint,
  running,
  busy,
  onToggle,
}: {
  name: string
  hint: string
  running: boolean
  busy: string | null
  onToggle: () => void
}) {
  return (
    <View style={{ gap: 10 }}>
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 11 }}>
        <View
          style={{
            width: 34,
            height: 34,
            borderRadius: radius.sm,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: running ? palette.okSoft : palette.raised,
          }}
        >
          <Cloud size={16} color={running ? palette.ok : palette.ink3} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text className="text-[15px] font-semibold text-ink">{name}</Text>
          <Text className="mt-0.5 text-[12px] leading-[16px] text-ink-3" numberOfLines={2}>
            {hint}
          </Text>
        </View>
        <Badge tone={running ? 'ok' : 'muted'} outline>
          {running ? 'up' : 'down'}
        </Badge>
      </View>
      <Button
        size="sm"
        variant={running ? 'secondary' : 'primary'}
        label={busy ? 'Working…' : running ? `Stop ${name}` : `Start ${name}`}
        icon={<Power size={14} color={palette.ink2} />}
        disabled={busy !== null}
        onPress={onToggle}
      />
    </View>
  )
}

function DeviceRow({
  device,
  index,
  confirming,
  busy,
  onRevoke,
  onConfirmRevoke,
}: {
  device: PairedDevice
  index: number
  confirming: boolean
  busy: boolean
  onRevoke: () => void
  onConfirmRevoke: () => void
}) {
  const enter = useEnter(staggerDelay(index), false)
  return (
    <View style={rowEnterStyle(enter)}>
      {index > 0 ? <Divider inset={60} /> : null}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 }}>
        <View
          style={{
            width: 36,
            height: 36,
            borderRadius: radius.sm,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: palette.accentSoft,
          }}
        >
          <Smartphone size={16} color={palette.accent} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text className="text-[14.5px] font-medium text-ink" numberOfLines={1}>
            {device.name}
          </Text>
          <Mono className="mt-0.5 text-[11px] text-ink-3" numberOfLines={1}>
            {device.fingerprint?.slice(0, 16) ?? device.id.slice(0, 16)}
          </Mono>
          {device.last_seen ? (
            <Text className="mt-0.5 text-[11px] text-ink-4">
              Last seen {new Date(device.last_seen).toLocaleDateString()}
            </Text>
          ) : null}
        </View>
        {confirming ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Confirm revoking ${device.name}`}
            disabled={busy}
            onPress={onConfirmRevoke}
            style={({ pressed }) => ({
              minHeight: 34,
              justifyContent: 'center',
              borderRadius: radius.sm,
              borderWidth: 1,
              borderColor: palette.dangerBorder,
              backgroundColor: pressed ? palette.dangerSoft : 'transparent',
              paddingHorizontal: 11,
            })}
          >
            <Text style={{ color: palette.danger, fontSize: 12, fontWeight: '700' }}>
              {busy ? '…' : 'Revoke'}
            </Text>
          </Pressable>
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Revoke ${device.name}`}
            onPress={onRevoke}
            hitSlop={8}
            style={({ pressed }) => ({
              minHeight: 34,
              justifyContent: 'center',
              borderRadius: radius.sm,
              borderWidth: 1,
              borderColor: palette.line,
              backgroundColor: pressed ? palette.raised : 'transparent',
              paddingHorizontal: 11,
            })}
          >
            <Text style={{ color: palette.ink2, fontSize: 12, fontWeight: '600' }}>Revoke</Text>
          </Pressable>
        )}
      </View>
    </View>
  )
}
