/**
 * Daemon Settings — read and edit daemon configuration from the phone.
 *
 * Uses settingsApi.get() and settingsApi.update() to expose the same config
 * surface the desktop's settings panel writes to. Fields are rendered dynamically
 * from the settings object the daemon returns.
 */

import * as React from 'react'
import { Pressable, RefreshControl, ScrollView, Text, TextInput, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useNavigation } from '@react-navigation/native'
import type { DrawerNavigationProp } from '@react-navigation/drawer'
import { Save, Settings as SettingsIcon } from 'lucide-react-native'

import { settingsApi } from '@app/lib/api'
import type { DrawerParamList } from '@app/navigation'
import {
  Button,
  Card,
  CardHeader,
  Chip,
  Mono,
  PageHeader,
} from '@app/components/ui'
import { palette } from '@app/design/tokens'

export function DaemonSettingsScreen() {
  const navigation = useNavigation<DrawerNavigationProp<DrawerParamList>>()
  const [settings, setSettings] = React.useState<Record<string, unknown>>({})
  const [configPath, setConfigPath] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(false)
  const [refreshing, setRefreshing] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [note, setNote] = React.useState<string | null>(null)
  const [edits, setEdits] = React.useState<Record<string, string>>({})
  const [saving, setSaving] = React.useState(false)

  const load = React.useCallback(async () => {
    setError(null)
    try {
      const res = await settingsApi.get()
      setSettings(res.settings ?? {})
      setConfigPath(res.config_path ?? null)
      setEdits({})
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load daemon settings')
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

  async function save() {
    if (Object.keys(edits).length === 0) return
    setSaving(true)
    setError(null)
    setNote(null)
    try {
      // Parse edits back to appropriate types
      const patch: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(edits)) {
        if (value === 'true') patch[key] = true
        else if (value === 'false') patch[key] = false
        else if (/^\d+$/.test(value)) patch[key] = parseInt(value, 10)
        else if (/^\d+\.\d+$/.test(value)) patch[key] = parseFloat(value)
        else patch[key] = value
      }
      const res = await settingsApi.update(patch)
      setSettings(res.settings ?? settings)
      setEdits({})
      setNote('Settings saved.')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save settings')
    } finally {
      setSaving(false)
    }
  }

  function getValue(key: string): string {
    if (edits[key] !== undefined) return edits[key]
    const val = settings[key]
    if (val === null || val === undefined) return ''
    if (typeof val === 'object') return JSON.stringify(val)
    return String(val)
  }

  const settingKeys = Object.keys(settings).sort()

  return (
    <SafeAreaView className="flex-1 bg-canvas" edges={['top']}>
      <PageHeader
        onMenu={() => navigation.openDrawer()}
        title="Daemon Settings"
        right={
          Object.keys(edits).length > 0 ? (
            <Button
              variant="primary"
              label={saving ? '…' : 'Save'}
              className="min-h-9 px-3"
              onPress={() => void save()}
            />
          ) : undefined
        }
      />

      <ScrollView
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={palette.ink3} />}
        contentContainerClassName="gap-4 p-4 pb-10"
      >
        <View className="gap-1.5">
          <Mono className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-3">Configuration</Mono>
          <Text className="text-[24px] font-bold tracking-tight text-ink" style={{ letterSpacing: -0.5 }}>Daemon Settings</Text>
          <Text className="text-[14px] leading-5 text-ink-2">
            Read and edit the daemon's configuration directly. Changes take effect immediately.
          </Text>
          {configPath ? (
            <Mono className="mt-1 text-[10px] text-ink-3" numberOfLines={1}>
              {configPath}
            </Mono>
          ) : null}
        </View>

        {error ? (
          <View className="rounded-lg border border-red-border bg-red-tint px-3 py-2.5">
            <Text className="text-[11.5px] leading-5 text-ink">{error}</Text>
          </View>
        ) : null}

        {note ? (
          <View className="rounded-lg border border-green-border bg-green-tint px-3 py-2.5">
            <Text className="text-[11.5px] leading-5 text-green">{note}</Text>
          </View>
        ) : null}

        {loading && settingKeys.length === 0 ? (
          <Text className="py-10 text-center text-[12px] text-ink-3">Loading settings…</Text>
        ) : settingKeys.length === 0 ? (
          <Card>
            <View className="p-4">
              <Text className="text-[12px] text-ink-3">
                No settings returned by the daemon. It may be running an older build.
              </Text>
            </View>
          </Card>
        ) : (
          <Card>
            <CardHeader
              title="Settings"
              right={<Chip label={`${settingKeys.length} keys`} />}
            />
            <View className="gap-3 p-3.5">
              {settingKeys.map((key) => {
                const val = getValue(key)
                const isEdited = edits[key] !== undefined
                const isComplex = typeof settings[key] === 'object' && settings[key] !== null
                return (
                  <View key={key} className="gap-1.5">
                    <View className="flex-row items-center gap-2">
                      <Mono className="text-[11px] font-semibold text-ink">{key}</Mono>
                      {isEdited ? <Chip tone="accent" label="modified" /> : null}
                    </View>
                    {isComplex ? (
                      <TextInput
                        value={val}
                        onChangeText={(text) => setEdits((prev) => ({ ...prev, [key]: text }))}
                        multiline
                        numberOfLines={4}
                        className="min-h-20 rounded-lg border border-line bg-field px-3 py-2 font-mono text-[11px] leading-4 text-ink"
                      />
                    ) : (
                      <TextInput
                        value={val}
                        onChangeText={(text) => setEdits((prev) => ({ ...prev, [key]: text }))}
                        autoCapitalize="none"
                        autoCorrect={false}
                        className="min-h-10 rounded-lg border border-line bg-field px-3 text-[12px] text-ink"
                      />
                    )}
                  </View>
                )
              })}
            </View>
          </Card>
        )}

        {Object.keys(edits).length > 0 ? (
          <Button
            variant="primary"
            label={saving ? 'Saving…' : `Save ${Object.keys(edits).length} changes`}
            disabled={saving}
            onPress={() => void save()}
          />
        ) : null}
      </ScrollView>
    </SafeAreaView>
  )
}
