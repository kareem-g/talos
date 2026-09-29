/**
 * MCP servers — the tools this desktop can call.
 *
 * One screen, two jobs that are genuinely different and were previously both
 * crammed into the same card: **listing** what is installed, and **adding**
 * something new. Adding is a form sheet rather than a row of inputs injected
 * into the list, because a form that appears and disappears with the list is a
 * form you cannot scroll away from once you have made a mistake.
 *
 * Removing is two-step and immediate rather than a confirm dialog: the row
 * swaps to "Confirm" and the tap that completes it is the one you have to aim
 * at deliberately. A dialog for deleting one server is heavier than the action
 * deserves, and the two-step row is the pattern iOS itself uses for exactly
 * this case.
 */

import * as React from 'react'
import { Pressable, Text, View } from 'react-native'
import { useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { Plus, Server } from 'lucide-react-native'

import { mcpApi } from '@app/lib/api'
import type { RootStackParamList } from '@app/navigation'
import { palette, radius } from '@app/design/tokens'
import { BackButton, ScreenScaffold, Section } from '@app/components/Screen'
import { rowEnterStyle, staggerDelay, useEnter } from '@app/components/motion'
import { FormSheet } from '@app/components/Sheet'
import {
  Badge,
  Button,
  Card,
  Divider,
  EmptyState,
  Field,
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
      contentClassName="px-4 pb-12 gap-5"
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
        <View
          accessible
          accessibilityRole="alert"
          style={{
            gap: 9,
            borderRadius: radius.md,
            borderWidth: 1,
            borderColor: palette.dangerBorder,
            backgroundColor: palette.dangerSoft,
            padding: 14,
          }}
        >
          <Text className="text-[13.5px] font-semibold text-ink">{error}</Text>
          <Button size="sm" variant="secondary" label="Retry" onPress={() => void load()} />
        </View>
      ) : null}

      <Section eyebrow="Installed" title={servers.length > 0 ? `${servers.length} ${servers.length === 1 ? 'server' : 'servers'}` : undefined} enterIndex={0}>
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
          <Card>
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
          </Card>
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
 * stable component rather than inside a `.map` callback.
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
  const enter = useEnter(staggerDelay(index), false)
  return (
    <View style={rowEnterStyle(enter)}>
      {index > 0 ? <Divider inset={60} /> : null}
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, padding: 14 }}>
        <View
          style={{
            width: 36,
            height: 36,
            borderRadius: radius.sm,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: palette.accentSoft,
          }}
        >
          <Server size={16} color={palette.accent} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text className="text-[14.5px] font-medium text-ink" numberOfLines={1}>
            {server.name}
          </Text>
          {server.command ? (
            <Text
              style={{ color: palette.ink3, fontSize: 11.5, fontFamily: 'Menlo', marginTop: 1 }}
              numberOfLines={1}
            >
              {server.command}
            </Text>
          ) : null}
        </View>
        <Badge tone={server.enabled !== false ? 'ok' : 'muted'} outline>
          {server.enabled !== false ? 'active' : 'disabled'}
        </Badge>
        {confirming ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Confirm removing ${server.name}`}
            disabled={busy}
            onPress={onConfirmRemove}
            style={({ pressed }) => ({
              minHeight: 34,
              justifyContent: 'center',
              borderRadius: radius.sm,
              borderWidth: 1,
              borderColor: palette.dangerBorder,
              backgroundColor: pressed ? palette.dangerSoft : 'transparent',
              paddingHorizontal: 11,
            })}
          >
            <Text style={{ color: palette.danger, fontSize: 12, fontWeight: '700' }}>
              {busy ? '…' : 'Remove'}
            </Text>
          </Pressable>
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Remove ${server.name}`}
            onPress={onRemove}
            hitSlop={8}
            style={({ pressed }) => ({
              width: 34,
              height: 34,
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: radius.pill,
              backgroundColor: pressed ? palette.dangerSoft : 'transparent',
            })}
          >
            <Text style={{ color: palette.ink3, fontSize: 17 }}>×</Text>
          </Pressable>
        )}
      </View>
    </View>
  )
}
