/**
 * AppNav — the drawer rail, mirroring the desktop's `AppNav.tsx`.
 *
 * Same sections and labels in the same order (Get started / Products / Manage /
 * History / Quick access), same brand header, same "New task" primary action,
 * same rail micro-label typography, and the same device card at the bottom with
 * its connection dot. The desktop rail is a fixed 224px aside; on a phone it is
 * the same rail revealed as a drawer, which is exactly how the desktop's own
 * narrow-screen mode behaves (`AppShell.tsx` mobile: top bar + `w-64` drawer).
 */

import * as React from 'react'
import { ScrollView, Text, View, Pressable } from 'react-native'
import type { DrawerContentComponentProps } from '@react-navigation/drawer'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import Clipboard from '@react-native-clipboard/clipboard'
import {
  BarChart3,
  Bot,
  Globe,
  History as HistoryIcon,
  Home as HomeIcon,
  KeyRound,
  Settings as SettingsIcon,
  Smartphone,
  Wrench,
} from 'lucide-react-native'

import { useStore } from '@app/store'
import type { RootStackParamList, DrawerParamList } from '@app/navigation'
import { deviceToken } from '@app/lib/api'
import { cn } from '@/lib/format'
import { BrandMark, Button, Dot, IconButton, Mono, NavLabel } from '@app/components/ui'
import { NewTaskSheet } from '@app/components/NewTaskSheet'

/** Desktop `connectionDot`/label mapping, reused verbatim. */
function connectionTone(connection: string): 'green' | 'orange' | 'red' {
  if (connection === 'connected') return 'green'
  if (connection === 'connecting' || connection === 'reconnecting') return 'orange'
  return 'red'
}

function connectionLabel(connection: string, paired: boolean): string {
  if (!paired) return 'Not paired'
  switch (connection) {
    case 'connected':
      return 'Connected'
    case 'connecting':
      return 'Connecting'
    case 'reconnecting':
      return 'Reconnecting'
    case 'offline':
      return 'Offline'
    case 'unauthorized':
      return 'Access revoked'
    default:
      return 'Disconnected'
  }
}

