/**
 * Search — the deck's find-everything glance sheet.
 *
 * QAI SIGNAL DECK
 * ---------------
 * The desktop's ⌘K as a 62% sheet: sessions by name/agent/workspace,
 * station actions, and — from inside a session — the transcript itself.
 * A full screen would steal what you were looking at; a glance sheet keeps it
 * behind you and dismisses with a downward flick. Same search and jump
 * handlers.
 */

import * as React from 'react'
import { Pressable, Text, View } from 'react-native'
import {
  Bot,
  Cpu,
  FilePlus,
  GitBranch,
  Globe,
  RefreshCw,
  Server,
  Settings as SettingsIcon,
} from 'lucide-react-native'

import { basename, relativeTime } from '@/lib/format'
import { providersApi } from '@app/lib/api'
import { getConversation, useStore, useConversation } from '@app/store'
import type { Message } from '@/types/conversation'
import { palette, radius } from '@app/design/tokens'
import { Sheet } from '@app/components/Sheet'
import { rowEnterStyle, staggerDelay, useEnter } from '@app/components/motion'
import {
  AgentAvatar,
  Badge,
  EmptyState,
  Eyebrow,
  Mono,
  SearchField,
  haptic,
  toast,
} from '@app/components/ui'
import { useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import type { RootStackParamList } from '@app/navigation'

export function SessionSearchSheet({
  open,
  onClose,
  sessionId,
  onNewTask,
}: {
  open: boolean
  onClose: () => void
  /** When present, the transcript is searchable too. */
  sessionId?: string
  onNewTask?: () => void
}) {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const sessions = useStore((s) => s.sessions)
  const agents = useStore((s) => s.agents)
  const loadSnapshot = useStore((s) => s.loadSnapshot)
  const conversation = useConversation(sessionId ?? '__none__')

  const [query, setQuery] = React.useState('')
  const [busy, setBusy] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (open) setQuery('')
  }, [open])

  const q = query.trim().toLowerCase()
  const providerName = React.useCallback(
    (agentId: string) => agents.find((agent) => agent.id === agentId)?.name ?? agentId,
    [agents],
  )

  const matchingSessions = React.useMemo(() => {
    const pool = q
      ? sessions.filter(
          (session) =>
            session.name.toLowerCase().includes(q) ||
            session.agent.toLowerCase().includes(q) ||
            (session.project ?? '').toLowerCase().includes(q),
        )
      : sessions
    return pool.sort((a, b) => b.updated_at.localeCompare(a.updated_at)).slice(0, q ? 25 : 8)
  }, [q, sessions])

  const transcriptHits = React.useMemo(() => {
    if (!sessionId || !q) return []
    return searchTranscript(conversation.messages, q).slice(0, 6)
  }, [conversation.messages, q, sessionId])

  async function rescan() {
    setBusy('rescan')
    try {
      await providersApi.refresh()
      await loadSnapshot()
      toast({ message: 'Re-scanned $PATH and updated providers', tone: 'ok' })
    } catch {
      toast({ message: 'Could not re-scan providers', tone: 'danger' })
    } finally {
      setBusy(null)
    }
  }

  const actions = [
    ...(onNewTask
      ? [
          {
            key: 'new',
            label: 'Start a new task',
            hint: 'Choose a workspace, an agent and a first prompt',
            icon: <FilePlus size={16} color={palette.accent} />,
            run: () => {
              onClose()
              onNewTask()
            },
          },
        ]
      : []),
    {
      key: 'agents',
      label: 'Agents',
      hint: 'Which CLIs this desktop can run',
      icon: <Bot size={16} color={palette.ink2} />,
      run: () => {
        onClose()
        navigation.navigate('Agents')
      },
    },
    {
      key: 'usage',
      label: 'Usage',
      hint: 'Token spend and cost, per session',
      icon: <Cpu size={16} color={palette.ink2} />,
      run: () => {
        onClose()
        navigation.navigate('Usage')
      },
    },
    {
      key: 'browsers',
      label: 'Browser engines',
      hint: 'Start or stop a workspace engine',
      icon: <Globe size={16} color={palette.ink2} />,
      run: () => {
        onClose()
        navigation.navigate('Browsers')
      },
    },
    {
      key: 'mcp',
      label: 'MCP servers',
      hint: 'External tools this desktop can call',
      icon: <Server size={16} color={palette.ink2} />,
      run: () => {
        onClose()
        navigation.navigate('Mcp')
      },
    },
    {
      key: 'system',
      label: 'System',
      hint: 'Terminals, rooms and the rest of the machinery',
      icon: <Server size={16} color={palette.ink2} />,
      run: () => {
        onClose()
        navigation.navigate('Main', { screen: 'System' } as never)
      },
    },
    {
      key: 'settings',
      label: 'Settings',
      hint: 'Routes, alerts, pairing and this device',
      icon: <SettingsIcon size={16} color={palette.ink2} />,
      run: () => {
        onClose()
        navigation.navigate('Main', { screen: 'Settings' } as never)
      },
    },
    {
      key: 'rescan',
      label: busy === 'rescan' ? 'Re-scanning…' : 'Re-scan $PATH & providers',
      hint: 'Ask the desktop to look for agent CLIs again',
      icon: <RefreshCw size={16} color={palette.ink2} />,
      run: () => void rescan(),
    },
  ]

  const matchingActions = q
    ? actions.filter(
        (action) =>
          action.label.toLowerCase().includes(q) || action.hint.toLowerCase().includes(q),
      )
    : actions.slice(0, 3)

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title="Search"
      eyebrow={sessionId ? 'This device' : undefined}
      snapPoints={[0.62, 0.94]}
    >
      {/* The field leads the content: it is the reason the sheet exists, and
          the sheet's own header keeps the close affordance pinned above it. */}
      <SearchField
        value={query}
        onChangeText={setQuery}
        placeholder="Sessions, actions, transcript"
        accessibilityLabel="Search sessions, actions and this conversation"
      />

      {matchingActions.length > 0 ? (
        <View style={{ gap: 4 }}>
          <Eyebrow>Actions</Eyebrow>
          <View style={{ marginHorizontal: -16 }}>
            {matchingActions.map((action, index) => (
              <ActionRow
                key={action.key}
                label={action.label}
                hint={action.hint}
                icon={action.icon}
                index={index}
                onPress={() => {
                  void haptic('light')
                  action.run()
                }}
              />
            ))}
          </View>
        </View>
      ) : null}

      {transcriptHits.length > 0 ? (
        <View style={{ gap: 4 }}>
          <Eyebrow>In this conversation</Eyebrow>
          <View style={{ gap: 6 }}>
            {transcriptHits.map((hit, index) => (
              <TranscriptHit key={`${hit.id}-${index}`} hit={hit} index={index} />
            ))}
          </View>
        </View>
      ) : null}

      <View style={{ gap: 4 }}>
        <Eyebrow>{q ? `Sessions · ${matchingSessions.length}` : 'Recent sessions'}</Eyebrow>
        {matchingSessions.length === 0 ? (
          <EmptyState
            compact
            title={q ? 'Nothing matches' : 'No sessions yet'}
            body={q ? 'Try a shorter search.' : 'Start one to see it here.'}
          />
        ) : (
          <View style={{ marginHorizontal: -16 }}>
            {matchingSessions.map((session, index) => (
              <SessionHit
                key={session.id}
                session={session}
                index={index}
                providerName={providerName(session.agent)}
                current={session.id === sessionId}
                onPress={() => {
                  onClose()
                  if (session.id !== sessionId) navigation.push('Session', { sessionId: session.id })
                }}
              />
            ))}
          </View>
        )}
      </View>
    </Sheet>
  )
}

