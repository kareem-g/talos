/**
 * Drawer — the desktop AppNav, as the mobile navigation drawer.
 *
 * ONE-TO-ONE WITH THE DESKTOP RAIL
 * --------------------------------
 * The desktop's mobile shell opens its left rail as an overlay drawer, and
 * this is that drawer ported section for section: brand header, the "New
 * task" primary action, grouped destinations under uppercase micro-labels
 * (Get started / Products / Manage), a live History list of the newest
 * sessions, a Quick Access footer (API key, agent setup, documentation) and
 * the device card with the connection truth and the pair action.
 *
 * It is mounted once at the app root (`DrawerHost`) and opened through the
 * `lib/drawer` emitter, so any screen's menu button reaches the same drawer.
 * Navigation goes through the root navigation ref — the drawer outlives every
 * screen it navigates from.
 */

import * as React from 'react'
import {
  Animated,
  Linking,
  Modal,
  PanResponder,
  Pressable,
  ScrollView,
  View,
  useWindowDimensions,
} from 'react-native'
import { Text } from '@app/components/Text'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import {
  BarChart3,
  BookOpen,
  Bot,
  ChevronRight,
  Globe,
  History as HistoryIcon,
  Home,
  KeyRound,
  Menu,
  Monitor,
  Plug,
  Plus,
  Smartphone,
  SlidersHorizontal,
  Users,
  Wrench,
  X,
} from 'lucide-react-native'
import { setClipboardString } from '@app/lib/clipboard'

import { cn } from '@/lib/format'
import { isInternalSession } from '@/lib/sessionState'
import type { ConnectionState } from '@/types/protocol'
import { navigationRef } from '@app/lib/navigationRef'
import { useStore } from '@app/store'
import { deviceToken } from '@app/lib/api'
import { openNewTask } from '@app/lib/newTask'
import { openDrawer, setDrawerListener } from '@app/lib/drawer'
import { EASE_OUT } from '@app/components/motion'
import { palette, shadowOverlay, spring } from '@app/design/tokens'
import { BrandMark, Dot, IconButton, Mono, haptic, toast } from '@app/components/ui'

const DOCS_URL = 'https://github.com/kareem-g/agentdeck-linux'

/* ── Rail vocabulary ─────────────────────────────────────────────────────────── */

/** Uppercase micro-label — the rail's section headers (desktop `NavLabel`). */
function NavLabel({ children }: { children: string }) {
  return (
    <Text
      className="px-3 pb-1.5 pt-5 text-[9px] font-medium uppercase text-ink-3"
      style={{ letterSpacing: 1.6, fontFamily: 'monospace' }}
    >
      {children}
    </Text>
  )
}

function NavItem({
  icon,
  label,
  active,
  chevron,
  onPress,
}: {
  icon: React.ReactNode
  label: string
  active?: boolean
  chevron?: boolean
  onPress: () => void
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ selected: !!active }}
      onPress={onPress}
      className={cn(
        'min-h-[36px] flex-row items-center gap-2.5 rounded-md px-3 py-[7px]',
        active ? 'bg-accent-soft' : 'active:bg-raised',
      )}
      style={active ? { borderWidth: 1, borderColor: palette.accentBorder } : undefined}
    >
      <View className="shrink-0">{icon}</View>
      <Text
        className={cn('min-w-0 flex-1 text-[12.5px]', active ? 'font-semibold text-ink' : 'text-ink-2')}
        numberOfLines={1}
      >
        {label}
      </Text>
      {chevron ? <ChevronRight size={12} color={palette.ink3} /> : null}
    </Pressable>
  )
}

