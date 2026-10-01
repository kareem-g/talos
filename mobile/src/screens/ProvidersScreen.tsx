/**
 * API providers — endpoints the user added by hand.
 *
 * The desktop keeps this in Configuration; on the phone it belongs in Station,
 * because it is part of the machinery an agent can run on rather than a
 * preference about this device.
 *
 * Two things shape the screen:
 *
 *  - **The key never comes back.** The daemon masks it to `has_key`, so a row
 *    can say "key set" but can never show it. The form therefore sends a key
 *    only when the user has typed a new one — saving a name edit must not wipe
 *    the secret.
 *
 *  - **Test before save.** A wrong `api_url` is the single most common mistake
 *    here, and the failure is otherwise invisible until an agent silently fails
 *    to start. So the form probes the endpoint and reports the models it
 *    advertised, and only then do you save it.
 */

import * as React from 'react'
import {
  Animated,
  Pressable,
  View,
} from 'react-native'
import { Text } from '@app/components/Text'
import { useNavigation } from '@react-navigation/native'
import { Plus, Server } from 'lucide-react-native'

import { apiProvidersApi, type ApiProviderConfig } from '@app/lib/api'
import { palette } from '@app/design/tokens'
import { BackButton, Card, ListCard, ScreenScaffold, Section } from '@app/components/Screen'
import { rowEnterStyle, staggerDelay, useEnter } from '@app/components/motion'
import { FormSheet } from '@app/components/Sheet'
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  Field,
  IconTile,
  Mono,
  Notice,
  Segmented,
  haptic,
  toast,
} from '@app/components/ui'

type Transport = 'openai_compatible' | 'anthropic_compatible'