export function AppNav({ navigation, state }: DrawerContentComponentProps) {
  const active = state.routeNames[state.index]
  const sessions = useStore((s) => s.sessions)
  const connection = useStore((s) => s.connection)
  const desktopName = useStore((s) => s.desktopName)
  const [copied, setCopied] = React.useState(false)
  const [newOpen, setNewOpen] = React.useState(false)

  // Sessions and the pairing gate are ROOT stack screens, pushed over the rail.
  // The drawer's own navigator only knows Home/Agents/History/Usage/Config, so
  // these have to go through the parent — navigating 'Session' here directly
  // would be an unhandled action at runtime.
  const root = navigation.getParent<NativeStackNavigationProp<RootStackParamList>>()
  const openSession = (sessionId: string) => {
    navigation.closeDrawer()
    root?.navigate('Session', { sessionId })
  }

  const go = (page: keyof DrawerParamList) => {
    navigation.navigate(page)
    navigation.closeDrawer()
  }

  const recent = React.useMemo(
    () => sessions.filter((s) => s.status !== 'archived').slice(0, 30),
    [sessions],
  )

  /**
   * "New task" opens the configured flow rather than starting a default run:
   * workspace, agent, prompt, model, thought level and permissions. Starting a
   * session in one tap is not what the desktop offers, and it is the reason the
   * phone could only ever launch a bare chat.
   */
  function newTask() {
    navigation.closeDrawer()
    setNewOpen(true)
  }

  function copyToken() {
    const token = deviceToken()
    if (!token) return
    Clipboard.setString(token)
    setCopied(true)
    setTimeout(() => setCopied(false), 1400)
  }

  return (
    <View className="flex-1 bg-sidebar">
      {/* Brand */}
      <View className="h-14 flex-row items-center gap-2.5 px-3.5">
        <BrandMark />
        <Text className="text-[15px] font-semibold text-ink">AgentDeck</Text>
      </View>

      <View className="px-2.5 pb-1">
        <Button variant="primary" label="New task" onPress={() => void newTask()} />
      </View>

      <ScrollView contentContainerClassName="pb-4">
        <NavLabel>Get started</NavLabel>
        <NavItem
          label="Home"
          icon={<HomeIcon size={15} color="#b0b0b6" />}
          active={active === 'Home'}
          onPress={() => go('Home')}
        />

        <NavLabel>Products</NavLabel>
        <NavItem
          label="Agents"
          icon={<Bot size={15} color="#b0b0b6" />}
          active={active === 'Agents'}
          onPress={() => go('Agents')}
        />
        <NavItem
          label="Browsers"
          icon={<Globe size={15} color="#b0b0b6" />}
          active={active === 'Browsers'}
          onPress={() => go('Browsers')}
        />

        <NavLabel>Manage</NavLabel>
        <NavItem
          label="History"
          icon={<HistoryIcon size={15} color="#b0b0b6" />}
          active={active === 'History'}
          onPress={() => go('History')}
        />
        <NavItem
          label="Usage"
          icon={<BarChart3 size={15} color="#b0b0b6" />}
          active={active === 'Usage'}
          onPress={() => go('Usage')}
        />
        <NavItem
          label="Configuration"
          icon={<SettingsIcon size={15} color="#b0b0b6" />}
          active={active === 'Config'}
          onPress={() => go('Config')}
        />

        {recent.length > 0 ? (
          <>
            <NavLabel>History</NavLabel>
            {recent.map((session) => (
              <NavItem
                key={session.id}
                label={session.name}
                mono
                onPress={() => openSession(session.id)}
              />
            ))}
          </>
        ) : null}

        <NavLabel>Quick access</NavLabel>
        <NavItem
          label={copied ? 'Copied' : 'API key'}
          icon={<KeyRound size={15} color="#b0b0b6" />}
          onPress={copyToken}
        />
        <NavItem
          label="Agent setup"
          icon={<Wrench size={15} color="#b0b0b6" />}
          onPress={() => go('Agents')}
        />
      </ScrollView>

      <NewTaskSheet
        open={newOpen}
        onClose={() => setNewOpen(false)}
        onCreated={(session) => openSession(session.id)}
      />

      {/* Device card */}
      <View className="border-t border-line p-2.5">
        <View className="flex-row items-center gap-3 rounded-xl bg-surface p-2.5">
          <View className="size-9 items-center justify-center rounded-lg bg-accent-tint">
            <Smartphone size={17} color="#5b8def" />
          </View>
          <View className="min-w-0 flex-1">
            <Text className="text-[12.5px] text-ink" numberOfLines={1}>
              This device
            </Text>
            <Mono className="text-[10.5px]" numberOfLines={1}>
              {desktopName}
            </Mono>
          </View>
          <IconButton
            label="Pair a device"
            onPress={() => {
              navigation.closeDrawer()
              root?.navigate('Pairing')
            }}
          >
            <Smartphone size={16} color="#b0b0b6" />
          </IconButton>
        </View>
        <View className="mt-2 flex-row items-center gap-2 px-1">
          <Dot tone={connectionTone(connection)} pulse={connection === 'connecting' || connection === 'reconnecting'} />
          <Text className="text-[11px] text-ink-3">{connectionLabel(connection, true)}</Text>
        </View>
      </View>
    </View>
  )
}

function NavItem({
  label,
  icon,
  active,
  mono,
  onPress,
}: {
  label: string
  icon?: React.ReactNode
  active?: boolean
  mono?: boolean
  onPress: () => void
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityState={{ selected: active }}
      onPress={onPress}
      className={cn(
        'mx-2.5 min-h-10 flex-row items-center gap-2.5 rounded-lg px-2.5',
        active ? 'bg-accent-tint' : 'active:bg-hover-2',
      )}
    >
      {icon}
      {mono ? (
        <Mono className="min-w-0 flex-1 text-[12.5px] text-ink-2" numberOfLines={1}>
          {label}
        </Mono>
      ) : (
        <Text
          className={cn('min-w-0 flex-1 text-[12.5px]', active ? 'text-ink' : 'text-ink-2')}
          numberOfLines={1}
        >
          {label}
        </Text>
      )}
    </Pressable>
  )
}
