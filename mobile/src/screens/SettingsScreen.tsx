/**
 * Settings — the hub for everything this device can reach.
 *
 * The desktop's Configuration destination is a stack of settings sections, most
 * of which write daemon config the phone has no endpoint for: tunnels, custom
 * provider endpoints, context windows, built-in agent roles. Those are still
 * here, as destinations, so it is obvious where they live rather than looking
 * missing. What this phone *can* own is in full and first: which route it uses
 * to reach the desktop, with manual failover; the notification permission,
 * explained; and unpairing.
 *
 * WHY A HUB AND NOT A FLAT LIST
 * -----------------------------
 * The previous version was one long scroll of cards: connection, alerts, three
 * links to other screens, a stub row that said "local" and did nothing, and a
 * danger button. It mixed four different kinds of thing — things you *own*
 * here, things you *navigate* to, things that are *not editable* from the
 * phone, and things that *destroy* — in one undifferentiated list, which is why
 * unpairing sat two rows from a "Local to this device" heading that led
 * nowhere.
 *
 * This is one screen, in three clearly different kinds of block:
 *
 *   - **You own these.** Real controls, on this device, with real state.
 *   - **On the desktop.** Navigation, grouped, with a one-line description of
 *     what each one is for.
 *   - **This device.** Pairing, the device token, and unpair — the last of
 *     them alone at the bottom, because it is irreversible.
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
import { palette, radius } from '@app/design/tokens'
import { ScreenScaffold, Section } from '@app/components/Screen'
import { ConfirmDialog } from '@app/components/Sheet'
import {
  Badge,
  Button,
  Card,
  Chevron,
  CopyButton,
  Divider,
  Dot,
  FieldRow,
  IconTile,
  ListRow,
  Mono,
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
      contentClassName="px-4 pb-12 gap-5"
    >
      {/* ── Connection ──────────────────────────────────────────────── */}
      <Section enterIndex={0} eyebrow="You own this" title="Connection">
        <Card>
          <View style={{ gap: 12, padding: 14 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
              <Dot
                tone={connection === 'connected' ? 'ok' : connection === 'offline' ? 'danger' : 'wait'}
                pulse={connection !== 'connected'}
              />
              <Text className="flex-1 text-[14.5px] font-medium text-ink">
                {connection === 'connected' ? 'Connected to your desktop' : connection}
              </Text>
              <Badge tone={connection === 'connected' ? 'ok' : 'wait'} outline>
                {connection === 'connected' ? 'live' : connection}
              </Badge>
            </View>

            {routes.length === 0 ? (
              <Text className="text-[13px] leading-[18px] text-ink-3">This device is not paired.</Text>
            ) : (
              <>
                <Text className="text-[13px] leading-[18px] text-ink-2">
                  Tap a route to pin it. Left alone, the app moves on by itself when the active route
                  stops answering.
                </Text>
                <View style={{ gap: 4 }}>
                  {routes.map((route) => {
                    const isActive = route === active
                    return (
                      <Pressable
                        key={route}
                        accessibilityRole="radio"
                        accessibilityLabel={route}
                        accessibilityState={{ selected: isActive }}
                        onPress={() => useRoute(route)}
                        style={({ pressed }) => ({
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: 9,
                          minHeight: 44,
                          borderRadius: radius.sm,
                          paddingHorizontal: 10,
                          backgroundColor: isActive ? palette.accentSoft : pressed ? palette.raised : 'transparent',
                        })}
                      >
                        <Dot tone={isActive ? 'ok' : 'muted'} />
                        <Mono className="min-w-0 flex-1 text-[12px] text-ink" numberOfLines={1}>
                          {route}
                        </Mono>
                        {isActive ? <Badge tone="accent">Active</Badge> : null}
                      </Pressable>
                    )
                  })}
                </View>
              </>
            )}

            <View style={{ height: 1, backgroundColor: palette.line }} />
            <FieldRow label="Desktop" value={desktopName} />
          </View>
        </Card>
      </Section>

      {/* ── Alerts ──────────────────────────────────────────────────── */}
      <Section enterIndex={1} eyebrow="You own this" title="Attention alerts">
        <Card>
          <View style={{ gap: 12, padding: 14 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
              <Bell size={15} color={palette.ink3} />
              <Text className="flex-1 text-[14.5px] font-medium text-ink">
                {PERMISSION_LABEL[perm]}
              </Text>
              <Badge tone={perm === 'granted' ? 'ok' : 'muted'} outline>
                {perm === 'granted' ? 'on' : 'off'}
              </Badge>
            </View>
            <Text className="text-[13px] leading-[18px] text-ink-2">
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
              <Text className="text-[12.5px] leading-[17px]" style={{ color: palette.ok }}>
                {note}
              </Text>
            ) : null}
          </View>
        </Card>
      </Section>

      {/* ── On the desktop ────────────────────────────────────────────
          These are *navigation*, not settings: each one opens a screen that
          manages something the daemon owns. They are grouped under one heading
          and given an icon tile each, because a row of unadorned text labels is
          indistinguishable from a list of values you could edit here. */}
      <Section enterIndex={2} eyebrow="Managed on the desktop" title="Configuration">
        <Card>
          <Destination
            title="Usage"
            subtitle="Token spend and cost, per session"
            icon={<Cpu size={17} color={palette.accent} />}
            onPress={() => navigation.navigate('Usage')}
          />
          <Destination
            title="Browser engines"
            subtitle="One shared engine per workspace"
            icon={<Globe size={17} color={palette.accent} />}
            onPress={() => navigation.navigate('Browsers')}
          />
          <Destination
            title="MCP servers"
            subtitle="External tools this desktop can call"
            icon={<Server size={17} color={palette.accent} />}
            onPress={() => navigation.navigate('Mcp')}
          />
          <Destination
            title="Remote access"
            subtitle="Tunnels, endpoints and paired devices"
            icon={<Wifi size={17} color={palette.accent} />}
            onPress={() => navigation.navigate('Remote')}
          />
          <Destination
            title="Daemon settings"
            subtitle="Read and edit the daemon's own configuration"
            icon={<SettingsIcon size={17} color={palette.accent} />}
            last
            onPress={() => navigation.navigate('Daemon')}
          />
        </Card>
      </Section>

      {/* ── This device ─────────────────────────────────────────────── */}
      <Section enterIndex={3} eyebrow="You own this" title="This device">
        <Card>
          <Destination
            title="Pair another device"
            subtitle="Scan a code from the desktop, or enter a link"
            icon={<Smartphone size={17} color={palette.ink2} />}
            onPress={() => navigation.navigate('Pairing')}
          />
          <View style={{ paddingHorizontal: 16, paddingVertical: 6 }}>
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
              <Monitor size={15} color={palette.ink3} />
              <Text className="flex-1 text-[14px] text-ink-2">Device token</Text>
              <CopyButton
                value={deviceToken() ?? ''}
                label="Copy"
                accessibilityLabel="Copy this device's API token"
              />
            </View>
            <Text className="ml-6 mt-0.5 text-[11.5px] leading-[16px] text-ink-3">
              Bearer credential for this phone. Revoke it from Remote access if the device is lost.
            </Text>
          </View>
        </Card>
      </Section>

      {/* ── Danger ──────────────────────────────────────────────────── */}
      <Section enterIndex={4} eyebrow="Irreversible" title="Danger zone">
        <Button
          variant="danger"
          label="Unpair this device"
          accessibilityLabel="Unpair this device"
          full
          onPress={() => setConfirmUnpair(true)}
        />
        <Text className="text-[12px] leading-[17px] text-ink-3">
          Removes the token from this phone. The desktop keeps running; you pair again with a new
          code.
        </Text>
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
 * The icon tile, the inset hairline and the chevron together are the whole
 * visual vocabulary of "this is navigation, not a value" — and having one
 * component for it is what stops a settings list from drifting into a set of
 * similar-looking rows that are three different kinds of thing.
 */

function Destination({
  title,
  subtitle,
  icon,
  onPress,
  last,
}: {
  title: string
  subtitle: string
  icon: React.ReactNode
  onPress: () => void
  last?: boolean
}) {
  return (
    <View>
      <ListRow
        title={title}
        subtitle={subtitle}
        leading={<IconTile icon={icon} size={36} />}
        trailing={<Chevron />}
        onPress={() => {
          void haptic('light')
          onPress()
        }}
        accessibilityLabel={title}
        accessibilityHint={subtitle}
      />
      {last ? null : <Divider inset={60} />}
    </View>
  )
}
