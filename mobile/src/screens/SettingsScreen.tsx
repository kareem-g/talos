/**
 * Settings — this device, its alerts, and its pairing.
 *
 * QAI SIGNAL DECK
 * ---------------
 * The desktop's Configuration is a stack of daemon-owned sections, and those
 * live in the System tab now. What is left here is exactly what the *phone*
 * owns: its route to the daemon, its attention alerts, its identity, and the
 * one irreversible action (unpair). Order follows ownership: connection first
 * (it explains every other screen's silence), alerts second (the reason this
 * app exists in a pocket), identity third, danger last.
 */

import * as React from 'react'
import { Pressable, Text, View } from 'react-native'
import { useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { Bell, Monitor, QrCode, Smartphone } from 'lucide-react-native'
import * as Application from 'expo-application'

import {
  openSystemNotificationSettings,
  permissionState,
  present,
  requestPermission,
  type PermissionState,
} from '@app/lib/notify'
import { clearPairing, getPairingBaseUrl } from '@app/lib/pairing'
import { deviceRoutes, setDeviceBaseUrl } from '@app/lib/native'
import { deviceToken, pairingApi } from '@app/lib/api'
import { socket } from '@app/lib/socket'
import { useStore } from '@app/store'
import type { RootStackParamList } from '@app/navigation'
import { palette } from '@app/design/tokens'
import { ListCard, ScreenScaffold, Section } from '@app/components/Screen'
import { ConfirmDialog } from '@app/components/Sheet'
import {
  Badge,
  BrandLockup,
  Button,
  CopyButton,
  Divider,
  Dot,
  FieldRow,
  IconTile,
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
  const [about, setAbout] = React.useState<{ device: string; desktopVersion: string } | null>(null)

  React.useEffect(() => {
    void permissionState().then(setPerm)
    // Identity readout: best-effort; the rows simply stay quiet when offline.
    pairingApi
      .me()
      .then((me) => setAbout({ device: me.device.name, desktopVersion: me.desktop.version }))
      .catch(() => undefined)
  }, [])

  async function enable() {
    setNote(null)
    const next = await requestPermission()
    setPerm(next)
    if (next === 'granted') toast({ message: 'Attention alerts are on', tone: 'ok' })
    else if (next === 'denied') {
      toast({
        message: 'Notifications are blocked',
        detail: 'Open Settings to allow them for QAI.',
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
        title: 'QAI',
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
      eyebrow="This device"
      subtitle="QAI talks only to your own daemon. Nothing is sent anywhere else."
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
              className="min-w-0 flex-1 text-[14.5px] leading-[20px] font-medium text-ink"
              numberOfLines={1}
            >
              {connection === 'connected' ? `Connected to ${desktopName}` : connection}
            </Text>
            <Badge tone={connection === 'connected' ? 'ok' : 'wait'} outline mono>
              {connection === 'connected' ? 'live' : connection}
            </Badge>
          </View>

          {routes.length === 0 ? (
            <View className="px-4 py-3.5">
              <Text className="text-[13px] leading-[18px] text-ink-3">This device is not paired.</Text>
            </View>
          ) : (
            <View>
              <Text className="px-4 pb-2 pt-3 text-[12px] leading-[16px] text-ink-3">
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
                      <Mono className="min-w-0 flex-1 text-[12px] leading-[17px] text-ink" numberOfLines={1}>
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
            <IconTile icon={<Bell size={16} color={palette.ink2} />} tone="muted" size={34} />
            <Text className="min-w-0 flex-1 text-[14.5px] leading-[20px] font-medium text-ink">
              {PERMISSION_LABEL[perm]}
            </Text>
            <Badge tone={perm === 'granted' ? 'ok' : 'muted'} outline mono>
              {perm === 'granted' ? 'on' : 'off'}
            </Badge>
          </View>
          <View className="gap-3 px-4 py-3.5">
            <Text className="text-[13px] leading-[18px] text-ink-2">
              QAI raises a local notification when an agent needs approval, finishes a turn, or
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
            <Text className="text-[11.5px] leading-[16px] text-ink-3">
              Alerts are delivered while the app runs in the background. A fully closed app cannot
              be woken without platform push, so anything that arrived while it was closed surfaces
              the next time you open QAI.
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

      {/* ── This device ─────────────────────────────────────────────── */}
      <Section enterIndex={2} eyebrow="You own this" title="This device">
        <ListCard inset={16}>
          <View className="min-h-14 flex-row items-center gap-3 px-4 py-3">
            <IconTile icon={<Smartphone size={16} color={palette.ink2} />} tone="accent" size={34} />
            <View className="min-w-0 flex-1">
              <Text className="text-[14.5px] leading-[20px] font-medium text-ink" numberOfLines={1}>
                {about?.device ?? 'This phone'}
              </Text>
              <Mono className="text-[11px]" numberOfLines={1}>
                paired with {desktopName}
              </Mono>
            </View>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Pair another device"
              accessibilityHint="Scan a code from the desktop, or enter a link"
              onPress={() => {
                void haptic('light')
                navigation.navigate('Pairing')
              }}
              className="min-h-9 flex-row items-center gap-1.5 rounded-sm border border-line px-3 active:bg-raised"
            >
              <QrCode size={14} color={palette.ink2} />
              <Text className="text-[12px] font-semibold text-ink-2">Pair</Text>
            </Pressable>
          </View>

          <Divider inset={16} />

          <View className="gap-1.5 px-4 py-3">
            <View className="flex-row items-center gap-3">
              <IconTile icon={<Monitor size={16} color={palette.ink2} />} tone="muted" size={34} />
              <Text className="min-w-0 flex-1 text-[13px] leading-[18px] text-ink-2">Device token</Text>
              <CopyButton
                value={deviceToken() ?? ''}
                label="Copy"
                accessibilityLabel="Copy this device's API token"
              />
            </View>
            <Text className="text-[11.5px] leading-[16px] text-ink-3" style={{ marginLeft: 46 }}>
              Bearer credential for this phone. Revoke it from System → Remote access if the device
              is lost.
            </Text>
          </View>
        </ListCard>
      </Section>

      {/* ── About ───────────────────────────────────────────────────── */}
      <Section enterIndex={3} eyebrow="Colophon" title="About">
        <ListCard inset={16}>
          <View className="flex-row items-center gap-3 px-4 py-4">
            <BrandLockup size={22} />
            <View style={{ flex: 1 }} />
            <Mono className="text-[11px] text-ink-3">
              v{Application.nativeApplicationVersion ?? '1.0'}
            </Mono>
          </View>
          <Divider inset={16} />
          <View className="px-4 py-3">
            <Text className="text-[12.5px] leading-[18px] text-ink-3">
              QAI is the mobile command centre for the coding agents running on your desktop —
              start, steer, approve and inspect from anywhere on your network or tailnet.
              {about?.desktopVersion ? ` Daemon v${about.desktopVersion}.` : ''}
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
          <Text className="px-1 text-[12px] leading-[17px] text-ink-3">
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
