/**
 * Agents — what this desktop can actually run.
 *
 * The desktop lists agents as a configuration page. On a phone the question is
 * different and more practical: *why did my task fail with "no such agent"?*
 * So this screen leads with readiness — how many are usable right now — and each
 * agent is a row that can be opened, rather than a card that occupies a whole
 * screen.
 *
 * The previous version rendered every agent as a full-width card with a header,
 * an id line, a model list, a reasoning list, and a capability chip row. With
 * eight agents installed that is roughly nine screens of scrolling to answer a
 * yes/no question. Now: a summary, then a list whose collapsed state carries
 * name + readiness + the two capabilities that matter most, and whose expanded
 * state carries the detail.
 *
 * Capability chips are still shown, but ordered by how often they decide
 * whether an agent is usable for a given job, rather than alphabetically.
 */

import * as React from 'react'
import { FlatList, Pressable, RefreshControl, Text, View } from 'react-native'
import { useNavigation } from '@react-navigation/native'
import type { DrawerNavigationProp } from '@react-navigation/drawer'
import { ChevronDown, RefreshCw } from 'lucide-react-native'

import { useStore, type MobileAgent } from '@app/store'
import { providersApi } from '@app/lib/api'
import type { DrawerParamList } from '@app/navigation'
import { agentColor, palette } from '@app/design/tokens'
import {
  Badge,
  Button,
  Card,
  Dot,
  EmptyState,
  ErrorState,
  Eyebrow,
  IconButton,
  MenuButton,
  Mono,
  ScreenHeader,
  haptic,
} from '@app/components/ui'

/**
 * The capability flags, ordered by how often they decide whether this agent can
 * do a given job. Approvals first: a tool that cannot ask permission cannot be
 * supervised from a phone, which is the main reason to care.
 */
const CAPABILITIES: Array<{ key: string; label: string }> = [
  { key: 'supportsApproval', label: 'approvals' },
  { key: 'supportsStreaming', label: 'stream' },
  { key: 'supportsPlan', label: 'plan' },
  { key: 'supportsModelSwitch', label: 'model switch' },
  { key: 'supportsReasoning', label: 'reasoning' },
  { key: 'supportsStructuredQuestions', label: 'questions' },
  { key: 'supportsTerminal', label: 'terminal' },
]

export function AgentsScreen() {
  const navigation = useNavigation<DrawerNavigationProp<DrawerParamList>>()
  const agents = useStore((state) => state.agents)
  const desktopName = useStore((state) => state.desktopName)
  const loadSnapshot = useStore((state) => state.loadSnapshot)

  const [refreshing, setRefreshing] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [expanded, setExpanded] = React.useState<string | null>(null)

  const ready = agents.filter((agent) => agent.available).length

  const refresh = React.useCallback(async () => {
    setRefreshing(true)
    setError(null)
    try {
      // Force the daemon to re-probe $PATH for agent CLIs, then reload. If the
      // forced scan fails, still try to show what we already had rather than
      // replacing a working list with an error.
      await providersApi.refresh()
      await loadSnapshot()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not re-scan for agents')
      await loadSnapshot()
    } finally {
      setRefreshing(false)
    }
  }, [loadSnapshot])

  return (
    <View className="flex-1 bg-canvas">
      <ScreenHeader
        title="Agents"
        subtitle={desktopName}
        left={<MenuButton onPress={() => navigation.openDrawer()} />}
        right={
          <IconButton
            label="Re-scan for agents"
            size={40}
            disabled={refreshing}
            onPress={() => {
              void haptic('light')
              void refresh()
            }}
          >
            <RefreshCw size={18} color={refreshing ? palette.ink3 : palette.ink2} />
          </IconButton>
        }
      />

      <FlatList
        data={agents}
        keyExtractor={(agent) => agent.id}
        contentContainerClassName="gap-3 px-4 pb-8 pt-4"
        refreshControl={
          <RefreshControl
            refreshing={refreshing}
            onRefresh={refresh}
            tintColor={palette.ink3}
            colors={[palette.accent]}
            progressBackgroundColor={palette.surface}
          />
        }
        ListHeaderComponent={
          <View className="gap-3">
            {/* The summary answers the question the screen exists for. */}
            <Card>
              <View className="flex-row items-center gap-3 px-4 py-4">
                <View
                  className="size-11 items-center justify-center rounded-full"
                  style={{ backgroundColor: ready > 0 ? palette.okSoft : palette.dangerSoft }}
                >
                  <Text
                    className="text-[17px] font-bold"
                    style={{ color: ready > 0 ? palette.ok : palette.danger }}
                  >
                    {ready}
                  </Text>
                </View>
                <View className="min-w-0 flex-1">
                  <Text className="text-[15px] font-semibold text-ink">
                    {ready === agents.length && ready > 0
                      ? 'All agents ready'
                      : `${ready} of ${agents.length} ready`}
                  </Text>
                  <Text className="mt-0.5 text-[12px] leading-[16px] text-ink-3">
                    {ready > 0
                      ? 'Available to start a new task from this phone.'
                      : 'Install an agent CLI on the desktop, then re-scan.'}
                  </Text>
                </View>
              </View>
            </Card>
            {error ? <ErrorState message={error} onRetry={() => void refresh()} /> : null}
            {agents.length > 0 ? <Eyebrow>Detected agents</Eyebrow> : null}
          </View>
        }
        renderItem={({ item }) => (
          <AgentCard
            agent={item}
            expanded={expanded === item.id}
            onToggle={() => {
              void haptic('light')
              setExpanded((current) => (current === item.id ? null : item.id))
            }}
          />
        )}
        ListEmptyComponent={
          <Card>
            <EmptyState
              title="No agents detected"
              body="Install a supported agent CLI — Claude Code, Codex, or OpenCode — on the desktop, then re-scan."
              action={
                <Button
                  variant="primary"
                  label="Re-scan"
                  accessibilityLabel="Re-scan for agents"
                  onPress={() => void refresh()}
                />
              }
            />
          </Card>
        }
      />
    </View>
  )
}

