/**
 * Settings — the kiln hub for everything this device can reach.
 *
 * EMBER CLAY
 * ----------
 * The desktop's Configuration is a stack of daemon-owned sections; the phone
 * owns its route, its alerts, and its pairing — those come first as lit
 * controls. Desktop-owned destinations follow as ember-tiled navigation (a
 * tile + chevron always means "goes somewhere"), then the device block, then
 * the lone danger zone at the bottom because it is irreversible.
 */

import * as React from 'react'
import { Pressable, Text, View } from 'react-native'
import { useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import {
  Bell,
  Cpu,
  Globe,
  Monitor,
  Server,
  Settings as SettingsIcon,
  Smartphone,
  Wifi,
} from 'lucide-react-native'

import {
  openSystemNotificationSettings,
  permissionState,
  present,
  requestPermission,
  type PermissionState,
} from '@app/lib/notify'
import { clearPairing, getPairingBaseUrl } from '@app/lib/pairing'
import { deviceRoutes, setDeviceBaseUrl } from '@app/lib/native'
import { deviceToken } from '@app/lib/api'
import { socket } from '@app/lib/socket'
import { useStore } from '@app/store'
import type { RootStackParamList } from '@app/navigation'
import { palette } from '@app/design/tokens'
import { ListCard, ScreenScaffold, Section } from '@app/components/Screen'
import { ConfirmDialog } from '@app/components/Sheet'
import {
  Badge,
  Button,
  Chevron,
  CopyButton,
  Divider,
  Dot,
  FieldRow,
  IconTile,
  ListRow,
  Mono,
  Notice,
  haptic,
  toast,
} from '@app/components/ui'

const PERMISSION_LABEL: Record<PermissionState, string> = {
  granted: 'Allowed',
  denied: 'Blocked in system settings',
  undetermined: 'Not requested yet',
}

export function SettingsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const desktopName = useStore((s) => s.desktopName)
  const connection = useStore((s) => s.connection)
  const [perm, setPerm] = React.useState<PermissionState>('undetermined')
  const [note, setNote] = React.useState<string | null>(null)
  const [routes, setRoutes] = React.useState<string[]>(() => deviceRoutes())
  const [active, setActive] = React.useState<string>(() => getPairingBaseUrl())
  const [confirmUnpair, setConfirmUnpair] = React.useState(false)
  const [unpairing, setUnpairing] = React.useState(false)

  React.useEffect(() => {
    void permissionState().then(setPerm)
  }, [])

  async function enable() {
    setNote(null)
    const next = await requestPermission()
    setPerm(next)
    if (next === 'granted') toast({ message: 'Attention alerts are on', tone: 'ok' })
    else if (next === 'denied') {
      toast({
        message: 'Notifications are blocked',
        detail: 'Open Settings to allow them for AgentDeck.',
        tone: 'wait',
        duration: 6000,
      })
    }
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
    void haptic('medium')
    toast({ message: 'Switched route', detail: route, tone: 'ok' })
  }

  async function unpair() {
    setUnpairing(true)
    await clearPairing()
    setUnpairing(false)
    setConfirmUnpair(false)
    navigation.reset({ index: 0, routes: [{ name: 'Pairing' }] })
  }

  return (
    <ScreenScaffold
      title="Settings"
      eyebrow={desktopName}
      subtitle="This device talks only to your own daemon. Nothing is sent anywhere else."
      scroll
      contentClassName="pb-12 gap-6"
    >
      {/* ── Connection ──────────────────────────────────────────────── */}
      <Section enterIndex={0} eyebrow="You own this" title="Connection">
        <ListCard inset={16}>
          <View className="min-h-14 flex-row items-center gap-3 px-4 py-3">
            <Dot
              tone={connection === 'connected' ? 'ok' : connection === 'offline' ? 'danger' : 'wait'}
              pulse={connection !== 'connected'}
            />
            <Text
              className="min-w-0 flex-1 text-[15.5px] leading-[21px] font-medium text-ink"
              numberOfLines={1}
            >
              {connection === 'connected' ? 'Connected to your desktop' : connection}
            </Text>
            <Badge tone={connection === 'connected' ? 'ok' : 'wait'} outline>
              {connection === 'connected' ? 'live' : connection}
            </Badge>
          </View>

          {routes.length === 0 ? (
            <View className="px-4 py-3.5">
              <Text className="text-[13.5px] leading-[19px] text-ink-3">This device is not paired.</Text>
            </View>
          ) : (
            <View>
              <Text className="px-4 pb-2 pt-3 text-[12.5px] leading-[17px] text-ink-3">
                Tap a route to pin it. Left alone, the app moves on by itself when the active route
                stops answering.
              </Text>
              {routes.map((route) => {
                const isActive = route === active
                return (
                  <View key={route}>
                    <Divider inset={16} />
                    <Pressable
                      accessibilityRole="radio"
                      accessibilityLabel={route}
                      accessibilityState={{ selected: isActive }}
                      onPress={() => useRoute(route)}
                      className="min-h-12 flex-row items-center gap-3 px-4 active:bg-raised"
                      style={isActive ? { backgroundColor: palette.accentSoft } : undefined}
                    >
                      <Dot tone={isActive ? 'ok' : 'muted'} />
                      <Mono className="min-w-0 flex-1 text-[12.5px] leading-[18px] text-ink" numberOfLines={1}>
                        {route}
                      </Mono>
                      {isActive ? <Badge tone="accent">Active</Badge> : null}
                    </Pressable>
                  </View>
                )
              })}
            </View>
          )}

          <View className="px-4 py-3">
            <FieldRow label="Desktop" value={desktopName} />
          </View>
        </ListCard>
      </Section>

      {/* ── Alerts ──────────────────────────────────────────────────── */}
      <Section enterIndex={1} eyebrow="You own this" title="Attention alerts">
        <ListCard inset={16}>
          <View className="min-h-14 flex-row items-center gap-3 px-4 py-3">
            <IconTile icon={<Bell size={17} color={palette.ink2} />} tone="muted" />
            <Text className="min-w-0 flex-1 text-[15.5px] leading-[21px] font-medium text-ink">
              {PERMISSION_LABEL[perm]}
            </Text>
            <Badge tone={perm === 'granted' ? 'ok' : 'muted'} outline>
              {perm === 'granted' ? 'on' : 'off'}
            </Badge>
          </View>
          <View className="gap-3 px-4 py-3.5">
            <Text className="text-[13.5px] leading-[19px] text-ink-2">
              AgentDeck raises a local notification when an agent needs approval, finishes a turn, or
              errors. It rides the connection to your own daemon — no account, no third-party push
              service.
            </Text>
            {perm === 'granted' ? (
              <Button size="sm" variant="secondary" label="Send a test notification" onPress={() => void test()} />
            ) : perm === 'denied' ? (
              <Button
                size="sm"
                variant="secondary"
                label="Open system settings"
                onPress={() => void openSystemNotificationSettings()}
              />
            ) : (
              <Button size="sm" variant="primary" label="Enable notifications" onPress={() => void enable()} />
            )}
            <Text className="text-[12px] leading-[17px] text-ink-3">
              iOS delivers these while the app runs in the background. A fully closed app cannot be
              woken without Apple push, so anything that arrived while it was closed surfaces the
              next time you open AgentDeck.
            </Text>
            {note ? (
              <Notice
                tone={note.startsWith('Test notification sent') ? 'ok' : 'danger'}
                message={note}
              />
            ) : null}
          </View>
        </ListCard>
      </Section>

      {/* ── On the desktop ────────────────────────────────────────────
          These are *navigation*, not settings: each one opens a screen that
          manages something the daemon owns. They are grouped under one heading
          and given a chevron each, because a row of unadorned text labels is
          indistinguishable from a list of values you could edit here. */}
      <Section enterIndex={2} eyebrow="Managed on the desktop" title="Configuration">
        <ListCard inset={64}>
          <Destination
            title="Usage"
            subtitle="Token spend and cost, per session"
            icon={<Cpu size={17} color={palette.ink2} />}
            onPress={() => navigation.navigate('Usage')}
          />
          <Destination
            title="Browser engines"
            subtitle="One shared engine per workspace"
            icon={<Globe size={17} color={palette.ink2} />}
            onPress={() => navigation.navigate('Browsers')}
          />
          <Destination
            title="MCP servers"
            subtitle="External tools this desktop can call"
            icon={<Server size={17} color={palette.ink2} />}
            onPress={() => navigation.navigate('Mcp')}
          />
          <Destination
            title="Remote access"
            subtitle="Tunnels, endpoints and paired devices"
            icon={<Wifi size={17} color={palette.ink2} />}
            onPress={() => navigation.navigate('Remote')}
          />
          <Destination
            title="Daemon settings"
            subtitle="Read and edit the daemon's own configuration"
            icon={<SettingsIcon size={17} color={palette.ink2} />}
            onPress={() => navigation.navigate('Daemon')}
          />
        </ListCard>
      </Section>

      {/* ── This device ─────────────────────────────────────────────── */}
      <Section enterIndex={3} eyebrow="You own this" title="This device">
        <ListCard inset={64}>
          <Destination
            title="Pair another device"
            subtitle="Scan a code from the desktop, or enter a link"
            icon={<Smartphone size={17} color={palette.ink2} />}
            onPress={() => navigation.navigate('Pairing')}
          />
          <View className="gap-1.5 px-4 py-3">
            <View className="flex-row items-center gap-3">
              <IconTile icon={<Monitor size={17} color={palette.ink2} />} tone="muted" />
              <Text className="min-w-0 flex-1 text-[13.5px] leading-[19px] text-ink-2">Device token</Text>
              <CopyButton
                value={deviceToken() ?? ''}
                label="Copy"
                accessibilityLabel="Copy this device's API token"
              />
            </View>
            <Text className="text-[11.5px] leading-[16px] text-ink-3" style={{ marginLeft: 48 }}>
              Bearer credential for this phone. Revoke it from Remote access if the device is lost.
            </Text>
          </View>
        </ListCard>
      </Section>

      {/* ── Danger ──────────────────────────────────────────────────── */}
      <Section enterIndex={4} eyebrow="Irreversible" title="Danger zone">
        <View className="gap-2.5">
          <Button
            variant="danger"
            label="Unpair this device"
            accessibilityLabel="Unpair this device"
            full
            onPress={() => setConfirmUnpair(true)}
          />
          <Text className="px-1 text-[12.5px] leading-[18px] text-ink-3">
            Removes the token from this phone. The desktop keeps running; you pair again with a new
            code.
          </Text>
        </View>
      </Section>

      <ConfirmDialog
        open={confirmUnpair}
        busy={unpairing}
        title="Unpair this device?"
        body="The stored token is deleted from this phone. Nothing on the desktop is changed, and you can pair again with a fresh code."
        confirmLabel="Unpair"
        onClose={() => setConfirmUnpair(false)}
        onConfirm={() => void unpair()}
      />
    </ScreenScaffold>
  )
}

/* ── A row that goes somewhere ───────────────────────────────────────────────────
 * The muted icon tile and the chevron together are the whole visual vocabulary
 * of "this is navigation, not a value". The card supplies the hairline, so the
 * row itself stays a plain `ListRow`. */

function Destination({
  title,
  subtitle,
  icon,
  onPress,
}: {
  title: string
  subtitle: string
  icon: React.ReactNode
  onPress: () => void
}) {
  return (
    <ListRow
      title={title}
      subtitle={subtitle}
      leading={<IconTile icon={icon} tone="accent" size={36} />}
      trailing={<Chevron />}
      onPress={() => {
        void haptic('light')
        onPress()
      }}
      accessibilityLabel={title}
      accessibilityHint={subtitle}
    />
  )
}
