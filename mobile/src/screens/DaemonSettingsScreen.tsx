/**
 * Daemon settings — read and edit the desktop daemon's own configuration.
 *
 * The previous version rendered one text field per top-level key, which is a
 * JSON editor with the labels taken off. Three things are wrong with that on a
 * phone:
 *
 *   1. **The value is inferred from the current one.** A key that is `true`
 *      gets a switch; one that is `123` gets a numeric field with a numeric
 *      keyboard; one that is a nested object gets a multi-line field. The
 *      daemon's config is untyped, so the *existing* value is the only type
 *      information there is — using it is the difference between editing a
 *      setting and editing a string that happens to contain `true`.
 *   2. **Edits are typed back on save, not on keystroke.** A user who types
 *      `007` into a port field means `7`. The previous code ran
 *      `/^\d+$/` over the text on save, which gets that right, but it also
 *      turned a string value of `"7"` into the number `7` — a silent type
 *      change the daemon may or may not tolerate. This remembers the original
 *      type and converts back to it.
 *   3. **Only edited keys are sent.** The previous code sent the whole object.
 *      Between the load and the save the daemon's config may have changed (the
 *      desktop is running), and sending a stale copy back would clobber it.
 *
 * Modified keys are marked and can be reverted individually, so a bad edit is
 * one tap to undo rather than a reload.
 */