/**
 * One agent.
 *
 * Collapsed it answers "is it usable and what can it do". Expanded it shows the
 * ids and model list, which is reference information nobody needs while
 * scanning.
 */
function AgentCard({
  agent,
  expanded,
  onToggle,
}: {
  agent: MobileAgent
  expanded: boolean
  onToggle: () => void
}) {
  const capabilities = (agent.capabilities ?? {}) as Record<string, boolean>
  const models = Array.isArray(agent.models) ? agent.models : []
  const reasoning = Array.isArray(agent.reasoningLevels) ? agent.reasoningLevels : []
  const available = Boolean(agent.available)
  const present = CAPABILITIES.filter((capability) => capabilities[capability.key])

  return (
    <Card>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={agent.name}
        accessibilityHint={
          available
            ? `${present.length} capabilities. Double tap for detail.`
            : 'Not found on the desktop. Double tap for detail.'
        }
        accessibilityState={{ expanded }}
        onPress={onToggle}
        className="min-h-16 flex-row items-center gap-3 px-4 py-3 active:bg-pressed"
      >
        <View
          className="size-9 shrink-0 items-center justify-center rounded-full"
          style={{ backgroundColor: `${agentColor(agent.id)}22` }}
          accessibilityElementsHidden
        >
          <Text className="text-[15px] font-bold" style={{ color: agentColor(agent.id) }}>
            {agent.name.slice(0, 1).toUpperCase()}
          </Text>
        </View>

        <View className="min-w-0 flex-1 gap-1">
          <View className="flex-row items-center gap-2">
            <Text className="min-w-0 flex-1 text-[15px] font-semibold text-ink" numberOfLines={1}>
              {agent.name}
            </Text>
            <Badge tone={available ? 'ok' : 'danger'} outline>
              {available ? 'Ready' : 'Not found'}
            </Badge>
          </View>
          <View className="flex-row flex-wrap gap-1.5">
            {present.length === 0 ? (
              <Text className="text-[11px] text-ink-3">No capabilities reported</Text>
            ) : (
              present.slice(0, 3).map((capability) => (
                <Badge key={capability.key}>{capability.label}</Badge>
              ))
            )}
            {present.length > 3 ? <Badge>+{present.length - 3}</Badge> : null}
          </View>
        </View>

        <ChevronDown
          size={18}
          color={palette.ink3}
          style={{ transform: [{ rotate: expanded ? '180deg' : '0deg' }] }}
        />
      </Pressable>

      {expanded ? (
        <View className="gap-3 border-t border-line px-4 py-3">
          <View className="flex-row items-center gap-2">
            <Dot tone={available ? 'ok' : 'danger'} />
            <Mono className="min-w-0 flex-1 text-[11px]" numberOfLines={1}>
              {agent.id}
              {agent.protocol ? ` · ${agent.protocol}` : ''}
            </Mono>
          </View>

          {models.length > 0 ? (
            <View className="gap-1.5">
              <Eyebrow>Models · {models.length}</Eyebrow>
              <View className="flex-row flex-wrap gap-1.5">
                {models.map((model, index) => (
                  <Badge key={index} outline>
                    {typeof model === 'string' ? model : ((model as { id?: string }).id ?? 'unknown')}
                  </Badge>
                ))}
              </View>
            </View>
          ) : null}

          {reasoning.length > 0 ? (
            <View className="gap-1.5">
              <Eyebrow>Reasoning levels</Eyebrow>
              <View className="flex-row flex-wrap gap-1.5">
                {reasoning.map((level, index) => (
                  <Badge key={index} outline>
                    {typeof level === 'string' ? level : ((level as { id?: string }).id ?? 'unknown')}
                  </Badge>
                ))}
              </View>
            </View>
          ) : null}

          {present.length > 0 ? (
            <View className="gap-1.5">
              <Eyebrow>All capabilities</Eyebrow>
              <View className="flex-row flex-wrap gap-1.5">
                {present.map((capability) => (
                  <Badge key={capability.key} tone="accent">
                    {capability.label}
                  </Badge>
                ))}
              </View>
            </View>
          ) : null}

          {!available ? (
            <Text className="text-[12px] leading-[16px] text-ink-3">
              The daemon could not find this CLI on its PATH. Install it on the
              desktop and re-scan.
            </Text>
          ) : null}
        </View>
      ) : null}
    </Card>
  )
}
