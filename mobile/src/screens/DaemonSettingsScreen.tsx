/**
 * Daemon settings — read and edit the daemon's own configuration.
 *
 * QAI SIGNAL DECK
 * ---------------
 * Each key is its own tablet: key in mono up top, value in a well chip below
 * (switch for booleans, numeric field for numbers, mono well for JSON). An
 * edited key lifts onto the accent — tinted tablet, `modified — was …` line,
 * one-tap undo. Only edited keys are sent, so nothing the desktop changed
 * mid-edit is clobbered. Same load/save/coerce handlers.
 */

import * as React from 'react'
import {
  Animated,
  TextInput,
  View,
} from 'react-native'
import { Text } from '@app/components/Text'
import { useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { RefreshCw, SearchX, Settings2, Undo2 } from 'lucide-react-native'

import { settingsApi } from '@app/lib/api'
import type { RootStackParamList } from '@app/navigation'
import { palette } from '@app/design/tokens'
import { MONO } from '@app/design/fonts'
import { BackButton, Card, ScreenScaffold, Section } from '@app/components/Screen'
import { rowEnterStyle, staggerDelay, useEnter } from '@app/components/motion'
import {
  Badge,
  Button,
  EmptyState,
  Eyebrow,
  IconButton,
  Mono,
  Notice,
  RowSkeleton,
  SearchField,
  ToggleRow,
  Well,
  haptic,
  toast,
} from '@app/components/ui'

type Kind = 'boolean' | 'number' | 'text' | 'json'

function kindOf(value: unknown): Kind {
  if (typeof value === 'boolean') return 'boolean'
  if (typeof value === 'number') return 'number'
  if (value !== null && typeof value === 'object') return 'json'
  return 'text'
}

/** Render a value as the text an input should hold. */
function display(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'object') return JSON.stringify(value, null, 2)
  return String(value)
}

/**
 * Parse typed text back to the type the key already had.
 *
 * The point is the `json` and `boolean` branches: a key that was a boolean must
 * not become the string `"true"`, and a key that was an object must not become
 * a stringified blob that happens to parse. If the text does not parse, the
 * original string is sent and the field is marked, rather than the save failing
 * silently.
 */
function coerce(original: unknown, text: string): unknown {
  switch (kindOf(original)) {
    case 'boolean':
      return text === 'true'
    case 'number': {
      const parsed = Number(text)
      return Number.isFinite(parsed) ? parsed : text
    }
    case 'json': {
      try {
        return JSON.parse(text)
      } catch {
        return text
      }
    }
    default:
      return text
  }
}

export function DaemonSettingsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const [settings, setSettings] = React.useState<Record<string, unknown>>({})
  const [configPath, setConfigPath] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [refreshing, setRefreshing] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [edits, setEdits] = React.useState<Record<string, string>>({})
  const [query, setQuery] = React.useState('')
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
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    void load()
  }, [load])

  async function refresh() {
    setRefreshing(true)
    await load()
    setRefreshing(false)
  }

  const changed = Object.keys(edits)

  async function save() {
    if (changed.length === 0) return
    setSaving(true)
    setError(null)
    try {
      const patch: Record<string, unknown> = {}
      for (const key of changed) patch[key] = coerce(settings[key], edits[key])
      const res = await settingsApi.update(patch)
      setSettings(res.settings ?? settings)
      setEdits({})
      toast({ message: `Saved ${changed.length} ${changed.length === 1 ? 'key' : 'keys'}`, tone: 'ok' })
    } catch (cause) {
      toast({
        message: 'Could not save settings',
        detail: cause instanceof Error ? cause.message : undefined,
        tone: 'danger',
      })
    } finally {
      setSaving(false)
    }
  }

  const keys = React.useMemo(() => {
    const all = Object.keys(settings).sort()
    const needle = query.trim().toLowerCase()
    return needle ? all.filter((key) => key.toLowerCase().includes(needle)) : all
  }, [query, settings])

  return (
    <ScreenScaffold
      title="Daemon settings"
      eyebrow="Configuration"
      subtitle="The desktop's own configuration, read and edited from here. Changes apply when the daemon accepts them."
      onRefresh={() => void refresh()}
      refreshing={refreshing}
      scroll
      contentClassName="pb-12 gap-5"
      headerLeft={<BackButton onPress={() => navigation.goBack()} label="Back to System" />}
      headerRight={
        <IconButton label="Reload daemon settings" size={38} onPress={() => void refresh()}>
          <RefreshCw size={18} color={refreshing ? palette.accent : palette.ink2} />
        </IconButton>
      }
    >
      {configPath ? (
        <View className="mx-4 gap-1.5">
          <Eyebrow>Config file</Eyebrow>
          <Well className="self-start rounded-sm px-3 py-2">
            <Mono className="text-[12px] leading-[17px] text-ink-2" numberOfLines={1}>
              {configPath}
            </Mono>
          </Well>
        </View>
      ) : null}

      {error ? (
        <Notice
          message={error}
          tone="danger"
          action={{ label: 'Retry', onPress: () => void load() }}
        />
      ) : null}

      {changed.length > 0 ? (
        <Notice
          message={`${changed.length} unsaved ${changed.length === 1 ? 'change' : 'changes'}. Only the keys you edited are sent, so nothing the desktop changed in the meantime is overwritten.`}
          tone="wait"
          action={{ label: saving ? 'Saving…' : 'Save', onPress: () => void save(), busy: saving }}
        />
      ) : null}

      {loading && keys.length === 0 ? (
        <Card className="p-4">
          <View className="gap-6">
            {Array.from({ length: 5 }).map((_, index) => (
              <RowSkeleton key={index} />
            ))}
          </View>
        </Card>
      ) : keys.length === 0 ? (
        <Card>
          <EmptyState
            title={
              loading
                ? 'Loading settings…'
                : query
                  ? 'No keys match that search.'
                  : 'No settings returned by the daemon.'
            }
            body={
              loading
                ? 'Reading the daemon configuration.'
                : query
                  ? 'Try a shorter or different filter.'
                  : 'It may be running an older build.'
            }
            icon={
              query ? (
                <SearchX size={22} color={palette.ink3} />
              ) : (
                <Settings2 size={22} color={palette.ink3} />
              )
            }
          />
        </Card>
      ) : (
      <Section eyebrow="Keys" title={`${keys.length} ${keys.length === 1 ? 'key' : 'keys'}`} enterIndex={0}>
          <View className="gap-3">
            {Object.keys(settings).length > 10 ? (
              <SearchField
                value={query}
                onChangeText={setQuery}
                placeholder="Filter keys"
                accessibilityLabel="Filter configuration keys"
              />
            ) : null}

            {keys.map((key, index) => (
              <SettingRow
                key={key}
                name={key}
                original={settings[key]}
                edited={edits[key]}
                index={index}
                onChange={(value) => setEdits((current) => ({ ...current, [key]: value }))}
                onRevert={() =>
                  setEdits((current) => {
                    const next = { ...current }
                    delete next[key]
                    return next
                  })
                }
              />
            ))}
          </View>
        </Section>
      )}

      {changed.length > 0 ? (
        <View className="mx-4">
          <Button
            variant="primary"
            full
            label={saving ? 'Saving…' : `Save ${changed.length} ${changed.length === 1 ? 'change' : 'changes'}`}
            disabled={saving}
            onPress={() => void save()}
          />
        </View>
      ) : null}
    </ScreenScaffold>
  )
}

