/**
 * Configuration — the machine, the routes to it, and alerts.
 *
 * The desktop's Configuration destination is a stack of settings sections, most
 * of which write daemon config the phone has no endpoint for (tunnels, custom
 * providers, context windows, built-in agent roles). Those are still listed, so
 * it is obvious where they live rather than looking missing. What this phone
 * *can* own is here in full: which route it uses to reach the desktop (with
 * manual failover), the notification permission, and unpairing.
 */

import * as React from 'react'
import { Pressable, ScrollView, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useNavigation } from '@react-navigation/native'
import type { DrawerNavigationProp } from '@react-navigation/drawer'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'

import {
  openSystemNotificationSettings,
  permissionState,
  present,
  requestPermission,
  type PermissionState,
} from '@app/lib/notify'
import { clearPairing, getPairingBaseUrl } from '@app/lib/pairing'
import { deviceRoutes, setDeviceBaseUrl } from '@app/lib/native'
import { socket } from '@app/lib/socket'
import { useStore } from '@app/store'
import type { DrawerParamList, RootStackParamList } from '@app/navigation'
import { ChevronRight, Server, Settings as SettingsIcon, Wifi } from 'lucide-react-native'
import {
  Button,
  Card,
  CardHeader,
  Chip,
  Dot,
  FieldRow,
  Mono,
  PageHeader,
  Row,
  SectionLabel,
} from '@app/components/ui'

const PERMISSION_LABEL: Record<PermissionState, string> = {
  granted: 'Allowed',
  denied: 'Blocked in system settings',
  undetermined: 'Not requested yet',
}

/** Settings that are genuinely local to this device. */
const LOCAL_ONLY = ['Appearance & keyboard']

