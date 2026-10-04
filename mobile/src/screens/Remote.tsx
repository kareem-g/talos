/**
 * Portal — the computer, its screens and its applications.
 *
 * The home for remote view and control, built as a first-class capability
 * beside Sessions and Agents and reachable from the Home screen without opening
 * a session. It shows the real machine (name, OS, session type), the permission
 * state, the enable gate, multi-monitor and per-application targets discovered
 * from the actual desktop, and the live sessions with a terminate control.
 * Nothing here is hardcoded: an empty applications list means the daemon
 * genuinely reported no windows.
 */

import * as React from 'react'
import { RefreshControl, ScrollView, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'

import { remoteControlApi, ApiError } from '@/lib/api'
import { useStore } from '@/store'
import type { RootStack } from '../navigation'
import type {
  DisplayInfo,
  RemoteHostView,
  RemoteSessionInfo,
  RemoteTargetsView,
  WindowInfo,
} from '@/types/remoteView'
import { targetKey } from '@/types/remoteView'
import { Btn, Card, Dot, Empty, Label, Loader, Notice, Pill, Row, SectionHead, Tap, Text } from '../ui'
import { color } from '../design/tokens'
import { ChevronRight, Monitor, Refresh } from '../design/icons'
import { haptic } from '../lib/haptics'

export function RemoteScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStack>>()
  const insets = useSafeAreaInsets()
  const connection = useStore((s) => s.connection)
  const desktopName = useStore((s) => s.desktopName)
  const sessions = useStore((s) => s.sessions)

  // Agent-aware view: the projects this phone's sessions are working in, by
  // basename. Used only to mark a window whose *own* working directory matches —
  // real evidence, never a guess.
  const projectNames = React.useMemo(() => {
    const names = new Set<string>()
    for (const session of sessions) {
      if (!session.project) continue
      const base = session.project.split('/').filter(Boolean).pop()
      if (base) names.add(base)
    }
    return names
  }, [sessions])

  const [host, setHost] = React.useState<RemoteHostView | null>(null)
  const [targets, setTargets] = React.useState<RemoteTargetsView | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [refreshing, setRefreshing] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState(false)

  const load = React.useCallback(async (mode: 'initial' | 'refresh') => {
    if (mode === 'initial') setLoading(true)
    else setRefreshing(true)
    try {
      const [hostView, targetsView] = await Promise.all([
        remoteControlApi.host(),
        remoteControlApi.targets(),
      ])
      setHost(hostView)
      setTargets(targetsView)
      setError(null)
    } catch (cause) {
      const message = cause instanceof ApiError ? cause.message : 'Could not reach the desktop'
      setError(message)
    } finally {
      setLoading(false)
      setRefreshing(false)
    }
  }, [])

  React.useEffect(() => {
    void load('initial')
  }, [load])

  const online = connection === 'connected'
  const enabled = host?.enabled ?? false
  const permissions = host?.permissions ?? targets?.permissions
  const needsPermission = permissions ? !permissionUsable(permissions) : false
  const activeSessions: RemoteSessionInfo[] = host?.active_sessions ?? []
  const projectWindow = (targets?.windows ?? []).find(
    (window) => window.project && projectNames.has(window.project),
  )

  const toggle = async (next: boolean) => {
    setBusy(true)
    void haptic('select')
    try {
      await remoteControlApi.enable(next)
      await load('refresh')
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'Could not change the setting')
    } finally {
      setBusy(false)
    }
  }

  const open = (targetKeyValue: string, label: string) => {
    navigation.navigate('RemoteView', { targetKey: targetKeyValue, label })
  }

  const terminate = async (id: string) => {
    void haptic('light')
    try {
      await remoteControlApi.terminate(id)
      await load('refresh')
    } catch {
      // The list refresh below reflects reality either way.
      void load('refresh')
    }
  }

  return (
    <View className="flex-1 bg-canvas">
      <ScrollView
        className="flex-1 bg-canvas"
        contentContainerStyle={{ paddingBottom: insets.bottom + 110 }}
        showsVerticalScrollIndicator={false}
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={() => void load('refresh')}
            tintColor={color.ink3}
          />
        }
      >
        <View className="flex-row items-end justify-between px-5" style={{ paddingTop: insets.top + 16 }}>
          <View>
            <Text className="text-[33px] font-bold leading-[37px] text-ink" style={{ letterSpacing: -0.5 }}>
              Portal
            </Text>
            <View className="mt-1.5 flex-row items-center gap-1.5">
              <Dot tone={online ? 'green' : 'red'} size={6} pulse={online} />
              <Text className="text-[14px] text-ink-2">
                {desktopName || 'Desktop'} · {online ? 'Online' : 'Offline'}
              </Text>
            </View>
          </View>
          <Tap
            accessibilityRole="button"
            accessibilityLabel="Refresh"
            onPress={() => void load('refresh')}
            hitSlop={8}
            className="size-9 items-center justify-center rounded-full bg-field"
          >
            <Refresh size={16} color={color.ink2} />
          </Tap>
        </View>

        {error ? <Notice message={error} tone="error" onClose={() => setError(null)} /> : null}

        {loading && !host ? (
          <View className="items-center py-16">
            <Loader label="Reading this computer" />
          </View>
        ) : null}

        {/* A failed load must never be a blank page: if the computer could not
            be read, say so and offer a retry rather than an empty screen. */}
        {!loading && !host ? (
          <Empty
            title="Could not reach the computer"
            note={error ?? 'The daemon did not answer. Check that it is running and this phone can reach it.'}
            action={<Btn kind="primary" label="Try again" onPress={() => void load('initial')} />}
          />
        ) : null}

        {host ? (
          <>
            {/* Machine + gate */}
            <Label>Computer</Label>
            <Card>
              <View className="min-h-[54px] flex-row items-center gap-3 px-4 py-3">
                <View className="size-9 shrink-0 items-center justify-center rounded-[10px] bg-accent-tint">
                  <Monitor size={18} color={color.accent} />
                </View>
                <View className="min-w-0 flex-1">
                  <Text className="text-[15.5px] font-semibold text-ink" numberOfLines={1}>
                    {host.host.name}
                  </Text>
                  <Text className="mt-0.5 text-[13px] text-ink-2" numberOfLines={1}>
                    {host.host.platform_label} · {host.host.session_label} · AgentDeck {host.host.version}
                  </Text>
                </View>
                <Pill label={enabled ? 'Enabled' : 'Off'} tone={enabled ? 'green' : 'dim'} />
              </View>
              <View className="border-t border-line px-4 py-3">
                <Text className="text-[12.5px] leading-[18px] text-ink-2">
                  {enabled
                    ? 'This phone can view and control the computer while this is on. Turn it off to end every session immediately.'
                    : 'Remote control is off. Turn it on to view and control this computer from your phone.'}
                </Text>
                <View className="mt-3">
                  <Btn
                    kind={enabled ? 'plate' : 'primary'}
                    label={enabled ? 'Turn off remote control' : 'Turn on remote control'}
                    loading={busy}
                    onPress={() => void toggle(!enabled)}
                  />
                </View>
              </View>
              {activeSessions.length > 0 ? (
                <View className="border-t border-line px-4 py-3">
                  <View className="flex-row items-center gap-2">
                    <Dot tone="green" size={7} pulse />
                    <Text className="text-[13px] font-semibold text-ink">Remote Control Active</Text>
                  </View>
                  {activeSessions.map((session) => (
                    <View key={session.id} className="mt-2 flex-row items-center gap-2">
                      <Text className="min-w-0 flex-1 text-[12.5px] text-ink-2" numberOfLines={1}>
                        {session.device_name} · {session.target_label}
                        {session.width > 0 ? ` · ${session.width}×${session.height}` : ''}
                      </Text>
                      <Btn kind="danger" label="End" size="sm" onPress={() => void terminate(session.id)} />
                    </View>
                  ))}
                </View>
              ) : null}
              {projectWindow ? (
                <View className="border-t border-line px-4 py-3">
                  <Text className="text-[12.5px] leading-[18px] text-ink-2">
                    An agent session is working in <Text className="font-semibold text-ink">{projectWindow.project}</Text>.
                  </Text>
                  <View className="mt-2.5">
                    <Btn
                      kind="primary"
                      label={`Open ${projectWindow.app_name} in Portal`}
                      onPress={() => open(targetKey({ kind: 'window', id: projectWindow.id }), projectWindow.app_name)}
                    />
                  </View>
                </View>
              ) : null}
            </Card>

            {needsPermission && permissions ? (
              <>
                <Label>Permission</Label>
                <Card>
                  <View className="px-4 py-3">
                    <Text className="text-[12.5px] leading-[18px] text-ink-2">
                      {permissions.message ?? 'This computer needs permission before it can be shared.'}
                    </Text>
                    {permissions.settings_hint ? (
                      <Text className="mt-1.5 text-[12px] leading-[17px] text-ink-3">{permissions.settings_hint}</Text>
                    ) : null}
                    <View className="mt-3">
                      <Btn
                        kind="plate"
                        label="Open settings"
                        onPress={() => {
                          void remoteControlApi.openPermissions().catch(() => undefined)
                        }}
                      />
                    </View>
                  </View>
                </Card>
              </>
            ) : null}

            {/* Desktop */}
            {host.capabilities.full_desktop ? (
              <>
                <SectionHead title="Desktop" />
                <Card>
                  <Row
                    first
                    onPress={() => open('desktop', 'Desktop')}
                    a11yLabel="Open full desktop"
                    a11yState={{ disabled: !enabled }}
                  >
                    <View className="size-9 shrink-0 items-center justify-center rounded-[10px] bg-field">
                      <Monitor size={18} color={color.ink} />
                    </View>
                    <View className="min-w-0 flex-1">
                      <Text className="text-[15.5px] text-ink">Entire desktop</Text>
                      <Text className="mt-0.5 text-[13px] text-ink-2">
                        {host.capabilities.multi_display ? 'All monitors' : 'Full screen'}
                      </Text>
                    </View>
                    <ChevronRight size={16} color={color.ink3} />
                  </Row>
                  {(targets?.displays ?? []).map((display, index) => (
                    <Row
                      key={display.id}
                      onPress={() => open(targetKey({ kind: 'display', id: display.id }), display.name)}
                      a11yLabel={`Open ${display.name}`}
                    >
                      <View className="size-9 shrink-0 items-center justify-center rounded-[10px] bg-field">
                        <Text className="text-[13px] font-semibold text-ink-2">{index + 1}</Text>
                      </View>
                      <View className="min-w-0 flex-1">
                        <Text className="text-[15.5px] text-ink" numberOfLines={1}>
                          {display.name}
                          {display.primary ? ' · Primary' : ''}
                        </Text>
                        <Text className="mt-0.5 text-[13px] text-ink-2">
                          {display.width}×{display.height}
                        </Text>
                      </View>
                      <ChevronRight size={16} color={color.ink3} />
                    </Row>
                  ))}
                </Card>
              </>
            ) : null}

            {/* Applications */}
            <SectionHead
              title="Applications"
              count={targets?.windows.length ?? 0}
              trailing={
                <Tap
                  accessibilityRole="button"
                  accessibilityLabel="Refresh applications"
                  onPress={() => void load('refresh')}
                  hitSlop={8}
                  className="flex-row items-center gap-1"
                >
                  <Refresh size={14} color={color.ink3} />
                  <Text className="text-[12.5px] text-ink-3">Refresh</Text>
                </Tap>
              }
            />
            {host.capabilities.app_view ? (
              (targets?.windows ?? []).length === 0 ? (
                <Empty
                  title="No applications detected"
                  note={
                    host.host.session_kind === 'wayland'
                      ? 'On Wayland, window capture is granted by the desktop’s own picker when you start a session.'
                      : 'Open an application on the computer, then refresh.'
                  }
                />
              ) : (
                <Card>
                  {(targets?.windows ?? []).map((window, index) => (
                    <WindowRow
                      key={window.id}
                      window={window}
                      first={index === 0}
                      isProject={!!window.project && projectNames.has(window.project)}
                      onPress={open}
                    />
                  ))}
                </Card>
              )
            ) : (
              <Empty
                title="Application view unavailable"
                note="This session cannot enumerate application windows."
              />
            )}
          </>
        ) : null}
      </ScrollView>
    </View>
  )
}

