/**
 * Remote Access — tunnel management and paired devices.
 *
 * Combines the desktop's tunnel status/start/stop controls with the paired-devices
 * list/revoke surface. All six remoteApi methods are wired here.
 */

import * as React from 'react'
import { Pressable, RefreshControl, ScrollView, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useNavigation } from '@react-navigation/native'
import type { DrawerNavigationProp } from '@react-navigation/drawer'
import { Cloud, Power, Shield, Smartphone, Wifi, WifiOff } from 'lucide-react-native'

import { remoteApi } from '@app/lib/api'
import type { DrawerParamList } from '@app/navigation'
import {
  Button,
  Card,
  CardHeader,
  Chip,
  Dot,
  EmptyState,
  Mono,
  PageHeader,
  SectionLabel,
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
  const navigation = useNavigation<DrawerNavigationProp<DrawerParamList>>()
  const [endpoints, setEndpoints] = React.useState<TunnelEndpoint[]>([])
  const [devices, setDevices] = React.useState<PairedDevice[]>([])
  const [tunnelStatus, setTunnelStatus] = React.useState<Record<string, unknown>>({})
  const [loading, setLoading] = React.useState(false)
  const [refreshing, setRefreshing] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState<string | null>(null)
  const [confirmRevoke, setConfirmRevoke] = React.useState<string | null>(null)

  const load = React.useCallback(async () => {
    setError(null)
    try {
      const [epRes, devRes, statusRes] = await Promise.all([
        remoteApi.endpoints().catch(() => ({ endpoints: [] })),
        remoteApi.devices().catch(() => ({ devices: [] })),
        remoteApi.status().catch(() => ({})),
      ])
      setEndpoints(epRes.endpoints ?? [])
      setDevices(devRes.devices ?? [])
      setTunnelStatus(statusRes)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load remote access info')
    }
  }, [])

  React.useEffect(() => {
    setLoading(true)
    void load().finally(() => setLoading(false))
  }, [load])

  async function refresh() {
    setRefreshing(true)
    await load()
    setRefreshing(false)
  }

  async function startTunnel(kind: 'tailscale' | 'cloudflare') {
    setBusy(`start-${kind}`)
    setError(null)
    try {
      const res = await remoteApi.start(kind)
      if (!res.ok && res.error) setError(res.error)
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : `Could not start ${kind}`)
    } finally {
      setBusy(null)
    }
  }

  async function stopTunnel(kind: 'tailscale' | 'cloudflare') {
    setBusy(`stop-${kind}`)
    setError(null)
    try {
      await remoteApi.stop(kind)
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : `Could not stop ${kind}`)
    } finally {
      setBusy(null)
    }
  }

  async function revokeDevice(id: string) {
    setBusy(`revoke-${id}`)
    setError(null)
    try {
      await remoteApi.revoke(id)
      setConfirmRevoke(null)
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not revoke device')
    } finally {
      setBusy(null)
    }
  }

  return (
    <SafeAreaView className="flex-1 bg-canvas" edges={['top']}>
      <PageHeader onMenu={() => navigation.openDrawer()} title="Remote Access" />

      <ScrollView
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor="#7e7e86" />}
        contentContainerClassName="pb-10"
      >
        <View className="gap-3 px-4 pt-5 pb-3">
          <View className="gap-1.5">
            <Mono className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-3">Connectivity</Mono>
            <Text className="text-[24px] font-bold tracking-tight text-ink" style={{ letterSpacing: -0.5 }}>Remote Access</Text>
            <Text className="text-[14px] leading-5 text-ink-2">
              Manage tunnels that let this phone reach the desktop daemon outside your local
              network, and control which devices are paired.
            </Text>
          </View>

          {error ? (
            <View className="rounded-xl border border-red-border bg-red-tint px-3.5 py-2.5">
              <Text className="text-[13px] leading-5 text-ink">{error}</Text>
            </View>
          ) : null}

          {/* Tunnel Controls */}
            <Card>
              <CardHeader
                title="Tunnels"
                right={
                  <Chip
                    tone={endpoints.some((e) => e.reachable) ? 'green' : 'dim'}
                    label={endpoints.some((e) => e.reachable) ? 'reachable' : 'local only'}
                  />
                }
              />
              <View className="gap-3 p-3.5">
                {endpoints.length === 0 ? (
                  <Text className="text-[11.5px] text-ink-3">
                    No tunnel endpoints configured. Start a tunnel to reach this daemon from outside
                    your local network.
                  </Text>
                ) : (
                  endpoints.map((ep, idx) => (
                    <View key={idx} className="flex-row items-center gap-2 rounded-lg border border-line bg-inset px-2.5 py-2">
                      <Dot tone={ep.reachable ? 'green' : 'dim'} />
                      <View className="min-w-0 flex-1">
                        <Mono className="text-[11px] text-ink" numberOfLines={1}>
                          {ep.base_url}
                        </Mono>
                        <Mono className="text-[9.5px] text-ink-3">
                          {ep.source}{ep.via ? ` via ${ep.via}` : ''} · {ep.secure ? 'secure' : 'insecure'}
                        </Mono>
                      </View>
                      <Chip tone={ep.reachable ? 'green' : 'orange'} label={ep.reachable ? 'up' : 'down'} />
                    </View>
                  ))
                )}

                <View className="border-t border-line pt-3 gap-2">
                  <Mono className="text-[9.5px] uppercase tracking-wider text-ink-3">Tunnel Controls</Mono>
                  <View className="flex-row flex-wrap gap-2">
                    <Button
                      variant="surface"
                      label={busy === 'start-tailscale' ? '…' : 'Start Tailscale'}
                      disabled={busy !== null}
                      className="min-h-9 px-3"
                      onPress={() => void startTunnel('tailscale')}
                    />
                    <Button
                      variant="surface"
                      label={busy === 'stop-tailscale' ? '…' : 'Stop Tailscale'}
                      disabled={busy !== null}
                      className="min-h-9 px-3"
                      onPress={() => void stopTunnel('tailscale')}
                    />
                    <Button
                      variant="surface"
                      label={busy === 'start-cloudflare' ? '…' : 'Start Cloudflare'}
                      disabled={busy !== null}
                      className="min-h-9 px-3"
                      onPress={() => void startTunnel('cloudflare')}
                    />
                    <Button
                      variant="surface"
                      label={busy === 'stop-cloudflare' ? '…' : 'Stop Cloudflare'}
                      disabled={busy !== null}
                      className="min-h-9 px-3"
                      onPress={() => void stopTunnel('cloudflare')}
                    />
                  </View>
                </View>
              </View>
            </Card>

            {/* Paired Devices */}
            <SectionLabel>Paired Devices</SectionLabel>
            {devices.length === 0 ? (
              <Card>
                <EmptyState
                  title="No paired devices"
                  body="Devices that pair with this daemon will appear here."
                />
              </Card>
            ) : (
              devices.map((device) => (
                <Card key={device.id}>
                  <View className="flex-row items-center gap-3 p-3.5">
                    <View className="size-9 items-center justify-center rounded-lg bg-accent-tint">
                      <Smartphone size={16} color="#5b8def" />
                    </View>
                    <View className="min-w-0 flex-1">
                      <Text className="text-[13px] font-medium text-ink" numberOfLines={1}>
                        {device.name}
                      </Text>
                      <Mono className="mt-0.5 text-[10px] text-ink-3" numberOfLines={1}>
                        {device.fingerprint?.slice(0, 16) ?? device.id.slice(0, 16)}
                      </Mono>
                      {device.last_seen ? (
                        <Mono className="text-[9.5px] text-ink-3">
                          Last seen: {new Date(device.last_seen).toLocaleDateString()}
                        </Mono>
                      ) : null}
                    </View>
                    {confirmRevoke === device.id ? (
                      <Pressable
                        onPress={() => void revokeDevice(device.id)}
                        disabled={busy === `revoke-${device.id}`}
                        className="min-h-8 rounded-lg bg-red-tint px-2.5 items-center justify-center"
                      >
                        <Text className="text-[10.5px] font-semibold text-red">
                          {busy === `revoke-${device.id}` ? '…' : 'Confirm'}
                        </Text>
                      </Pressable>
                    ) : (
                      <Pressable
                        onPress={() => setConfirmRevoke(device.id)}
                        accessibilityLabel={`Revoke ${device.name}`}
                        className="min-h-8 rounded-lg border border-line bg-surface px-2.5 items-center justify-center active:bg-red-tint"
                      >
                        <Text className="text-[10.5px] text-ink-2">Revoke</Text>
                      </Pressable>
                    )}
                  </View>
                </Card>
              ))
            )}
        </View>
      </ScrollView>
    </SafeAreaView>
  )
}
