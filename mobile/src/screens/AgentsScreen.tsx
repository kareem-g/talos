/**
 * Agents — what this deck can actually run.
 *
 * QAI SIGNAL DECK
 * ---------------
 * The phone asks one practical question, usually from the wrong screen:
 * **why did my task fail?** — a CLI missing, off PATH, or unauthed. So this
 * page leads with *readiness* as one slab: a large figure (how many engines
 * can work right now), signal-edged when all ready, with connection truth
 * beside it. Every agent is a row opening a detail sheet rather than a card
 * per agent. Capability chips stay ordered by what decides a job — approvals
 * first, because a tool that cannot ask cannot be supervised from a pocket.
 */

import * as React from 'react'
import {
  Animated,
  Pressable,
  View,
} from 'react-native'
import { Text } from '@app/components/Text'
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { Bot, ChevronRight, RefreshCw } from 'lucide-react-native'

import { providersApi } from '@app/lib/api'
import type { RootStackParamList } from '@app/navigation'
import { useStore, type MobileAgent } from '@app/store'
import { agentColor, palette } from '@app/design/tokens'
import { ListCard, ScreenScaffold, Section, StationBackButton } from '@app/components/Screen'
import { rowEnterStyle, staggerDelay, useEnter } from '@app/components/motion'
import {
  AgentAvatar,
  Badge,
  Button,
  Card,
  EmptyState,
  Eyebrow,
  IconButton,
  KeyValue,
  Mono,
  StatusPill,
  haptic,
  toast,
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

/** Connection state, as a pill — the dot never travels without its word. */
function connectionStatus(connection: string): { tone: 'ok' | 'wait' | 'danger'; label: string } {
  if (connection === 'connected') return { tone: 'ok', label: 'Connected' }
  if (connection === 'connecting' || connection === 'reconnecting')
    return { tone: 'wait', label: 'Reconnecting' }
  return { tone: 'danger', label: 'Offline' }
}

export function AgentsScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const agents = useStore((state) => state.agents)
  const desktopName = useStore((state) => state.desktopName)
  const connection = useStore((state) => state.connection)
  const loadSnapshot = useStore((state) => state.loadSnapshot)
  const createSession = useStore((state) => state.createSession)
  const [refreshing, setRefreshing] = React.useState(false)

  const ready = agents.filter((agent) => agent.available).length
  const capabilities = React.useMemo(
    () => CAPABILITIES.filter((capability) => agents.some((agent) => (agent.capabilities ?? {})[capability.key])),
    [agents],
  )

  const refresh = React.useCallback(async () => {
    setRefreshing(true)
    try {
      // Force the daemon to re-probe $PATH for agent CLIs, then reload. If the
      // forced scan fails, still show what we already had rather than replacing
      // a working list with an error.
      await providersApi.refresh()
      await loadSnapshot()
      toast({ message: 'Re-scanned $PATH', tone: 'ok' })
    } catch (cause) {
      toast({
        message: 'Could not re-scan',
        detail: cause instanceof Error ? cause.message : undefined,
        tone: 'danger',
      })
      await loadSnapshot()
    } finally {
      setRefreshing(false)
    }
  }, [loadSnapshot])

  const status = connectionStatus(connection)

  return (
    <ScreenScaffold
      title="Agents"
      eyebrow={`Products · ${desktopName}`}
      subtitle={
        ready > 0
          ? `${ready} of ${agents.length} ready to start a task from here.`
          : 'Nothing is installed on the desktop yet.'
      }
      onRefresh={() => void refresh()}
      refreshing={refreshing}
      contentClassName="pb-10"
      headerLeft={<StationBackButton />}
      headerRight={
        <IconButton
          label="Re-scan for agents"
          size={38}
          tone="accent"
          active={refreshing}
          onPress={() => {
            void haptic('light')
            void refresh()
          }}
        >
          <RefreshCw size={18} color={refreshing ? palette.accent : palette.ink2} />
        </IconButton>
      }
    >
      <Section enterIndex={0} title="Readiness" eyebrow="Roster">
        <Card className="overflow-hidden">
          {/* Signal edge: lit when something can run. */}
          <View style={{ height: 2, backgroundColor: ready > 0 ? palette.ok : palette.lineStrong }} />
          {/* The hero figure is the answer to the question this page exists for.
              Everything else on the card is commentary on it. */}
          <View className="flex-row items-center gap-4 p-4">
            <Text
              className="shrink-0 text-[34px] font-bold text-ink"
              style={{ lineHeight: 40, letterSpacing: -0.8, fontVariant: ['tabular-nums'] }}
            >
              {ready}
            </Text>
            <View className="min-w-0 flex-1 gap-0.5">
              <Text
                className="text-[15px] leading-[20px] font-semibold text-ink"
                numberOfLines={1}
                style={{ letterSpacing: -0.2 }}
              >
                {agents.length === 0
                  ? 'No agents on the desktop yet'
                  : ready === agents.length
                    ? 'All agents ready'
                    : `of ${agents.length} ${agents.length === 1 ? 'agent' : 'agents'} ready`}
              </Text>
              <Text className="text-[12px] leading-[16px] text-ink-3" numberOfLines={2}>
                {ready > 0
                  ? 'Start a task with any of them straight from this phone.'
                  : 'Install a supported CLI on the desktop, then re-scan.'}
              </Text>
            </View>
            <StatusPill
              tone={status.tone}
              label={status.label}
              size="sm"
              pulse={connection !== 'connected'}
            />
          </View>
        </Card>
      </Section>

      {capabilities.length > 0 ? (
        <Section enterIndex={1} eyebrow="Across the fleet" title="Capabilities">
          <Card>
            <View className="flex-row flex-wrap gap-2 p-4">
              {capabilities.map((capability) => (
                <Badge key={capability.key} outline>
                  {capability.label}
                </Badge>
              ))}
            </View>
          </Card>
        </Section>
      ) : null}

      <Section
        enterIndex={2}
        eyebrow={agents.length > 0 ? 'Detected' : undefined}
        title={agents.length > 0 ? `${agents.length} ${agents.length === 1 ? 'agent' : 'agents'}` : undefined}
      >
        {agents.length === 0 ? (
          <Card>
            <EmptyState
              title="No agents detected"
              body="Install a supported agent CLI — Claude Code, Codex, OpenCode, Grok Build — on the desktop, then re-scan."
              icon={<Bot size={22} color={palette.ink3} />}
              action={
                <Button
                  size="sm"
                  variant="primary"
                  label="Re-scan"
                  accessibilityLabel="Re-scan for agents"
                  onPress={() => void refresh()}
                />
              }
            />
          </Card>
        ) : (
          <ListCard inset={64}>
            {agents.map((agent, index) => (
              <View key={agent.id}>
                <AgentRow
                  agent={agent}
                  index={index}
                  onPress={() => {
                    void haptic('light')
                    navigation.navigate('AgentDetail', { agentId: agent.id })
                  }}
                  onLaunch={
                    agent.available
                      ? async () => {
                          void haptic('medium')
                          const created = await createSession({ agent: agent.id })
                          if (created) {
                            toast({ message: `Started on ${agent.name}`, tone: 'ok' })
                            navigation.navigate('Session', { sessionId: created.id })
                          } else {
                            toast({ message: 'The desktop refused to start that session', tone: 'danger' })
                          }
                        }
                      : undefined
                  }
                />
              </View>
            ))}
          </ListCard>
        )}
      </Section>
    </ScreenScaffold>
  )
}