/** Compact day label for the rail's History rows: Today / Yesterday / Nd / date. */
function relativeDay(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const now = new Date()
  const startOfDay = (value: Date) => new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime()
  const days = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000)
  if (days <= 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days}d`
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' })
}

function connectionDotTone(state: ConnectionState): 'ok' | 'wait' | 'danger' {
  if (state === 'connected') return 'ok'
  if (state === 'connecting' || state === 'reconnecting') return 'wait'
  return 'danger'
}

function connectionLabel(state: ConnectionState): string {
  switch (state) {
    case 'connected':
      return 'Connected to daemon'
    case 'connecting':
      return 'Connecting…'
    case 'reconnecting':
      return 'Reconnecting…'
    case 'unauthorized':
      return 'Not paired'
    case 'error':
      return 'Connection error'
    default:
      return 'Offline'
  }
}

/* ── The drawer ──────────────────────────────────────────────────────────────── */

export function DrawerHost() {
  const insets = useSafeAreaInsets()
  const { width: screenWidth } = useWindowDimensions()
  const [open, setOpen] = React.useState(false)
  const [mounted, setMounted] = React.useState(false)
  const progress = React.useRef(new Animated.Value(0)).current

  const sessions = useStore((state) => state.sessions)
  const connection = useStore((state) => state.connection)
  const desktopName = useStore((state) => state.desktopName)
  const loadPending = useStore((state) => state.loadPending)

  React.useEffect(() => {
    setDrawerListener(() => {
      setMounted(true)
      setOpen(true)
    })
    return () => setDrawerListener(null)
  }, [])

  React.useEffect(() => {
    if (open) {
      // A fresh drawer shows fresh truth: the pending count drives badges the
      // moment the rail is on screen.
      void loadPending()
      Animated.spring(progress, { toValue: 1, useNativeDriver: true, ...spring.overlay }).start()
    } else if (mounted) {
      Animated.timing(progress, {
        toValue: 0,
        duration: 200,
        easing: EASE_OUT,
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) setMounted(false)
      })
    }
  }, [open, mounted, progress, loadPending])

  // Swipe left on the panel (or right from its edge) dismisses — the mirror of
  // the gesture that conceptually opened it.
  const pan = React.useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_e, gesture) => gesture.dx < -8 && Math.abs(gesture.dx) > Math.abs(gesture.dy),
        onPanResponderMove: (_e, gesture) => {
          progress.setValue(Math.max(0, Math.min(1, 1 + gesture.dx / 260)))
        },
        onPanResponderRelease: (_e, gesture) => {
          if (gesture.dx < -60 || gesture.vx < -0.4) setOpen(false)
          else Animated.spring(progress, { toValue: 1, useNativeDriver: true, ...spring.overlay }).start()
        },
        onPanResponderTerminate: () =>
          Animated.spring(progress, { toValue: 1, useNativeDriver: true, ...spring.overlay }).start(),
      }),
    [progress],
  )

  if (!mounted) return null

  const panelWidth = Math.min(300, Math.round(screenWidth * 0.84))

  function close() {
    setOpen(false)
  }

  function goTab(tab: 'Deck' | 'Sessions' | 'Station' | 'Device') {
    close()
    // The union-typed `screen` needs the same cast the rest of the app uses
    // for tab targeting; the literals above are checked by hand.
    if (navigationRef.isReady()) navigationRef.navigate('Main', { screen: tab } as never)
  }

  function goStack(name: 'Pairing' | 'Mcp' | 'Remote' | 'Daemon' | 'Agents' | 'Browsers' | 'Usage' | 'Providers' | 'Rooms') {
    close()
    if (navigationRef.isReady()) navigationRef.navigate(name)
  }

  function goSession(sessionId: string) {
    close()
    if (navigationRef.isReady()) navigationRef.navigate('Session', { sessionId })
  }

  const history = sessions
    .filter((session) => session.status !== 'archived' && !isInternalSession(session))
    .slice()
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    .slice(0, 30)

  const iconColor = palette.ink3
  const activeIcon = palette.accent

  return (
    <Modal transparent visible animationType="none" statusBarTranslucent onRequestClose={close}>
      <View style={{ flex: 1, flexDirection: 'row' }}>
        {/* Scrim */}
        <Animated.View style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: palette.scrim, opacity: progress }}>
          <Pressable accessibilityRole="button" accessibilityLabel="Close navigation" onPress={close} style={{ flex: 1 }} />
        </Animated.View>

        {/* Panel */}
        <Animated.View
          {...pan.panHandlers}
          accessibilityViewIsModal
          style={{
            width: panelWidth,
            paddingTop: insets.top,
            paddingBottom: Math.max(insets.bottom, 8),
            backgroundColor: palette.chrome,
            borderRightWidth: 1,
            borderRightColor: palette.line,
            transform: [
              {
                translateX: progress.interpolate({ inputRange: [0, 1], outputRange: [-panelWidth, 0] }),
              },
            ],
            ...shadowOverlay,
          }}
        >
          {/* Brand */}
          <View className="h-14 shrink-0 flex-row items-center justify-between border-b border-line px-3">
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
              <BrandMark size={20} />
              <Text className="text-[14px] font-semibold text-ink" style={{ letterSpacing: 0.4 }}>
                QAI
              </Text>
            </View>
            <IconButton label="Close navigation" size={32} onPress={close}>
              <X size={16} color={palette.ink3} />
            </IconButton>
          </View>

          {/* New task — the rail's primary action, always one tap away. */}
          <View className="px-3 pt-3">
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="New task"
              onPress={() => {
                void haptic('medium')
                close()
                openNewTask()
              }}
              className="h-9 flex-row items-center justify-center gap-1.5 rounded-md border border-line bg-surface active:bg-raised"
            >
              <Plus size={14} color={palette.ink} strokeWidth={2.2} />
              <Text className="text-[12.5px] font-medium text-ink">New task</Text>
            </Pressable>
          </View>

          <ScrollView
            className="flex-1"
            contentContainerStyle={{ paddingBottom: 12 }}
            showsVerticalScrollIndicator={false}
          >
            <NavLabel>Get started</NavLabel>
            <View className="gap-px px-1.5">
              <NavItem icon={<Home size={14} color={iconColor} strokeWidth={1.8} />} label="Deck" onPress={() => goTab('Deck')} />
            </View>

            <NavLabel>Products</NavLabel>
            <View className="gap-px px-1.5">
              <NavItem icon={<Bot size={14} color={iconColor} strokeWidth={1.8} />} label="Agents" onPress={() => goStack('Agents')} />
              <NavItem icon={<Globe size={14} color={iconColor} strokeWidth={1.8} />} label="Browsers" onPress={() => goStack('Browsers')} />
              <NavItem icon={<Plug size={14} color={iconColor} strokeWidth={1.8} />} label="API providers" onPress={() => goStack('Providers')} />
              <NavItem icon={<Users size={14} color={iconColor} strokeWidth={1.8} />} label="Rooms" onPress={() => goStack('Rooms')} />
            </View>

            <NavLabel>Manage</NavLabel>
            <View className="gap-px px-1.5">
              <NavItem icon={<HistoryIcon size={14} color={iconColor} strokeWidth={1.8} />} label="Sessions" onPress={() => goTab('Sessions')} />
              <NavItem icon={<BarChart3 size={14} color={iconColor} strokeWidth={1.8} />} label="Usage" onPress={() => goStack('Usage')} />
              <NavItem
                icon={<SlidersHorizontal size={14} color={iconColor} strokeWidth={1.8} />}
                label="Station"
                chevron
                onPress={() => goTab('Station')}
              />
              <NavItem
                icon={<SlidersHorizontal size={14} color={iconColor} strokeWidth={1.8} />}
                label="Device & settings"
                chevron
                onPress={() => goTab('Device')}
              />
            </View>

            <NavLabel>History</NavLabel>
            <View className="gap-px px-1.5">
              {history.length === 0 ? (
                <Text className="px-3 py-2 text-[11px] leading-[16px] text-ink-3">
                  No sessions yet. Create a task from Home.
                </Text>
              ) : (
                history.map((session) => (
                  <Pressable
                    key={session.id}
                    accessibilityRole="button"
                    accessibilityLabel={session.name}
                    onPress={() => {
                      void haptic('light')
                      goSession(session.id)
                    }}
                    className="min-h-[34px] flex-row items-center gap-2 rounded-md px-3 py-[7px] active:bg-raised"
                  >
                    <Text className="min-w-0 flex-1 text-[12px] text-ink-2" numberOfLines={1}>
                      {session.name}
                    </Text>
                    <Mono className="shrink-0 text-[9px] text-ink-4">{relativeDay(session.updated_at)}</Mono>
                  </Pressable>
                ))
              )}
            </View>
          </ScrollView>

          {/* Quick Access + device card, pinned to the rail's bottom. */}
          <View className="shrink-0 border-t border-line">
            <NavLabel>Quick Access</NavLabel>
            <View className="gap-px px-1.5">
              <NavItem
                icon={<KeyRound size={14} color={iconColor} strokeWidth={1.8} />}
                label="API Key"
                onPress={() => {
                  setClipboardString(deviceToken() ?? '')
                  void haptic('success')
                  toast({ message: 'Device token copied', tone: 'ok' })
                }}
              />
              <NavItem
                icon={<Wrench size={14} color={iconColor} strokeWidth={1.8} />}
                label="Agent Setup"
                onPress={() => goStack('Agents')}
              />
              <NavItem
                icon={<BookOpen size={14} color={iconColor} strokeWidth={1.8} />}
                label="Documentation"
                onPress={() => void Linking.openURL(DOCS_URL).catch(() => undefined)}
              />
            </View>

            {/* Device identity — this app is local-first, so the card names the
                machine rather than an account: what this is, its link to the
                daemon, and the one action it offers (pair a device). */}
            <View className="px-3 py-3">
              <View
                className="rounded-lg border border-line bg-surface p-3"
              >
                <View className="flex-row items-center gap-2.5">
                  <View
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: 12,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: palette.accentSoft,
                    }}
                  >
                    <Monitor size={17} color={activeIcon} strokeWidth={1.8} />
                    <View
                      style={{
                        position: 'absolute',
                        bottom: -2,
                        right: -2,
                        width: 10,
                        height: 10,
                        borderRadius: 5,
                        backgroundColor: connectionDotTone(connection) === 'ok' ? palette.ok : connectionDotTone(connection) === 'wait' ? palette.wait : palette.danger,
                        borderWidth: 2,
                        borderColor: palette.surface,
                      }}
                    />
                  </View>
                  <View className="min-w-0 flex-1">
                    <Text className="text-[13px] font-semibold text-ink" numberOfLines={1} style={{ letterSpacing: -0.1 }}>
                      {desktopName || 'Local device'}
                    </Text>
                    <Text className="text-[10.5px] text-ink-3" numberOfLines={1}>
                      Paired desktop
                    </Text>
                  </View>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel="Pair a device"
                    onPress={() => {
                      void haptic('light')
                      goStack('Pairing')
                    }}
                    className="size-8 shrink-0 items-center justify-center rounded-full active:opacity-70"
                    style={{ backgroundColor: palette.accentSoft }}
                  >
                    <Smartphone size={14} color={activeIcon} />
                  </Pressable>
                </View>
                <View className="mt-2.5 flex-row items-center gap-2 rounded-lg border border-line bg-well px-2 py-1.5">
                  <Dot
                    tone={connectionDotTone(connection)}
                    pulse={connection === 'connecting' || connection === 'reconnecting'}
                  />
                  <Mono className="min-w-0 flex-1 text-[10px] text-ink-3" numberOfLines={1}>
                    {connectionLabel(connection)}
                  </Mono>
                </View>
              </View>
            </View>
          </View>
        </Animated.View>
      </View>
    </Modal>
  )
}

/** The top-bar menu button every tab page carries. */
export function DrawerButton() {
  return (
    <IconButton
      label="Open navigation"
      size={36}
      onPress={() => {
        void haptic('light')
        openDrawer()
      }}
    >
      <Menu size={19} color={palette.ink} />
    </IconButton>
  )
}