function WindowRow({
  window,
  first,
  isProject,
  onPress,
}: {
  window: WindowInfo
  first: boolean
  isProject: boolean
  onPress: (target: string, label: string) => void
}) {
  const subtitle = [window.title !== window.app_name ? window.title : null, window.project, window.process]
    .filter(Boolean)
    .join(' · ')
  return (
    <Row
      first={first}
      onPress={() => onPress(targetKey({ kind: 'window', id: window.id }), window.app_name)}
      a11yLabel={`Open ${window.app_name}`}
    >
      <View className="size-9 shrink-0 items-center justify-center rounded-[10px] bg-field">
        <Text className="text-[13px] font-semibold text-ink-2">{initials(window.app_name)}</Text>
      </View>
      <View className="min-w-0 flex-1">
        <Text className="text-[15.5px] text-ink" numberOfLines={1}>
          {window.app_name}
        </Text>
        {subtitle ? (
          <Text className="mt-0.5 text-[13px] text-ink-2" numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {isProject ? <Pill label="Project" tone="accent" /> : null}
      {window.minimized ? <Pill label="Minimized" tone="dim" /> : null}
      <ChevronRight size={16} color={color.ink3} />
    </Row>
  )
}

function initials(name: string): string {
  const cleaned = name.replace(/[^A-Za-z0-9 ]/g, ' ').trim()
  const words = cleaned.split(/\s+/).filter(Boolean)
  if (words.length === 0) return '•'
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return (words[0][0] + words[1][0]).toUpperCase()
}

function permissionUsable(report: { screen_recording: string; accessibility: string }): boolean {
  return report.screen_recording !== 'denied' && report.accessibility !== 'denied'
}

export type { DisplayInfo }