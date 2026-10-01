/**
 * Configuration — the desktop's Configuration page, mobile shape.
 *
 * QAI · WARM STUDIO
 * -----------------
 * The desktop groups everything daemon-owned under one Configuration
 * destination; the phone does the same. What this device owns comes first
 * (its route to the daemon, its alerts, its identity), then the daemon-owned
 * destinations as navigation rows (MCP servers, remote access, daemon
 * settings), then the station's standalone terminals inline — a short list
 * with one verb each does not deserve its own page. Danger last, because it
 * is irreversible.
 */

import * as React from 'react'
import {Pressable, View} from 'react-native'
import { Text } from '@app/components/Text'
import { useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { Bell, ChevronRight, Monitor, Plus, QrCode, Server, Settings2, Smartphone, Trash2, Wifi } from 'lucide-react-native'
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
import { formatLatency, probeRoutes, type RouteProbe } from '@app/lib/routeProbe'
import { deviceToken, pairingApi, terminalsApi } from '@app/lib/api'
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
  ErrorState,
  Field,
  FieldRow,
  IconButton,
  IconTile,
  ListRow,
  Mono,
  Notice,
  RowSkeleton,
  haptic,
  toast,
} from '@app/components/ui'
import { DrawerButton } from '@app/components/Drawer'

const PERMISSION_LABEL: Record<PermissionState, string> = {
  granted: 'Allowed',
  denied: 'Blocked in system settings',
  undetermined: 'Not requested yet',
}

