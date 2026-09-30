/**
 * MCP servers — the tools this kiln can call.
 *
 * EMBER CLAY
 * ----------
 * Listing is a kiln shelf of server ingots with ember-tiled icons; adding is
 * a kiln form sheet rising from the bottom (a form you cannot scroll away from
 * once mistaken is a trap). Removing stays two-step in the row — quiet danger
 * first, filled confirm second — the iOS grammar for exactly this case. Same
 * list/add/remove handlers, same endpoints.
 */

import * as React from 'react'
import { Pressable, Text, View } from 'react-native'
import { useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { Plus, Server } from 'lucide-react-native'

import { mcpApi } from '@app/lib/api'
import type { RootStackParamList } from '@app/navigation'
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
  haptic,
  toast,
} from '@app/components/ui'

interface McpServer {
  name: string
  command?: string
  enabled?: boolean
}

export function McpScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const [servers, setServers] = React.useState<McpServer[]>([])
  const [loading, setLoading] = React.useState(true)
  const [refreshing, setRefreshing] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [addOpen, setAddOpen] = React.useState(false)
  const [newName, setNewName] = React.useState('')
  const [newCommand, setNewCommand] = React.useState('')
  const [addBusy, setAddBusy] = React.useState(false)
  const [confirmRemove, setConfirmRemove] = React.useState<string | null>(null)
  const [busyRemove, setBusyRemove] = React.useState<string | null>(null)

  const load = React.useCallback(async () => {
    setError(null)
    try {
      setServers((await mcpApi.list()).servers ?? [])
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load MCP servers')
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

  async function addServer() {
    if (!newName.trim()) return
    setAddBusy(true)
    setError(null)
    try {
      await mcpApi.add({
        name: newName.trim(),
        ...(newCommand.trim() ? { command: newCommand.trim() } : {}),
      })
      setNewName('')
      setNewCommand('')
      setAddOpen(false)
      await load()
      toast({ message: `${newName.trim()} added`, tone: 'ok' })
    } catch (cause) {
      toast({
        message: 'Could not add that server',
        detail: cause instanceof Error ? cause.message : undefined,
        tone: 'danger',
      })
    } finally {
      setAddBusy(false)
    }
  }

  async function removeServer(name: string) {
    setBusyRemove(name)
    try {
      await mcpApi.remove(name)
      setConfirmRemove(null)
      await load()
      toast({ message: `${name} removed`, tone: 'ok' })
    } catch (cause) {
      toast({
        message: 'Could not remove that server',
        detail: cause instanceof Error ? cause.message : undefined,
        tone: 'danger',
      })
    } finally {
      setBusyRemove(null)
    }
  }

  return (
    <ScreenScaffold
      title="MCP servers"
      eyebrow="Integrations"
      subtitle="Model Context Protocol servers give agents external tools and data. They apply to every session on the desktop."
      onRefresh={() => void refresh()}
      refreshing={refreshing}
      scroll
      contentClassName="pb-12 gap-6"
      headerLeft={<BackButton onPress={() => navigation.goBack()} label="Back to settings" />}
      headerRight={
        // A `primary` Button rather than a hand-rolled pill: the accent fill,
        // the label weight and the 48pt target are all the primitive's job, and
        // re-deriving them here is how a header ends up a different button from
        // every other one in the app.
        <Button
          size="sm"
          variant="primary"
          label="Add"
          icon={<Plus size={15} color={palette.accentInk} strokeWidth={2.6} />}
          accessibilityLabel="Add an MCP server"
          onPress={() => {
            void haptic('light')
            setAddOpen(true)
          }}
        />
      }
    >
      {error ? (
        <View className="mx-4">
          <ErrorState message={error} onRetry={() => void load()} retryLabel="Retry" />
        </View>
      ) : null}

      <Section eyebrow="Firebox" title={servers.length > 0 ? `${servers.length} ${servers.length === 1 ? 'server' : 'servers'}` : undefined} enterIndex={0}>
        {servers.length === 0 ? (
          <Card>
            <EmptyState
              title={loading ? 'Loading servers' : 'No MCP servers'}
              body={
                loading
                  ? 'Asking the desktop what is configured.'
                  : 'Add an MCP server to give agents access to external tools and data.'
              }
              icon={<Server size={22} color={palette.ink3} />}
              action={
                loading ? null : (
                  <Button size="sm" variant="primary" label="Add a server" onPress={() => setAddOpen(true)} />
                )
              }
            />
          </Card>
        ) : (
          <ListCard inset={64}>
            {servers.map((server, index) => (
              <ServerRow
                key={server.name}
                server={server}
                index={index}
                confirming={confirmRemove === server.name}
                busy={busyRemove === server.name}
                onRemove={() => {
                  void haptic('warn')
                  setConfirmRemove(server.name)
                }}
                onConfirmRemove={() => void removeServer(server.name)}
              />
            ))}
          </ListCard>
        )}
      </Section>

      <FormSheet
        open={addOpen}
        onClose={() => setAddOpen(false)}
        eyebrow="MCP"
        title="Add a server"
        submitLabel={addBusy ? 'Adding…' : 'Add server'}
        onSubmit={() => void addServer()}
        busy={addBusy}
        disabled={!newName.trim()}
      >
        <Field
          label="Name"
          value={newName}
          onChangeText={setNewName}
          placeholder="github"
          autoCapitalize="none"
          autoCorrect={false}
          accessibilityLabel="Server name"
        />
        <Field
          label="Command"
          value={newCommand}
          onChangeText={setNewCommand}
          placeholder="npx -y @modelcontextprotocol/server-github"
          autoCapitalize="none"
          autoCorrect={false}
          mono
          accessibilityLabel="Server command"
          hint="Optional — leave blank to use the desktop's default for this name."
        />
      </FormSheet>
    </ScreenScaffold>
  )
}

/**
 * One server row.
 *
 * Its own component so the entry animation's value is created by a hook on a
 * stable component rather than inside a `.map` callback. Removing is the
 * two-step destructive grammar: a ghost button in the danger colour first, a
 * filled danger-soft confirm second — the escalation itself is the warning.
 */
function ServerRow({
  server,
  index,
  confirming,
  busy,
  onRemove,
  onConfirmRemove,
}: {
  server: McpServer
  index: number
  confirming: boolean
  busy: boolean
  onRemove: () => void
  onConfirmRemove: () => void
}) {
  const enter = useEnter(staggerDelay(Math.min(index, 5)), false)
  const active = server.enabled !== false
  return (
    <View style={rowEnterStyle(enter)}>
      <View className="min-h-16 flex-row items-center gap-3 px-4 py-3">
        <IconTile icon={<Server size={16} color={palette.accent} />} tone="accent" />
        <View className="min-w-0 flex-1 gap-0.5">
          <Text className="text-[15.5px] leading-[21px] font-medium text-ink" numberOfLines={1}>
            {server.name}
          </Text>
          {server.command ? (
            <Mono className="text-[11.5px] leading-[15px]" numberOfLines={1}>
              {server.command}
            </Mono>
          ) : null}
        </View>
        <Badge tone={active ? 'ok' : 'muted'} outline>
          {active ? 'active' : 'disabled'}
        </Badge>
        {confirming ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Confirm removing ${server.name}`}
            disabled={busy}
            onPress={onConfirmRemove}
            hitSlop={8}
            className="min-h-9 flex-row items-center justify-center rounded-sm border px-3 active:opacity-70"
            style={{ borderColor: palette.dangerBorder, backgroundColor: palette.dangerSoft, opacity: busy ? 0.5 : 1 }}
          >
            <Text className="text-[12px] leading-[16px] font-bold text-danger">
              {busy ? 'Removing…' : 'Confirm remove'}
            </Text>
          </Pressable>
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Remove ${server.name}`}
            onPress={onRemove}
            hitSlop={8}
            className="min-h-9 flex-row items-center justify-center rounded-sm border border-line px-3 active:bg-raised"
          >
            <Text className="text-[12px] leading-[16px] font-semibold text-danger">Remove</Text>
          </Pressable>
        )}
      </View>
    </View>
  )
}