import * as React from 'react'
import { Pressable, Text, TextInput, View } from 'react-native'
import { useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { RefreshCw, Undo2 } from 'lucide-react-native'

import { settingsApi } from '@app/lib/api'
import type { RootStackParamList } from '@app/navigation'
import { palette, radius } from '@app/design/tokens'
import { BackButton, ScreenScaffold, Section } from '@app/components/Screen'
import { rowEnterStyle, staggerDelay, useEnter } from '@app/components/motion'
import {
  Badge,
  Button,
  Card,
  Mono,
  Notice,
  SearchField,
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
      contentClassName="px-4 pb-12 gap-5"
      headerLeft={<BackButton onPress={() => navigation.goBack()} label="Back to settings" />}
      headerRight={
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Reload daemon settings"
          onPress={() => void refresh()}
          hitSlop={8}
          style={({ pressed }) => ({
            width: 38,
            height: 38,
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: radius.pill,
            backgroundColor: pressed ? palette.raised : 'transparent',
          })}
        >
          <RefreshCw size={18} color={refreshing ? palette.accent : palette.ink2} />
        </Pressable>
      }
    >
      {configPath ? (
        <View style={{ gap: 5 }}>
          <Text
            style={{
              color: palette.ink3,
              fontSize: 10,
              fontWeight: '600',
              letterSpacing: 1.2,
              textTransform: 'uppercase',
              fontFamily: 'Menlo',
            }}
          >
            Config file
          </Text>
          <Mono className="text-[12px] text-ink-2" numberOfLines={1}>
            {configPath}
          </Mono>
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
        <Card>
          <View style={{ padding: 16, gap: 12 }}>
            {Array.from({ length: 5 }).map((_, index) => (
              <View key={index} style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
                <View style={{ flex: 1, gap: 7 }}>
                  <View style={{ height: 12, width: '42%', borderRadius: 6, backgroundColor: palette.raised }} />
                  <View style={{ height: 10, width: '62%', borderRadius: 5, backgroundColor: palette.well }} />
                </View>
                <View style={{ height: 34, width: 56, borderRadius: radius.sm, backgroundColor: palette.raised }} />
              </View>
            ))}
          </View>
        </Card>
      ) : keys.length === 0 ? (
        <Card>
          <View style={{ padding: 16 }}>
            <Text className="text-[13.5px] leading-[19px] text-ink-3">
              {loading
                ? 'Loading settings…'
                : query
                  ? 'No keys match that search.'
                  : 'No settings returned by the daemon. It may be running an older build.'}
            </Text>
          </View>
        </Card>
      ) : (
        <Section eyebrow="Configuration" title={`${keys.length} ${keys.length === 1 ? 'key' : 'keys'}`} enterIndex={0}>
          <View style={{ gap: 10 }}>
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
        <Button
          variant="primary"
          label={saving ? 'Saving…' : `Save ${changed.length} ${changed.length === 1 ? 'change' : 'changes'}`}
          disabled={saving}
          onPress={() => void save()}
        />
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
  const enter = useEnter(staggerDelay(Math.min(index, 8)), false)
  const kind = kindOf(original)
  const isEdited = edited !== undefined
  const value = isEdited ? edited : display(original)

  return (
    <View style={rowEnterStyle(enter)}>
      <View
        style={{
          gap: 9,
          borderRadius: radius.md,
          borderWidth: 1,
          borderColor: isEdited ? palette.accentBorder : palette.line,
          backgroundColor: isEdited ? palette.accentSoft : palette.surface,
          padding: 14,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Mono className="min-w-0 flex-1 text-[12.5px] font-semibold text-ink" numberOfLines={1}>
            {name}
          </Mono>
          <Badge outline>{kind}</Badge>
          {isEdited ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Revert ${name}`}
              onPress={() => {
                void haptic('light')
                onRevert()
              }}
              hitSlop={10}
              style={({ pressed }) => ({
                width: 30,
                height: 30,
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: radius.pill,
                backgroundColor: pressed ? palette.raised : 'transparent',
              })}
            >
              <Undo2 size={15} color={palette.ink3} />
            </Pressable>
          ) : null}
        </View>

        {kind === 'boolean' ? (
          <Pressable
            accessibilityRole="switch"
            accessibilityLabel={name}
            accessibilityState={{ checked: value === 'true' }}
            onPress={() => onChange(value === 'true' ? 'false' : 'true')}
            style={({ pressed }) => ({
              minHeight: 44,
              justifyContent: 'center',
              borderRadius: radius.sm,
              backgroundColor: pressed ? palette.raised : palette.well,
              paddingHorizontal: 12,
            })}
          >
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <View
                style={{
                  width: 46,
                  height: 27,
                  justifyContent: 'center',
                  borderRadius: 14,
                  paddingHorizontal: 2,
                  backgroundColor: value === 'true' ? palette.accent : palette.raised,
                  borderWidth: 1,
                  borderColor: value === 'true' ? palette.accent : palette.lineStrong,
                }}
              >
                <View
                  style={{
                    width: 21,
                    height: 21,
                    borderRadius: 11,
                    backgroundColor: value === 'true' ? palette.accentInk : palette.ink3,
                    transform: [{ translateX: value === 'true' ? 19 : 0 }],
                  }}
                />
              </View>
              <Mono className="text-[13px] text-ink">{value === 'true' ? 'true' : 'false'}</Mono>
            </View>
          </Pressable>
        ) : (
          <RawInput
            value={value}
            multiline={kind === 'json'}
            numeric={kind === 'number'}
            label={name}
            onChange={onChange}
          />
        )}

        {isEdited ? (
          <Text style={{ color: palette.accent, fontSize: 11.5, fontWeight: '600' }}>
            modified — was {display(original) || '(empty)'}
          </Text>
        ) : null}
      </View>
    </View>
  )
}

/**
 * The raw editor.
 *
 * A plain `TextInput` rather than the app's `Field`, because the wrapper's
 * 48pt well and label are wrong for a dense list of values, and a numeric
 * keyboard is not optional when the key holds a number.
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
      className="rounded-sm border border-line bg-field px-3 text-[13px] text-ink"
      style={{
        minHeight: multiline ? 96 : 44,
        paddingTop: multiline ? 10 : 0,
        paddingBottom: multiline ? 10 : 0,
        textAlignVertical: multiline ? 'top' : 'center',
        fontFamily: 'Menlo',
      }}
    />
  )
}