export function ProvidersScreen() {
  const navigation = useNavigation()
  const [providers, setProviders] = React.useState<ApiProviderConfig[]>([])
  const [loading, setLoading] = React.useState(true)
  const [refreshing, setRefreshing] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const [addOpen, setAddOpen] = React.useState(false)
  const [draft, setDraft] = React.useState<Draft>(EMPTY_DRAFT)
  const [testing, setTesting] = React.useState(false)
  const [probe, setProbe] = React.useState<{ ok: boolean; message: string } | null>(null)
  const [saving, setSaving] = React.useState(false)

  const [confirmRemove, setConfirmRemove] = React.useState<string | null>(null)
  const [busyRemove, setBusyRemove] = React.useState<string | null>(null)

  const load = React.useCallback(async () => {
    setError(null)
    try {
      setProviders(await apiProvidersApi.list())
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load API providers')
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

  function openAdd() {
    setDraft(EMPTY_DRAFT)
    setProbe(null)
    setAddOpen(true)
  }

  async function testDraft() {
    if (!draft.id.trim() || !draft.api_url.trim()) return
    setTesting(true)
    setProbe(null)
    try {
      const result = await apiProvidersApi.test({
        id: draft.id.trim(),
        name: draft.name.trim() || draft.id.trim(),
        api_url: draft.api_url.trim(),
        transport: draft.transport,
        ...(draft.api_key.trim() ? { api_key: draft.api_key.trim() } : {}),
      })
      if (result.ok) {
        const models = result.models ?? []
        setProbe({
          ok: true,
          message:
            models.length > 0
              ? `Reachable — ${models.length} ${models.length === 1 ? 'model' : 'models'} reported.`
              : 'Reachable — the endpoint reported no models.',
        })
        if (models.length > 0 && !draft.models.length) {
          setDraft((current) => ({ ...current, models }))
        }
      } else {
        setProbe({ ok: false, message: result.error ?? 'The endpoint refused the request.' })
      }
    } catch (cause) {
      setProbe({ ok: false, message: cause instanceof Error ? cause.message : 'Could not reach that endpoint' })
    } finally {
      setTesting(false)
    }
  }

  async function save() {
    if (!draft.id.trim() || !draft.api_url.trim()) return
    setSaving(true)
    try {
      await apiProvidersApi.create({
        id: draft.id.trim(),
        name: draft.name.trim() || draft.id.trim(),
        api_url: draft.api_url.trim(),
        transport: draft.transport,
        ...(draft.models.length ? { models: draft.models } : {}),
        ...(draft.default_model.trim() ? { default_model: draft.default_model.trim() } : {}),
        // Only send a key the user actually typed; the daemon keeps the old one
        // otherwise, so editing a name cannot silently clear the credential.
        ...(draft.api_key.trim() ? { api_key: draft.api_key.trim() } : {}),
      })
      setAddOpen(false)
      await load()
      toast({ message: `${draft.name.trim() || draft.id.trim()} saved`, tone: 'ok' })
    } catch (cause) {
      toast({
        message: 'Could not save that provider',
        detail: cause instanceof Error ? cause.message : undefined,
        tone: 'danger',
      })
    } finally {
      setSaving(false)
    }
  }

  async function remove(id: string) {
    setBusyRemove(id)
    try {
      await apiProvidersApi.remove(id)
      setConfirmRemove(null)
      await load()
      toast({ message: `${id} removed`, tone: 'ok' })
    } catch (cause) {
      toast({
        message: 'Could not remove that provider',
        detail: cause instanceof Error ? cause.message : undefined,
        tone: 'danger',
      })
    } finally {
      setBusyRemove(null)
    }
  }

  return (
    <ScreenScaffold
      title="API providers"
      eyebrow="Station · engines"
      subtitle="OpenAI- or Anthropic-compatible endpoints you added by hand. Once saved they appear as engines wherever you pick one."
      onRefresh={() => void refresh()}
      refreshing={refreshing}
      scroll
      contentClassName="gap-6 pb-12"
      headerLeft={<BackButton onPress={() => navigation.goBack()} label="Back to Station" />}
      headerRight={
        <Button
          size="sm"
          variant="primary"
          label="Add"
          icon={<Plus size={15} color={palette.accentInk} strokeWidth={2.6} />}
          accessibilityLabel="Add an API provider"
          onPress={() => {
            void haptic('light')
            openAdd()
          }}
        />
      }
    >
      {error ? (
        <View className="mx-4">
          <ErrorState message={error} onRetry={() => void load()} retryLabel="Retry" />
        </View>
      ) : null}

      <Section
        eyebrow="Configured"
        title={
          providers.length > 0
            ? `${providers.length} ${providers.length === 1 ? 'provider' : 'providers'}`
            : undefined
        }
        enterIndex={0}
      >
        {providers.length === 0 ? (
          <Card>
            <EmptyState
              title={loading ? 'Loading providers' : 'No custom providers'}
              body={
                loading
                  ? 'Asking the desktop what is configured.'
                  : 'Add an endpoint to run agents against a model the built-in engines do not cover.'
              }
              icon={<Server size={22} color={palette.ink3} />}
              action={loading ? null : <Button size="sm" variant="primary" label="Add a provider" onPress={openAdd} />}
            />
          </Card>
        ) : (
          <ListCard inset={64}>
            {providers.map((provider, index) => (
              <ProviderRow
                key={provider.id}
                provider={provider}
                index={index}
                confirming={confirmRemove === provider.id}
                busy={busyRemove === provider.id}
                onRemove={() => {
                  void haptic('warn')
                  setConfirmRemove(provider.id)
                }}
                onConfirmRemove={() => void remove(provider.id)}
              />
            ))}
          </ListCard>
        )}
      </Section>

      <FormSheet
        open={addOpen}
        onClose={() => setAddOpen(false)}
        eyebrow="API provider"
        title="Add an endpoint"
        submitLabel={saving ? 'Saving…' : 'Save provider'}
        onSubmit={() => void save()}
        busy={saving}
        disabled={!draft.id.trim() || !draft.api_url.trim()}
      >
        <Field
          label="Id"
          value={draft.id}
          onChangeText={(value) => setDraft((current) => ({ ...current, id: value }))}
          placeholder="my-endpoint"
          autoCapitalize="none"
          autoCorrect={false}
          mono
          accessibilityLabel="Provider id"
          hint="How sessions refer to it. Lowercase, no spaces."
        />
        <Field
          label="Name"
          value={draft.name}
          onChangeText={(value) => setDraft((current) => ({ ...current, name: value }))}
          placeholder="My endpoint"
          accessibilityLabel="Provider name"
        />
        <Field
          label="API URL"
          value={draft.api_url}
          onChangeText={(value) => setDraft((current) => ({ ...current, api_url: value }))}
          placeholder="https://api.example.com/v1"
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          mono
          accessibilityLabel="API URL"
        />
        <Field
          label="API key"
          value={draft.api_key}
          onChangeText={(value) => setDraft((current) => ({ ...current, api_key: value }))}
          placeholder="sk-…"
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
          mono
          accessibilityLabel="API key"
          hint="Leave blank to keep the stored key. It is never sent back to this phone."
        />
        <View className="gap-1.5">
          <Mono className="text-[11px] font-semibold text-ink-2">TRANSPORT</Mono>
          <Segmented<Transport>
            label="Transport"
            value={draft.transport}
            onChange={(value) => setDraft((current) => ({ ...current, transport: value }))}
            options={[
              { value: 'openai_compatible', label: 'OpenAI' },
              { value: 'anthropic_compatible', label: 'Anthropic' },
            ]}
          />
        </View>

        <Button
          variant="secondary"
          label={testing ? 'Testing…' : 'Test connection'}
          disabled={!draft.id.trim() || !draft.api_url.trim() || testing}
          onPress={() => void testDraft()}
          accessibilityLabel="Test this endpoint"
        />
        {probe ? (
          <Notice tone={probe.ok ? 'ok' : 'danger'} message={probe.message} />
        ) : null}
        {draft.models.length > 0 ? (
          <Mono className="text-[10.5px] text-ink-3" numberOfLines={3}>
            {`${draft.models.length} models: ${draft.models.slice(0, 6).join(', ')}${draft.models.length > 6 ? '…' : ''}`}
          </Mono>
        ) : null}
      </FormSheet>
    </ScreenScaffold>
  )
}

interface Draft {
  id: string
  name: string
  api_url: string
  api_key: string
  transport: Transport
  models: string[]
  default_model: string
}

const EMPTY_DRAFT: Draft = {
  id: '',
  name: '',
  api_url: '',
  api_key: '',
  transport: 'openai_compatible',
  models: [],
  default_model: '',
}

/** One configured provider. Removal is the app's two-step destructive grammar. */
function ProviderRow({
  provider,
  index,
  confirming,
  busy,
  onRemove,
  onConfirmRemove,
}: {
  provider: ApiProviderConfig
  index: number
  confirming: boolean
  busy: boolean
  onRemove: () => void
  onConfirmRemove: () => void
}) {
  const enter = useEnter(staggerDelay(Math.min(index, 5)), false)
  return (
    <Animated.View style={rowEnterStyle(enter)}>
      <View className="min-h-16 flex-row items-center gap-3 px-4 py-3">
        <IconTile icon={<Server size={16} color={palette.accent} />} tone="accent" />
        <View className="min-w-0 flex-1 gap-0.5">
          <Text className="text-[14.5px] leading-[20px] font-medium text-ink" numberOfLines={1}>
            {provider.name || provider.id}
          </Text>
          <Mono className="text-[11.5px] leading-[15px]" numberOfLines={1}>
            {provider.api_url}
          </Mono>
        </View>
        <View className="items-end gap-1">
          <Badge tone="muted" outline mono>
            {provider.transport === 'anthropic_compatible' ? 'anthropic' : 'openai'}
          </Badge>
          <Mono className="text-[10px] text-ink-4">
            {provider.has_key ? 'key set' : 'no key'}
            {provider.models.length > 0 ? ` · ${provider.models.length} models` : ''}
          </Mono>
        </View>
        {confirming ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Confirm removing ${provider.id}`}
            disabled={busy}
            onPress={onConfirmRemove}
            hitSlop={8}
            className="min-h-9 flex-row items-center justify-center rounded-sm border px-3 active:opacity-70"
            style={{
              borderColor: palette.dangerBorder,
              backgroundColor: palette.dangerSoft,
              opacity: busy ? 0.5 : 1,
            }}
          >
            <Text className="text-[12px] leading-[16px] font-bold text-danger">
              {busy ? 'Removing…' : 'Confirm remove'}
            </Text>
          </Pressable>
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Remove ${provider.id}`}
            onPress={onRemove}
            hitSlop={8}
            className="min-h-9 items-center justify-center rounded-sm border border-line px-3 active:bg-raised"
          >
            <Text className="text-[12px] leading-[16px] font-semibold text-danger">Remove</Text>
          </Pressable>
        )}
      </View>
    </Animated.View>
  )
}