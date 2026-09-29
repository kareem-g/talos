/**
 * Agents — provider discovery.
 *
 * Mirrors the desktop `AgentsPage`: every agent CLI the daemon found, whether it
 * is ready, and what it can do (streaming, approvals, plan mode, model switch,
 * reasoning, structured questions, terminal). Same data source shape — the
 * mobile snapshot returns the same descriptor objects as `/api/agents`.
 *
 * The desktop's "Re-scan" forces the daemon to re-probe `$PATH`; the mobile API
 * has no such endpoint, so this refreshes from the daemon instead of pretending
 * to trigger a scan it cannot.
 */

import * as React from 'react'
import { FlatList, RefreshControl, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useNavigation } from '@react-navigation/native'
import type { DrawerNavigationProp } from '@react-navigation/drawer'

import { useStore } from '@app/store'
import { providersApi } from '@app/lib/api'
import type { DrawerParamList } from '@app/navigation'
import {
  Button,
  Card,
  CardHeader,
  Chip,
  Dot,
  EmptyState,
  Mono,
  PageHeader,
  SectionHeading,
} from '@app/components/ui'
import { palette } from '@app/design/tokens'

/** The capability flags the desktop renders as chips, in the same order. */
const CAPABILITIES: Array<{ key: string; label: string }> = [
  { key: 'supportsStreaming', label: 'stream' },
  { key: 'supportsApproval', label: 'approvals' },
  { key: 'supportsPlan', label: 'plan' },
  { key: 'supportsModelSwitch', label: 'model switch' },
  { key: 'supportsReasoning', label: 'reasoning' },
  { key: 'supportsStructuredQuestions', label: 'questions' },
  { key: 'supportsTerminal', label: 'terminal' },
]

export function AgentsScreen() {
  const navigation = useNavigation<DrawerNavigationProp<DrawerParamList>>()
  const agents = useStore((s) => s.agents)
  const desktopName = useStore((s) => s.desktopName)
  const loadSnapshot = useStore((s) => s.loadSnapshot)
  const [refreshing, setRefreshing] = React.useState(false)

  const ready = agents.filter((agent) => agent.available).length

  async function refresh() {
    setRefreshing(true)
    try {
      // Force the daemon to re-probe $PATH for agent CLIs, then reload the snapshot.
      await providersApi.refresh()
      await loadSnapshot()
    } catch {
      // If refresh fails, still try to reload what we have.
      await loadSnapshot()
    }
    setRefreshing(false)
  }

  return (
    <SafeAreaView className="flex-1 bg-canvas" edges={['top']}>
      <PageHeader
        onMenu={() => navigation.openDrawer()}
        title="Agents"
        right={<Button variant="ghost" label={refreshing ? '…' : 'Refresh'} className="min-h-9 px-3" onPress={() => void refresh()} />}
      />
      <FlatList
        data={agents}
        keyExtractor={(agent) => agent.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={refresh} tintColor={palette.ink3} />}
        ListHeaderComponent={
          <View className="px-4 pt-5 pb-3">
            <Mono className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-3">Products</Mono>
            <Text className="mt-1 text-[24px] font-bold tracking-tight text-ink" style={{ letterSpacing: -0.5 }}>Coding Agents</Text>
            <Text className="mt-1.5 text-[14px] leading-5 text-ink-2">
              {ready} of {agents.length} ready on {desktopName}.
            </Text>
          </View>
        }
        renderItem={({ item }) => <AgentCard agent={item} />}
        ListEmptyComponent={
          <EmptyState
            title="No agents detected"
            body="Install a supported agent CLI on the desktop machine, then refresh."
          />
        }
        contentContainerClassName="gap-3 px-4 pb-10"
      />
    </SafeAreaView>
  )
}

function AgentCard({ agent }: { agent: import('@app/store').MobileAgent }) {
  const capabilities = (agent.capabilities ?? {}) as Record<string, boolean>
  const models = Array.isArray(agent.models) ? agent.models : []
  const reasoning = Array.isArray(agent.reasoningLevels) ? agent.reasoningLevels : []

  return (
    <Card>
      <CardHeader
        title={agent.name}
        right={<Chip tone={agent.available ? 'green' : 'dim'} label={agent.available ? 'Ready' : 'Not found'} />}
      />
      <View className="gap-3 p-4">
        <View className="flex-row items-center gap-2">
          <Dot tone={agent.available ? 'green' : 'dim'} />
          <Mono className="min-w-0 flex-1 text-[12px] font-medium" numberOfLines={1}>
            {agent.id}
            {agent.protocol ? ` · ${agent.protocol}` : ''}
          </Mono>
        </View>

        {models.length > 0 ? (
          <View className="gap-1">
            <Mono className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-3">Models</Mono>
            <Text className="text-[13px] leading-5 text-ink-2" numberOfLines={3}>
              {models
                .map((model) => (typeof model === 'string' ? model : (model as { id?: string }).id ?? ''))
                .filter(Boolean)
                .join(', ')}
            </Text>
          </View>
        ) : null}

        {reasoning.length > 0 ? (
          <View className="gap-1">
            <Mono className="text-[10px] font-semibold uppercase tracking-[0.16em] text-ink-3">Reasoning</Mono>
            <Text className="text-[13px] text-ink-2">
              {reasoning.map((level) => (typeof level === 'string' ? level : (level as { id?: string }).id ?? '')).join(' · ')}
            </Text>
          </View>
        ) : null}

        <View className="flex-row flex-wrap gap-1.5 pt-1">
          {CAPABILITIES.filter((capability) => capabilities[capability.key]).map((capability) => (
            <Chip key={capability.key} label={capability.label} />
          ))}
        </View>
      </View>
    </Card>
  )
}