function SettingRow({
  name,
  original,
  edited,
  index,
  onChange,
  onRevert,
}: {
  name: string
  original: unknown
  edited: string | undefined
  index: number
  onChange: (value: string) => void
  onRevert: () => void
}) {
  const enter = useEnter(staggerDelay(Math.min(index, 5)), false)
  const kind = kindOf(original)
  const isEdited = edited !== undefined
  const value = isEdited ? edited : display(original)

  return (
    <Animated.View style={rowEnterStyle(enter)}>
      <View
        className="gap-2.5 rounded-md border p-3.5"
        style={{
          borderColor: isEdited ? palette.accentBorder : palette.line,
          backgroundColor: isEdited ? palette.accentSoft : palette.surface,
        }}
      >
        {kind === 'boolean' ? (
          <ToggleRow
            label={name}
            value={value === 'true'}
            onChange={() => onChange(value === 'true' ? 'false' : 'true')}
            leading={<Badge outline>{kind}</Badge>}
          />
        ) : (
          <>
            <View className="flex-row items-center gap-2">
              <Mono className="min-w-0 flex-1 text-[12.5px] leading-[18px] font-semibold text-ink" numberOfLines={1}>
                {name}
              </Mono>
              <Badge outline>{kind}</Badge>
            </View>
            <RawInput
              value={value}
              multiline={kind === 'json'}
              numeric={kind === 'number'}
              label={name}
              onChange={onChange}
            />
          </>
        )}

        {isEdited ? (
          <View className="flex-row items-center gap-2">
            <Text
              className="min-w-0 flex-1 text-[11.5px] leading-[16px] font-semibold text-accent"
              numberOfLines={2}
            >
              modified — was {display(original) || '(empty)'}
            </Text>
            <IconButton
              label={`Revert ${name}`}
              size={30}
              onPress={() => {
                void haptic('light')
                onRevert()
              }}
            >
              <Undo2 size={15} color={palette.ink3} />
            </IconButton>
          </View>
        ) : null}
      </View>
    </Animated.View>
  )
}

/**
 * The raw editor.
 *
 * A plain `TextInput` rather than the app's `Field`, because the wrapper's
 * 48pt well and label are wrong for a dense list of values, and a numeric
 * keyboard is not optional when the key holds a number. It is dressed as a
 * `Well` chip — a hole in the card holding the value — so the read-only
 * grammar of "this is data" survives into the editable one.
 */
function RawInput({
  value,
  onChange,
  multiline,
  numeric,
  label,
}: {
  value: string
  onChange: (value: string) => void
  multiline?: boolean
  numeric?: boolean
  label: string
}) {
  return (
    <TextInput
      value={value}
      onChangeText={onChange}
      accessibilityLabel={label}
      placeholderTextColor={palette.ink4}
      autoCapitalize="none"
      autoCorrect={false}
      keyboardType={numeric ? 'numeric' : multiline ? 'default' : 'url'}
      multiline={multiline}
      className="rounded-md border border-line bg-well px-3 text-[13px] leading-[19px] text-ink"
      style={{
        minHeight: multiline ? 96 : 44,
        paddingTop: multiline ? 10 : 0,
        paddingBottom: multiline ? 10 : 0,
        textAlignVertical: multiline ? 'top' : 'center',
        fontFamily: MONO,
      }}
    />
  )
}