function AgentRow({
  agent,
  index,
  onPress,
  onLaunch,
}: {
  agent: MobileAgent
  index: number
  onPress: () => void
  onLaunch?: () => void
}) {
  const enter = useEnter(staggerDelay(index), false)
  const available = Boolean(agent.available)
  const capabilities = (agent.capabilities ?? {}) as Record<string, boolean>
  const present = CAPABILITIES.filter((capability) => capabilities[capability.key])

  return (
    <Animated.View style={rowEnterStyle(enter)}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={agent.name}
        accessibilityHint={
          available
            ? `${present.length} capabilities. Opens the full detail.`
            : 'Not found on the desktop. Opens the full detail.'
        }
        onPress={onPress}
        className="min-h-16 flex-row items-center gap-3 px-4 py-3 active:bg-raised"
      >
        <AgentAvatar agent={agent.id} size={36} name={agent.name} />
        <View className="min-w-0 flex-1 gap-1.5">
          <View className="flex-row items-center gap-2">
            <Text
              className="min-w-0 flex-1 text-[14.5px] leading-[20px] font-semibold text-ink"
              numberOfLines={1}
              style={{ letterSpacing: -0.1 }}
            >
              {agent.name}
            </Text>
            <StatusPill
              tone={available ? 'ok' : 'danger'}
              label={available ? 'Ready' : 'Not found'}
              size="sm"
            />
          </View>
          <View className="flex-row flex-wrap gap-1.5">
            {present.length === 0 ? (
              <Text className="text-[11.5px] leading-[15px] text-ink-3">No capabilities reported</Text>
            ) : (
              <>
                {present.slice(0, 3).map((capability) => (
                  <Badge key={capability.key} outline className="h-5 px-1.5">
                    {capability.label}
                  </Badge>
                ))}
                {present.length > 3 ? (
                  <Badge outline className="h-5 px-1.5">
                    +{present.length - 3}
                  </Badge>
                ) : null}
              </>
            )}
          </View>
        </View>
        {onLaunch ? (
          <Button
            variant="primary"
            size="sm"
            label="Launch"
            accessibilityLabel={`Start a task on ${agent.name}`}
            onPress={onLaunch}
          />
        ) : (
          <ChevronRight size={17} color={palette.ink4} />
        )}
      </Pressable>
    </Animated.View>
  )
}

