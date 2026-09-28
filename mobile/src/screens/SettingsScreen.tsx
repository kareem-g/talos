/**
 * Settings — notification permissions and the pairing connection.
 *
 * This is the spec's "notification settings" surface: it shows the permission
 * state, requests it with a plain-language why, routes to system settings when
 * denied, offers a test alert, and states the iOS limitation honestly. Permission
 * denial never blocks the app — everything works, alerts just stay in-app.
 */

import * as React from 'react'
import { Pressable, ScrollView, Text, View } from 'react-native'
import { useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { SafeAreaView } from 'react-native-safe-area-context'
import { ChevronLeft } from 'lucide-react-native'

import {
  openSystemNotificationSettings,
  permissionState,
  present,
  requestPermission,
  type PermissionState,
} from '@app/lib/notify'
import { clearPairing, getPairingBaseUrl } from '@app/lib/pairing'
import { useStore } from '@app/store'
import type { RootStackParamList } from '@app/navigation'
import { Button, ScreenHeader } from '@app/components/ui'

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <View className="gap-3 rounded-card border border-line bg-surface p-4">
      <Text className="text-[11px] font-semibold uppercase tracking-wide text-ink-3">{title}</Text>
      {children}
    </View>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row items-center justify-between">
      <Text className="text-[13px] text-ink-2">{label}</Text>
      <Text className="max-w-[60%] text-[13px] text-ink" numberOfLines={1}>
        {value}
      </Text>
    </View>
  )
}

const PERMISSION_LABEL: Record<PermissionState, string> = {
  granted: 'Allowed',
  denied: 'Blocked in system settings',
  undetermined: 'Not requested yet',
}

export function SettingsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const desktopName = useStore((state) => state.desktopName)
  const [perm, setPerm] = React.useState<PermissionState>('undetermined')
  const [note, setNote] = React.useState<string | null>(null)

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

  async function unpair() {
    await clearPairing()
    navigation.reset({ index: 0, routes: [{ name: 'Pairing' }] })
  }

  return (
    <SafeAreaView className="flex-1 bg-canvas" edges={['top']}>
      <ScreenHeader
        title="Settings"
        subtitle={desktopName}
        left={
          <Pressable
            onPress={() => navigation.goBack()}
            className="-ml-1 rounded-lg p-1 active:bg-hover"
            accessibilityLabel="Back"
          >
            <ChevronLeft size={22} color="#f2f2f3" />
          </Pressable>
        }
      />
      <ScrollView contentContainerClassName="gap-4 p-4">
        <Section title="Notifications">
          <Row label="Permission" value={PERMISSION_LABEL[perm]} />
          <Text className="text-[12px] leading-5 text-ink-2">
            AgentDeck raises a local notification when an agent needs approval, finishes a turn, or
            errors. It uses the connection to your own daemon — no account, no third-party push
            service, nothing leaves your machine.
          </Text>
          {perm === 'granted' ? (
            <Button variant="surface" label="Send test notification" onPress={() => void test()} />
          ) : perm === 'denied' ? (
            <Button variant="surface" label="Open system settings" onPress={() => void openSystemNotificationSettings()} />
          ) : (
            <Button variant="primary" label="Enable notifications" onPress={() => void enable()} />
          )}
          <Text className="text-[11px] leading-4 text-ink-3">
            iOS delivers these while the app runs in the background. A fully closed app cannot be
            woken without Apple push, so anything that arrived while it was closed is surfaced the
            next time you open AgentDeck.
          </Text>
          {note ? <Text className="text-[12px] text-accent">{note}</Text> : null}
        </Section>

        <Section title="Connection">
          <Row label="Daemon" value={getPairingBaseUrl() || 'Not paired'} />
          <Button variant="danger" label="Unpair this device" onPress={() => void unpair()} />
        </Section>
      </ScrollView>
    </SafeAreaView>
  )
}
