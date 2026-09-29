/**
 * MCP Servers — manage Model Context Protocol servers.
 *
 * Lists configured MCP servers, allows adding new ones and removing existing.
 * Mirrors the desktop's MCP configuration panel.
 */

import * as React from 'react'
import { FlatList, Pressable, RefreshControl, Text, TextInput, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useNavigation } from '@react-navigation/native'
import type { DrawerNavigationProp } from '@react-navigation/drawer'
import { Plus, RefreshCw, Server, Trash2 } from 'lucide-react-native'

import { mcpApi } from '@app/lib/api'
import type { DrawerParamList } from '@app/navigation'
import {
  Button,
  Card,
  CardHeader,
  Chip,
  Dot,
  EmptyState,
  GlassSurface,
  Mono,
  PageHeader,
} from '@app/components/ui'
import { palette } from '@app/design/tokens'

interface McpServer {
  name: string
  command?: string
  enabled?: boolean
}

export function McpScreen() {
  const navigation = useNavigation<DrawerNavigationProp<DrawerParamList>>()
  const [servers, setServers] = React.useState<McpServer[]>([])
  const [loading, setLoading] = React.useState(false)
  const [refreshing, setRefreshing] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [addOpen, setAddOpen] = React.useState(false)
  const [newName, setNewName] = React.useState('')
  const [newCommand, setNewCommand] = React.useState('')
  const [addBusy, setAddBusy] = React.useState(false)
  const [confirmRemove, setConfirmRemove] = React.useState<string | null>(null)

  const load = React.useCallback(async () => {
    setError(null)
    try {
      const res = await mcpApi.list()
      setServers(res.servers ?? [])
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load MCP servers')
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

  async function addServer() {
    if (!newName.trim()) return
    setAddBusy(true)
    setError(null)
    try {
      await mcpApi.add({ name: newName.trim(), ...(newCommand.trim() ? { command: newCommand.trim() } : {}) })
      setNewName('')
      setNewCommand('')
      setAddOpen(false)
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not add MCP server')
    } finally {
      setAddBusy(false)
    }
  }

  async function removeServer(name: string) {
    setError(null)
    try {
      await mcpApi.remove(name)
      setConfirmRemove(null)
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not remove MCP server')
    }
  }

  return (
    <SafeAreaView className="flex-1 bg-canvas" edges={['top']}>
      <PageHeader
        onMenu={() => navigation.openDrawer()}
        title="MCP Servers"
        right={
          <Button
            variant="ghost"
            label="Add"
            className="min-h-9 px-3"
            onPress={() => setAddOpen(true)}
          />
        }
      />

      <FlatList
        data={servers}
        keyExtractor={(item) => item.name}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={palette.ink3} />}
        ListHeaderComponent={
          <View className="gap-3 px-4 pt-5 pb-3">
            <View className="gap-1.5">
              <Mono className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-3">Integration</Mono>
              <Text className="text-[24px] font-bold tracking-tight text-ink" style={{ letterSpacing: -0.5 }}>MCP Servers</Text>
              <Text className="text-[14px] leading-5 text-ink-2">
                MCP servers give agents access to external tools and data sources. Configure them here
                and they become available across all sessions.
              </Text>
            </View>

            {error ? (
              <View className="rounded-xl border border-red-border bg-red-tint px-3.5 py-2.5">
                <Text className="text-[13px] leading-5 text-ink">{error}</Text>
              </View>
            ) : null}
          </View>
        }
        renderItem={({ item }) => (
          <View className="mx-4 mb-2">
            <Card>
              <View className="flex-row items-center gap-3 p-3.5">
                <View className="size-9 items-center justify-center rounded-lg bg-accent-tint">
                  <Server size={16} color={palette.accent} />
                </View>
                <View className="min-w-0 flex-1">
                  <Text className="text-[13px] font-medium text-ink" numberOfLines={1}>
                    {item.name}
                  </Text>
                  {item.command ? (
                    <Mono className="mt-0.5 text-[10.5px] text-ink-3" numberOfLines={1}>
                      {item.command}
                    </Mono>
                  ) : null}
                </View>
                <Chip
                  tone={item.enabled !== false ? 'green' : 'dim'}
                  label={item.enabled !== false ? 'active' : 'disabled'}
                />
                {confirmRemove === item.name ? (
                  <Pressable
                    onPress={() => void removeServer(item.name)}
                    className="min-h-8 rounded-lg bg-red-tint px-2.5 items-center justify-center"
                  >
                    <Text className="text-[10.5px] font-semibold text-red">Confirm</Text>
                  </Pressable>
                ) : (
                  <Pressable
                    onPress={() => setConfirmRemove(item.name)}
                    accessibilityLabel={`Remove ${item.name}`}
                    className="size-8 items-center justify-center rounded-lg active:bg-red-tint"
                  >
                    <Trash2 size={14} color={palette.ink3} />
                  </Pressable>
                )}
              </View>
            </Card>
          </View>
        )}
        ListEmptyComponent={
          !loading ? (
            <EmptyState
              title="No MCP servers"
              body="Add an MCP server to give agents access to external tools and data."
            />
          ) : null
        }
        contentContainerClassName="pb-10"
      />

      {/* Add server modal */}
      {addOpen ? (
        <View className="absolute inset-0 z-30 justify-end bg-black/65">
          <Pressable className="absolute inset-0" onPress={() => setAddOpen(false)} accessibilityLabel="Close" />
          <GlassSurface radius={20} className="border-t border-line">
            <View className="p-4 pb-8 gap-3">
              <Mono className="text-[10px] uppercase tracking-[0.14em] text-ink-3">Add MCP Server</Mono>
              <TextInput
                value={newName}
                onChangeText={setNewName}
                placeholder="Server name"
                placeholderTextColor={palette.ink3}
                autoCapitalize="none"
                autoCorrect={false}
                className="min-h-11 rounded-lg border border-line bg-field px-3 text-[13px] text-ink"
              />
              <TextInput
                value={newCommand}
                onChangeText={setNewCommand}
                placeholder="Command (optional)"
                placeholderTextColor={palette.ink3}
                autoCapitalize="none"
                autoCorrect={false}
                className="min-h-11 rounded-lg border border-line bg-field px-3 font-mono text-[12px] text-ink"
              />
              <View className="flex-row gap-2">
                <Button
                  variant="primary"
                  label={addBusy ? 'Adding…' : 'Add server'}
                  disabled={addBusy || !newName.trim()}
                  onPress={() => void addServer()}
                />
                <Button variant="ghost" label="Cancel" onPress={() => setAddOpen(false)} />
              </View>
            </View>
          </GlassSurface>
        </View>
      ) : null}
    </SafeAreaView>
  )
}