/* ── Detail ────────────────────────────────────────────────────────────────────
 * The reference information nobody needs while scanning: the ids, the model
 * list, the reasoning levels and the full capability set. It is a screen because
 * it is a *lookup* — you arrive with a specific question ("what model ids does
 * this agent accept?") and you leave with the answer.
 *
 * Declared with no props so it satisfies the navigator's screen contract, and
 * read from the route instead: the navigator hands every screen an empty
 * props object, so a required-prop screen silently renders `undefined` and
 * crashes on first open. */

export function AgentDetailScreen() {
  const route = useRoute<RouteProp<RootStackParamList, 'AgentDetail'>>()
  const agentId = route.params?.agentId ?? ''
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const agents = useStore((state) => state.agents)
  const createSession = useStore((state) => state.createSession)
  const agent = agents.find((entry) => entry.id === agentId)

  const capabilities = (agent?.capabilities ?? {}) as Record<string, boolean>
  const models = Array.isArray(agent?.models) ? agent!.models : []
  const reasoning = Array.isArray(agent?.reasoningLevels) ? agent!.reasoningLevels : []
  const present = CAPABILITIES.filter((capability) => capabilities[capability.key])
  const available = Boolean(agent?.available)

  if (!agent) {
    return (
      <ScreenScaffold title="Agent" scroll contentClassName="p-4">
        <EmptyState title="Not found" body="That agent is no longer reported by the desktop." />
      </ScreenScaffold>
    )
  }

  return (
    <ScreenScaffold
      title={agent.name}
      eyebrow="Agent"
      scroll
      contentClassName="px-4 pb-10 gap-5"
      headerLeft={
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to agents"
          onPress={() => navigation.goBack()}
          hitSlop={10}
          className="min-h-[38px] flex-row items-center rounded-md px-2.5 active:bg-raised"
        >
          <Text className="text-[14.5px] font-semibold text-accent">Agents</Text>
        </Pressable>
      }
    >
      <View className="flex-row items-center gap-3.5">
        <AgentAvatar agent={agent.id} size={56} name={agent.name} />
        <View className="min-w-0 flex-1 gap-1.5">
          <Text
            className="text-[21px] leading-[26px] font-bold text-ink"
            numberOfLines={1}
            style={{ letterSpacing: -0.4 }}
          >
            {agent.name}
          </Text>
          <StatusPill
            tone={available ? 'ok' : 'danger'}
            label={available ? 'Ready to launch' : 'Not found on the desktop'}
            size="sm"
          />
        </View>
      </View>

      <Card>
        <View className="gap-1 p-4">
          <KeyValue label="Id" value={agent.id} />
          {agent.protocol ? <KeyValue label="Protocol" value={agent.protocol} /> : null}
        </View>
        {!available ? (
          <View className="border-t border-line px-4 py-3.5">
            <Text className="text-[13px] leading-[18px] text-ink-3">
              The daemon could not find this CLI on its PATH. Install it on the desktop, then
              re-scan from System → Agents.
            </Text>
          </View>
        ) : null}
        {available ? (
          <View className="border-t border-line p-4">
            <Button
              variant="primary"
              label="Start a task on this agent"
              full
              onPress={async () => {
                void haptic('medium')
                const created = await createSession({ agent: agent.id })
                if (created) navigation.replace('Session', { sessionId: created.id })
                else toast({ message: 'The desktop refused to start that session', tone: 'danger' })
              }}
            />
          </View>
        ) : null}
      </Card>

      {present.length > 0 ? (
        <View className="gap-2.5">
          <Eyebrow>Capabilities</Eyebrow>
          <View className="flex-row flex-wrap gap-1.5">
            {present.map((capability) => (
              <Badge key={capability.key} outline>
                {capability.label}
              </Badge>
            ))}
          </View>
        </View>
      ) : null}

      {models.length > 0 ? (
        <View className="gap-2.5">
          <Eyebrow>Models · {models.length}</Eyebrow>
          <Card>
            {models.map((model, index) => (
              <View key={index}>
                {index > 0 ? <View className="h-px bg-line" style={{ marginLeft: 16 }} /> : null}
                <View className="min-h-10 flex-row items-center gap-2.5 px-4 py-2">
                  <View
                    accessibilityElementsHidden
                    importantForAccessibility="no-hide-descendants"
                    style={{
                      width: 6,
                      height: 6,
                      borderRadius: 3,
                      backgroundColor: agentColor(agent.id),
                    }}
                  />
                  <Mono className="min-w-0 flex-1 text-[12.5px] text-ink-2" numberOfLines={1}>
                    {typeof model === 'string' ? model : ((model as { id?: string }).id ?? 'unknown')}
                  </Mono>
                </View>
              </View>
            ))}
          </Card>
        </View>
      ) : null}

      {reasoning.length > 0 ? (
        <View className="gap-2.5">
          <Eyebrow>Reasoning levels</Eyebrow>
          <View className="flex-row flex-wrap gap-1.5">
            {reasoning.map((level, index) => (
              <Badge key={index} outline mono>
                {typeof level === 'string' ? level : ((level as { id?: string }).id ?? 'unknown')}
              </Badge>
            ))}
          </View>
        </View>
      ) : null}
    </ScreenScaffold>
  )
}
