/**
 * Agents — what this desktop can actually run.
 *
 * The desktop lists agents as a configuration page with a card per agent. The
 * phone asks a different and more practical question, and it is almost always
 * asked from the wrong screen: **why did my task fail?** — which is usually
 * because a CLI is not installed, or not on the daemon's PATH, or needs auth.
 *
 * So this page leads with *readiness*, and every agent is a row that opens a
 * detail screen rather than a card that occupies a whole screen. With eight
 * agents installed, a card per agent is roughly nine screens of scrolling to
 * answer a yes/no question; a row is nine lines.
 *
 * The capability chips are ordered by how often they decide whether an agent is
 * usable for a given job, not alphabetically — approvals first, because a tool
 * that cannot ask permission cannot be supervised from a phone, which is the
 * main reason to care.
 */

import * as React from 'react'
import { Pressable, Text, View } from 'react-native'
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { Bot, ChevronRight, RefreshCw } from 'lucide-react-native'

import { providersApi } from '@app/lib/api'
import type { RootStackParamList } from '@app/navigation'
import { useStore, type MobileAgent } from '@app/store'
import { agentColor, palette, radius } from '@app/design/tokens'
import { ListCard, ScreenScaffold, Section } from '@app/components/Screen'
import { rowEnterStyle, staggerDelay, useEnter } from '@app/components/motion'
import {
  AgentAvatar,
  Badge,
  Button,
  Card,
  Dot,
  EmptyState,
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

  return (
    <ScreenScaffold
      title="Agents"
      eyebrow={desktopName}
      subtitle={
        ready > 0
          ? `${ready} of ${agents.length} ready to start a task from here.`
          : 'Nothing is installed on the desktop yet.'
      }
      onRefresh={() => void refresh()}
      refreshing={refreshing}
      contentClassName="pb-10"
      headerRight={
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Re-scan for agents"
          onPress={() => {
            void haptic('light')
            void refresh()
          }}
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
      <Section enterIndex={0} title="Readiness" eyebrow="This desktop">
        <Card>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14, padding: 16 }}>
            <View
              style={{
                width: 52,
                height: 52,
                borderRadius: radius.lg,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: ready > 0 ? palette.okSoft : palette.dangerSoft,
              }}
            >
              <Text
                style={{
                  color: ready > 0 ? palette.ok : palette.danger,
                  fontSize: 20,
                  fontWeight: '700',
                  fontVariant: ['tabular-nums'],
                }}
              >
                {ready}
              </Text>
            </View>
            <View style={{ flex: 1, minWidth: 0, gap: 3 }}>
              <Text className="text-[16px] font-semibold text-ink" style={{ letterSpacing: -0.2 }}>
                {ready === agents.length && ready > 0
                  ? 'All agents ready'
                  : `${ready} of ${agents.length} ready`}
              </Text>
              <Text className="text-[13px] leading-[18px] text-ink-3">
                {ready > 0
                  ? 'Start a task with any of them straight from this phone.'
                  : 'Install a supported CLI on the desktop, then re-scan.'}
              </Text>
            </View>
            <View style={{ alignItems: 'flex-end', gap: 4 }}>
              <Dot tone={connection === 'connected' ? 'ok' : 'danger'} pulse={connection !== 'connected'} />
            </View>
          </View>
        </Card>
      </Section>

      {capabilities.length > 0 ? (
        <Section enterIndex={1} eyebrow="Across this fleet" title="Capabilities">
          <Card>
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, padding: 14 }}>
              {capabilities.map((capability) => (
                <Badge key={capability.key} tone="accent" outline>
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
          <ListCard inset={60}>
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
    <View style={rowEnterStyle(enter)}>
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
        <View style={{ flex: 1, minWidth: 0, gap: 5 }}>
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text className="min-w-0 flex-1 text-[15.5px] font-semibold text-ink" numberOfLines={1}>
              {agent.name}
            </Text>
            <StatusPill
              tone={available ? 'ok' : 'danger'}
              label={available ? 'Ready' : 'Not found'}
              size="sm"
            />
          </View>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 5 }}>
            {present.length === 0 ? (
              <Text className="text-[11.5px] text-ink-3">No capabilities reported</Text>
            ) : (
              <>
                {present.slice(0, 3).map((capability) => (
                  <Badge key={capability.key}>{capability.label}</Badge>
                ))}
                {present.length > 3 ? <Badge>+{present.length - 3}</Badge> : null}
              </>
            )}
          </View>
        </View>
        {onLaunch ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Start a task on ${agent.name}`}
            onPress={onLaunch}
            hitSlop={10}
            style={({ pressed }) => ({
              minHeight: 34,
              justifyContent: 'center',
              borderRadius: radius.pill,
              backgroundColor: pressed ? palette.accentPressed : palette.accent,
              paddingHorizontal: 13,
            })}
          >
            <Text style={{ color: palette.accentInk, fontSize: 12.5, fontWeight: '700' }}>Launch</Text>
          </Pressable>
        ) : (
          <ChevronRight size={17} color={palette.ink4} />
        )}
      </Pressable>
    </View>
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
      contentClassName="px-4 pb-10 gap-4"
      headerLeft={
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Back to agents"
          onPress={() => navigation.goBack()}
          hitSlop={10}
          style={({ pressed }) => ({
            minHeight: 38,
            justifyContent: 'center',
            borderRadius: radius.pill,
            backgroundColor: pressed ? palette.raised : 'transparent',
            paddingHorizontal: 10,
          })}
        >
          <Text className="text-[14.5px] font-semibold text-accent">Agents</Text>
        </Pressable>
      }
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 14 }}>
        <AgentAvatar agent={agent.id} size={56} name={agent.name} />
        <View style={{ flex: 1, gap: 5 }}>
          <Text className="text-[19px] font-semibold text-ink" style={{ letterSpacing: -0.3 }}>
            {agent.name}
          </Text>
          <StatusPill
            tone={available ? 'ok' : 'danger'}
            label={available ? 'Ready to launch' : 'Not found on the desktop'}
          />
        </View>
      </View>

      <Card>
        <View style={{ padding: 14, gap: 8 }}>
          <Mono className="text-[12.5px] text-ink-2">{agent.id}</Mono>
          {agent.protocol ? (
            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 7 }}>
              <Dot tone="muted" />
              <Text className="text-[12.5px] text-ink-3">{agent.protocol}</Text>
            </View>
          ) : null}
          {!available ? (
            <Text className="mt-1 text-[13px] leading-[18px] text-ink-3">
              The daemon could not find this CLI on its PATH. Install it on the desktop, then
              re-scan from the Agents tab.
            </Text>
          ) : null}
        </View>
        {available ? (
          <View style={{ borderTopWidth: 1, borderTopColor: palette.line, padding: 14 }}>
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
        <View style={{ gap: 9 }}>
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
            Capabilities
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {present.map((capability) => (
              <Badge key={capability.key} tone="accent">
                {capability.label}
              </Badge>
            ))}
          </View>
        </View>
      ) : null}

      {models.length > 0 ? (
        <View style={{ gap: 9 }}>
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
            Models · {models.length}
          </Text>
          <Card>
            <View style={{ paddingVertical: 6 }}>
              {models.map((model, index) => (
                <View
                  key={index}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 10,
                    minHeight: 40,
                    paddingHorizontal: 14,
                    borderTopWidth: index === 0 ? 0 : 1,
                    borderTopColor: palette.line,
                  }}
                >
                  <View
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
              ))}
            </View>
          </Card>
        </View>
      ) : null}

      {reasoning.length > 0 ? (
        <View style={{ gap: 9 }}>
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
            Reasoning levels
          </Text>
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
            {reasoning.map((level, index) => (
              <Badge key={index} outline>
                {typeof level === 'string' ? level : ((level as { id?: string }).id ?? 'unknown')}
              </Badge>
            ))}
          </View>
        </View>
      ) : null}
    </ScreenScaffold>
  )
}