export function SettingsScreen() {
  // Configuration lives on the rail, so the drawer is always the parent.
  const navigation = useNavigation<DrawerNavigationProp<DrawerParamList>>()
  const desktopName = useStore((s) => s.desktopName)
  const connection = useStore((s) => s.connection)
  const [perm, setPerm] = React.useState<PermissionState>('undetermined')
  const [note, setNote] = React.useState<string | null>(null)
  const [routes, setRoutes] = React.useState<string[]>(() => deviceRoutes())
  const [active, setActive] = React.useState<string>(() => getPairingBaseUrl())

  React.useEffect(() => {
    void permissionState().then(setPerm)
  }, [])

  async function enable() {
    setNote(null)
    setPerm(await requestPermission())
  }

  async function test() {
    setNote(null)
    const ok = await present(
      {
        id: `test-${Date.now()}`,
        title: 'AgentDeck',
        body: 'Notifications are working. You will be paged when an agent needs you.',
        data: { sessionId: '', kind: 'test' },
      },
      true,
    )
    setNote(ok ? 'Test notification sent.' : 'Could not send — check the permission above.')
  }

  /** Pin the device to a route and redial, so the choice takes effect now. */
  function useRoute(route: string) {
    if (route === active) return
    setDeviceBaseUrl(route)
    setActive(route)
    setRoutes(deviceRoutes())
    socket.disconnect()
    socket.connect()
  }

  async function unpair() {
    await clearPairing()
    // Unpairing is a gate change, not a rail change: reset the ROOT stack so the
    // pairing screen is the only thing left on the history.
    navigation
      .getParent<NativeStackNavigationProp<RootStackParamList>>()
      ?.reset({ index: 0, routes: [{ name: 'Pairing' }] })
  }

  return (
    <SafeAreaView className="flex-1 bg-canvas" edges={['top']}>
      <PageHeader onMenu={() => navigation.openDrawer()} title="Configuration" />
      <ScrollView contentContainerClassName="gap-4 p-4 pb-10">
        <View className="gap-1.5">
          <Mono className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-3">Manage</Mono>
          <Text className="text-[24px] font-bold tracking-tight text-ink" style={{ letterSpacing: -0.5 }}>{desktopName}</Text>
          <Text className="text-[14px] leading-5 text-ink-2">
            This device talks only to your own daemon. Nothing is sent anywhere else.
          </Text>
        </View>

        {/* Routes — the same list the pairing QR carried, with manual failover. */}
        <Card>
          <CardHeader
            title="Connection"
            right={
              <Chip
                tone={connection === 'connected' ? 'green' : connection === 'offline' ? 'red' : 'orange'}
                label={connection === 'connected' ? 'live' : connection}
              />
            }
          />
          <View className="gap-3 p-3.5">
            {routes.length === 0 ? (
              <Text className="text-[12px] text-ink-3">Not paired.</Text>
            ) : (
              <>
                <Text className="text-[12px] leading-5 text-ink-2">
                  Tap a route to pin it. Left alone, the app moves on by itself when the active route
                  stops answering.
                </Text>
                <View className="gap-1">
                  {routes.map((route) => (
                    <Pressable
                      key={route}
                      onPress={() => useRoute(route)}
                      className={
                        route === active
                          ? 'min-h-11 flex-row items-center gap-2 rounded-control bg-accent-tint px-2.5'
                          : 'min-h-11 flex-row items-center gap-2 rounded-control px-2.5 active:bg-hover-2'
                      }
                    >
                      <Dot tone={route === active ? 'green' : 'dim'} />
                      <Mono className="min-w-0 flex-1 text-[11.5px] text-ink" numberOfLines={1}>
                        {route}
                      </Mono>
                      {route === active ? <Chip tone="accent" label="active" /> : null}
                    </Pressable>
                  ))}
                </View>
              </>
            )}
            <FieldRow label="Device" value={desktopName} />
          </View>
        </Card>

        <Card>
          <CardHeader title="Attention alerts" right={<Chip tone={perm === 'granted' ? 'green' : 'dim'} label={PERMISSION_LABEL[perm]} />} />
          <View className="gap-3 p-3.5">
            <Text className="text-[12px] leading-5 text-ink-2">
              AgentDeck raises a local notification when an agent needs approval, finishes a turn, or
              errors. It rides the connection to your own daemon — no account, no third-party push
              service.
            </Text>
            {perm === 'granted' ? (
              <Button variant="surface" label="Send test notification" onPress={() => void test()} />
            ) : perm === 'denied' ? (
              <Button
                variant="surface"
                label="Open system settings"
                onPress={() => void openSystemNotificationSettings()}
              />
            ) : (
              <Button variant="primary" label="Enable notifications" onPress={() => void enable()} />
            )}
            <Text className="text-[11px] leading-4 text-ink-3">
              iOS delivers these while the app runs in the background. A fully closed app cannot be
              woken without Apple push, so anything that arrived while it was closed surfaces the next
              time you open AgentDeck.
            </Text>
            {note ? <Text className="text-[12px] text-accent">{note}</Text> : null}
          </View>
        </Card>

        {/* Remote-access and daemon-config surfaces — all reachable from the phone now. */}
        <SectionLabel>Daemon & Remote</SectionLabel>
        <Card>
          <View className="p-1.5">
            <Pressable
              onPress={() => navigation.navigate('Mcp' as keyof DrawerParamList)}
              className="min-h-12 flex-row items-center gap-3 rounded-lg px-2.5 active:bg-hover-2"
            >
              <Server size={16} color="#5b8def" />
              <View className="min-w-0 flex-1">
                <Text className="text-[13px] font-medium text-ink">MCP Servers</Text>
                <Text className="text-[11px] text-ink-3">Manage Model Context Protocol integrations</Text>
              </View>
              <ChevronRight size={16} color="#7e7e86" />
            </Pressable>
            <Pressable
              onPress={() => navigation.navigate('Remote' as keyof DrawerParamList)}
              className="min-h-12 flex-row items-center gap-3 rounded-lg px-2.5 active:bg-hover-2"
            >
              <Wifi size={16} color="#5b8def" />
              <View className="min-w-0 flex-1">
                <Text className="text-[13px] font-medium text-ink">Remote Access</Text>
                <Text className="text-[11px] text-ink-3">Tunnels, endpoints, and paired devices</Text>
              </View>
              <ChevronRight size={16} color="#7e7e86" />
            </Pressable>
            <Pressable
              onPress={() => navigation.navigate('DaemonSettings' as keyof DrawerParamList)}
              className="min-h-12 flex-row items-center gap-3 rounded-lg px-2.5 active:bg-hover-2"
            >
              <SettingsIcon size={16} color="#5b8def" />
              <View className="min-w-0 flex-1">
                <Text className="text-[13px] font-medium text-ink">Daemon Settings</Text>
                <Text className="text-[11px] text-ink-3">Read and edit daemon configuration</Text>
              </View>
              <ChevronRight size={16} color="#7e7e86" />
            </Pressable>
          </View>
        </Card>

        <Card>
          <CardHeader title="Local to this device" />
          <View className="p-1.5">
            {LOCAL_ONLY.map((label) => (
              <Row key={label} primary={label} leading={<Dot tone="dim" />} trailing={<Mono className="text-[10.5px]">local</Mono>} />
            ))}
          </View>
        </Card>

        <SectionLabel>Danger zone</SectionLabel>
        <Button variant="danger" label="Unpair this device" onPress={() => void unpair()} />
      </ScrollView>
    </SafeAreaView>
  )
}