export function ConfigScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const desktopName = useStore((s) => s.desktopName)
  const connection = useStore((s) => s.connection)
  const [perm, setPerm] = React.useState<PermissionState>('undetermined')
  const [note, setNote] = React.useState<string | null>(null)
  const [routes, setRoutes] = React.useState<string[]>(() => deviceRoutes())
  const [probes, setProbes] = React.useState<Record<string, RouteProbe>>({})
  const [refreshing, setRefreshing] = React.useState(false)
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

  /**
   * Time every advertised route.
   *
   * Run on mount and on pull-to-refresh rather than on a timer: a latency that
   * updates while you are looking at it invites you to watch it instead of
   * choosing, and the number only has to be right at the moment of the decision.
   */
  const measure = React.useCallback(async () => {
    const results = await probeRoutes()
    const next: Record<string, RouteProbe> = {}
    for (const result of results) next[result.route] = result
    setProbes(next)
  }, [])

  React.useEffect(() => {
    void measure()
  }, [measure])

  /**
   * Pull to re-measure.
   *
   * The reading is a snapshot, and the moment you want a fresh one is the
   * moment you have moved — into a lift, onto a tailnet, off wifi — so the
   * gesture is the natural clock rather than a timer that ticks while you read.
   */
  async function refresh() {
    setRefreshing(true)
    await measure()
    setRefreshing(false)
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
      onRefresh={() => void refresh()}
      refreshing={refreshing}
      title="Device"
      eyebrow={`QAI · ${desktopName}`}
      subtitle="This phone talks only to your own daemon. Nothing is sent anywhere else."
      scroll
      contentClassName="pb-12 gap-6"
      headerLeft={<DrawerButton />}
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
              className="min-w-0 flex-1 text-[13.5px] leading-[19px] font-medium text-ink"
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
              <Text className="text-[12.5px] leading-[17px] text-ink-3">This device is not paired.</Text>
            </View>
          ) : (
            <View>
              <Text className="px-4 pb-2 pt-3 text-[11.5px] leading-[16px] text-ink-3">
                Tap a route to pin it — the reading beside each one is a live round-trip. Left
                alone, the app moves on by itself when the active route stops answering.
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
                      <Dot
                        tone={
                          probes[route] === undefined || probes[route].ms !== null
                            ? isActive
                              ? 'ok'
                              : 'muted'
                            : 'danger'
                        }
                      />
                      <Mono className="min-w-0 flex-1 text-[12px] leading-[17px] text-ink" numberOfLines={1}>
                        {route}
                      </Mono>
                      {/* The number that makes three URLs a choice: a route that
                          answers in 4ms and one that answers in 900ms behave
                          very differently when you are standing in a lift. */}
                      <Mono
                        className="text-[10.5px]"
                        style={{
                          color:
                            probes[route] === undefined
                              ? palette.ink4
                              : probes[route].ms === null
                                ? palette.danger
                                : palette.ink3,
                        }}
                      >
                        {probes[route] === undefined ? '…' : formatLatency(probes[route].ms)}
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
            <Text className="min-w-0 flex-1 text-[13.5px] leading-[19px] font-medium text-ink">
              {PERMISSION_LABEL[perm]}
            </Text>
            <Badge tone={perm === 'granted' ? 'ok' : 'muted'} outline mono>
              {perm === 'granted' ? 'on' : 'off'}
            </Badge>
          </View>
          <View className="gap-3 px-4 py-3.5">
            <Text className="text-[12.5px] leading-[17px] text-ink-2">
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
            <Text className="text-[11px] leading-[15px] text-ink-3">
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

      {/* ── Daemon-owned destinations ───────────────────────────────── */}
      <Section enterIndex={2} eyebrow="Managed on the desktop" title="Daemon">
        <ListCard inset={64}>
          <Destination
            title="MCP servers"
            subtitle="External tools this desktop can call"
            icon={<Server size={16} color={palette.ink2} />}
            onPress={() => navigation.navigate('Mcp')}
          />
          <Destination
            title="Remote access"
            subtitle="Tunnels, endpoints and paired devices"
            icon={<Wifi size={16} color={palette.ink2} />}
            onPress={() => navigation.navigate('Remote')}
          />
          <Destination
            title="Daemon settings"
            subtitle="Read and edit the daemon's own configuration"
            icon={<Settings2 size={16} color={palette.ink2} />}
            onPress={() => navigation.navigate('Daemon')}
          />
        </ListCard>
      </Section>

      {/* ── Standalone terminals (inline) ───────────────────────────────
          Station-level PTYs the daemon owns (`term-*`), created with a working
          directory and closed here. I/O for these lives on the desktop; what
          the phone can honestly do is create, list and close. */}
      <Section enterIndex={3} eyebrow="Managed on the desktop" title="Terminals">
        <TerminalsSection />
      </Section>

      {/* ── This device ─────────────────────────────────────────────── */}
      <Section enterIndex={4} eyebrow="You own this" title="This device">
        <ListCard inset={16}>
          <View className="min-h-14 flex-row items-center gap-3 px-4 py-3">
            <IconTile icon={<Smartphone size={16} color={palette.ink2} />} tone="accent" size={34} />
            <View className="min-w-0 flex-1">
              <Text className="text-[13.5px] leading-[19px] font-medium text-ink" numberOfLines={1}>
                {about?.device ?? 'This phone'}
              </Text>
              <Mono className="text-[10.5px]" numberOfLines={1}>
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
              className="min-h-9 flex-row items-center gap-1.5 rounded-md border border-line px-3 active:bg-raised"
            >
              <QrCode size={14} color={palette.ink2} />
              <Text className="text-[12px] font-semibold text-ink-2">Pair</Text>
            </Pressable>
          </View>

          <Divider inset={16} />

          <View className="gap-1.5 px-4 py-3">
            <View className="flex-row items-center gap-3">
              <IconTile icon={<Monitor size={16} color={palette.ink2} />} tone="muted" size={34} />
              <Text className="min-w-0 flex-1 text-[12.5px] leading-[17px] text-ink-2">Device token</Text>
              <CopyButton
                value={deviceToken() ?? ''}
                label="Copy"
                accessibilityLabel="Copy this device's API token"
              />
            </View>
            <Text className="text-[11px] leading-[15px] text-ink-3" style={{ marginLeft: 46 }}>
              Bearer credential for this phone. Revoke it from Remote access if the device is lost.
            </Text>
          </View>
        </ListCard>
      </Section>

      {/* ── About ───────────────────────────────────────────────────── */}
      <Section enterIndex={5} eyebrow="Colophon" title="About">
        <ListCard inset={16}>
          <View className="flex-row items-center gap-3 px-4 py-4">
            <BrandLockup size={22} />
            <View style={{ flex: 1 }} />
            <Mono className="text-[10.5px] text-ink-3">
              v{Application.nativeApplicationVersion ?? '1.0'}
            </Mono>
          </View>
          <Divider inset={16} />
          <View className="px-4 py-3">
            <Text className="text-[12px] leading-[17px] text-ink-3">
              QAI is the mobile command centre for the coding agents running on your desktop —
              start, steer, approve and inspect from anywhere on your network or tailnet.
              {about?.desktopVersion ? ` Daemon v${about.desktopVersion}.` : ''}
            </Text>
          </View>
        </ListCard>
      </Section>

      {/* ── Danger ──────────────────────────────────────────────────── */}
      <Section enterIndex={6} eyebrow="Irreversible" title="Danger zone">
        <View className="gap-2.5">
          <Button
            variant="danger"
            label="Unpair this device"
            accessibilityLabel="Unpair this device"
            full
            onPress={() => setConfirmUnpair(true)}
          />
          <Text className="px-1 text-[11.5px] leading-[16px] text-ink-3">
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

/* ── A row that goes somewhere ───────────────────────────────────────────────
 * The muted icon tile and the chevron together are the whole visual vocabulary
 * of "this is navigation, not a value". */

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
      leading={<IconTile icon={icon} tone="accent" size={34} />}
      trailing={<ChevronRight size={16} color={palette.ink4} />}
      onPress={() => {
        void haptic('light')
        onPress()
      }}
      accessibilityLabel={title}
      accessibilityHint={subtitle}
    />
  )
}

/* ── Terminals ──────────────────────────────────────────────────────────────── */

function TerminalsSection() {
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

  React.useEffect(() => {
    void load()
  }, [load])

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
    <ListCard inset={16}>
      <View className="gap-2 px-4 py-3">
        {error ? <ErrorState message={error} onRetry={() => void load()} /> : null}
        {terminals === null && !error ? <RowSkeleton /> : null}
        {terminals !== null && terminals.length === 0 ? (
          <Text className="text-[12px] leading-[16px] text-ink-3">No standalone terminals are open.</Text>
        ) : null}
        {(terminals ?? []).map((terminal) => (
          <View
            key={terminal.id}
            className="flex-row items-center gap-3 rounded-lg border border-line bg-field py-2 pl-3.5 pr-1.5"
          >
            <Dot tone="ok" />
            <View className="min-w-0 flex-1">
              <Mono className="text-[11.5px] text-ink" numberOfLines={1}>
                {terminal.id}
              </Mono>
              {terminal.cwd ? (
                <Mono className="mt-0.5 text-[10px] text-ink-3" numberOfLines={1}>
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
    </ListCard>
  )
}