function ActionRow({
  label,
  hint,
  icon,
  index,
  onPress,
}: {
  label: string
  hint: string
  icon: React.ReactNode
  index: number
  onPress: () => void
}) {
  const enter = useEnter(staggerDelay(index), false)
  return (
    <View style={rowEnterStyle(enter)}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityHint={hint}
        onPress={onPress}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          minHeight: 48,
          paddingHorizontal: 16,
          paddingVertical: 7,
          borderRadius: radius.md,
          backgroundColor: pressed ? palette.raised : 'transparent',
        })}
      >
        {icon}
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text className="text-[14.5px] leading-[19px] font-medium text-ink" numberOfLines={1}>
            {label}
          </Text>
          <Text className="mt-0.5 text-[12px] leading-[16px] text-ink-3" numberOfLines={1}>
            {hint}
          </Text>
        </View>
      </Pressable>
    </View>
  )
}

function SessionHit({
  session,
  index,
  providerName,
  current,
  onPress,
}: {
  session: { id: string; name: string; agent: string; project: string | null; updated_at: string }
  index: number
  providerName: string
  current: boolean
  onPress: () => void
}) {
  const enter = useEnter(staggerDelay(index), false)
  return (
    <View style={rowEnterStyle(enter)}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={current ? `${session.name} (open)` : session.name}
        accessibilityHint={`${providerName}${session.project ? `, ${basename(session.project)}` : ''}, ${relativeTime(session.updated_at)}`}
        onPress={onPress}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: 11,
          minHeight: 48,
          paddingHorizontal: 16,
          paddingVertical: 6,
          borderRadius: radius.md,
          backgroundColor: pressed ? palette.raised : 'transparent',
        })}
      >
        <AgentAvatar agent={session.agent} size={30} name={providerName} />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text className="text-[14.5px] leading-[19px] text-ink" numberOfLines={1}>
            {session.name}
          </Text>
          <Mono className="mt-0.5 text-[11px] leading-[15px]" numberOfLines={1}>
            {providerName}
            {session.project ? ` · ${basename(session.project)}` : ''} · {relativeTime(session.updated_at)}
          </Mono>
        </View>
        {current ? <Badge tone="accent" mono>open</Badge> : null}
      </Pressable>
    </View>
  )
}

function TranscriptHit({ hit, index }: { hit: TranscriptHitValue; index: number }) {
  const enter = useEnter(staggerDelay(index), false)
  return (
    <View style={rowEnterStyle(enter)}>
      <View
        style={{
          paddingHorizontal: 13,
          paddingVertical: 10,
          gap: 5,
          borderRadius: radius.md,
          backgroundColor: palette.well,
          borderWidth: 1,
          borderColor: palette.line,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
          <GitBranch size={11} color={palette.ink4} />
          <Badge tone="muted" mono>
            {hit.role}
          </Badge>
        </View>
        <Text className="text-[13px] leading-[18px] text-ink-2" numberOfLines={2}>
          {hit.preview}
        </Text>
      </View>
    </View>
  )
}

interface TranscriptHitValue {
  id: string
  role: string
  preview: string
}

/** Search the text parts of a transcript, newest first. */
function searchTranscript(messages: Message[], needle: string): TranscriptHitValue[] {
  const out: TranscriptHitValue[] = []
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    for (const part of message.parts) {
      if (part.kind !== 'text') continue
      const at = part.text.toLowerCase().indexOf(needle)
      if (at === -1) continue
      const start = Math.max(0, at - 40)
      out.push({
        id: message.id,
        role: message.role,
        preview: `${start > 0 ? '…' : ''}${part.text.slice(start, start + 140).trim()}`,
      })
      break
    }
    if (out.length >= 8) break
  }
  return out
}

export { getConversation }
