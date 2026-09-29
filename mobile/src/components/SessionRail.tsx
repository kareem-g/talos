/**
 * Right rail — the session's tool panel, as a full-screen sheet.
 *
 * The desktop keeps a tab strip (Plan / Agents / Git / Goal / Files / Terminal /
 * Sub-sessions / …) beside the transcript; on a phone the desktop itself collapses
 * that into a right-anchored sheet, which is what this is.
 *
 * Tabs here are the ones the mobile data can actually fill: Plan, Agents, Goal,
 * Terminal and Sub-sessions. Sections
 * derive from the same conversation the transcript renders, and the derivations
 * are ports of the desktop's pure helpers (`latestPlanInfo`, `latestUserPrompt`,
 * `deriveSubagents`, `hasRecentError`) — they could not be imported directly
 * because the desktop module reaches into its own store and DOM API.
 */

import * as React from 'react'
import { Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native'
import { FileText, X } from 'lucide-react-native'

import {
  BrowserTab,
  FilesTab,
  GitTab,
  ProjectsTab,
  RoomsTab,
  SideTab,
  TerminalsTab,
  TrajectoriesTab,
} from './SessionRailTabs'
import { SubagentModal } from './SubagentModal'

import { basename, cn } from '@/lib/format'
import type { Conversation } from '@/types/conversation'
import type { Session } from '@/types/session'
import { socket } from '@app/lib/socket'
import { useStore } from '@app/store'
import { deriveSubagents, hasRecentError, latestPlanInfo, latestUserPrompt } from '@app/lib/sessionView'
import { Button, GlassSurface, Mono, StatusPill } from '@app/components/ui'
import { palette } from '@app/design/tokens'

export type RailTab =
  | 'plan'
  | 'agents'
  | 'git-diff'
  | 'git-files'
  | 'goal'
  | 'browser'
  | 'files'
  | 'projects'
  | 'subsessions'
  | 'rooms'
  | 'side'
  | 'terminal'
  | 'terminals'
  | 'trajectories'

const TABS: Array<{ id: RailTab; label: string }> = [
  { id: 'plan', label: 'Plan' },
  { id: 'agents', label: 'Agents' },
  { id: 'git-diff', label: 'Git diff' },
  { id: 'git-files', label: 'Git files' },
  { id: 'goal', label: 'Goal' },
  { id: 'browser', label: 'Browser' },
  { id: 'files', label: 'Files' },
  { id: 'side', label: 'Side' },
  { id: 'projects', label: 'Projects' },
  { id: 'subsessions', label: 'Sub-sessions' },
  { id: 'rooms', label: 'Rooms' },
  { id: 'terminal', label: 'Terminal' },
  { id: 'terminals', label: 'Terminals' },
  { id: 'trajectories', label: 'Trajectories' },
]

/* ── Sheet ───────────────────────────────────────────────────────────────── */

export function SessionRail({
  open,
  onClose,
  session,
  conversation,
}: {
  open: boolean
  onClose: () => void
  session: Session
  conversation: Conversation
}) {
  const [tab, setTab] = React.useState<RailTab>('plan')
  const [subagentOpen, setSubagentOpen] = React.useState(false)

  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <View className="flex-1 bg-canvas">
        <GlassSurface radius={0} className="border-b border-line">
        <View className="flex-row items-center gap-2 px-2 pt-12 pb-1.5">
          <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-0.5">
            {TABS.map((entry) => {
              const active = entry.id === tab
              return (
                <Pressable
                  key={entry.id}
                  onPress={() => setTab(entry.id)}
                  className={cn(
                    'min-h-8 flex-row items-center rounded-lg px-2.5',
                    active ? 'bg-hover' : 'active:bg-hover-2',
                  )}
                >
                  <Text className={cn('text-[11.5px]', active ? 'text-ink' : 'text-ink-3')}>{entry.label}</Text>
                </Pressable>
              )
            })}
          </ScrollView>
          <Pressable onPress={onClose} accessibilityLabel="Close" className="size-9 items-center justify-center rounded-full">
            <X size={16} color={palette.ink2} />
          </Pressable>
        </View>
        </GlassSurface>

        <ScrollView contentContainerClassName="p-4 pb-10">
          {tab === 'plan' ? <PlanTab conversation={conversation} /> : null}
          {tab === 'agents' ? (
            <AgentsTab
              session={session}
              conversation={conversation}
              onOpenSubagentModal={() => setSubagentOpen(true)}
            />
          ) : null}
          {tab === 'goal' ? <GoalTab session={session} conversation={conversation} /> : null}
          {tab === 'git-diff' || tab === 'git-files' ? <GitTab session={session} /> : null}
          {tab === 'browser' ? <BrowserTab session={session} /> : null}
          {tab === 'files' ? <FilesTab session={session} /> : null}
          {tab === 'side' ? <SideTab session={session} /> : null}
          {tab === 'projects' ? <ProjectsTab /> : null}
          {tab === 'rooms' ? <RoomsTab /> : null}
          {tab === 'terminal' ? <TerminalTab session={session} conversation={conversation} /> : null}
          {tab === 'terminals' ? <TerminalsTab session={session} /> : null}
          {tab === 'trajectories' ? <TrajectoriesTab session={session} /> : null}
          {tab === 'subsessions' ? <SubSessionsTab session={session} /> : null}
        </ScrollView>

        <SubagentModal
          open={subagentOpen}
          onClose={() => setSubagentOpen(false)}
          sessionId={session.id}
        />
      </View>
    </Modal>
  )
}

function ViewHeader({ eyebrow, right }: { eyebrow: string; right?: React.ReactNode }) {
  return (
    <View className="mb-3 flex-row items-center justify-between gap-2 border-b border-line pb-2">
      <Mono className="text-[10px] uppercase tracking-[0.14em] text-ink-3">{eyebrow}</Mono>
      {typeof right === 'string' ? <Mono className="text-[10px] text-ink-3">{right}</Mono> : right}
    </View>
  )
}

function PlanTab({ conversation }: { conversation: Conversation }) {
  const info = latestPlanInfo(conversation.messages)
  if (!info || (!info.text && info.stepCount === 0)) {
    return (
      <View className="items-center py-14">
        <Text className="text-[13px] font-medium text-ink">No plan yet</Text>
        <Text className="mt-1 text-center text-[12px] text-ink-3">
          When the agent proposes a plan, it appears here.
        </Text>
      </View>
    )
  }
  return (
    <View>
      <ViewHeader eyebrow={`Plan · ${info.stepCount} steps`} />
      {info.title ? <Text className="text-[12.5px] font-semibold text-ink">{info.title}</Text> : null}
      {info.text ? (
        <View className="mt-2 gap-1">
          {info.text.split('\n').map((line, index) => {
            const heading = /^#{1,4}\s+/.test(line)
            const bullet = /^\s*[-*]\s+/.test(line)
            const text = line.replace(/^#{1,4}\s+/, '').replace(/^\s*[-*]\s+/, '')
            if (!text.trim()) return null
            return (
              <Text
                key={index}
                className={cn(
                  'leading-5',
                  heading ? 'text-[13.5px] font-semibold text-ink' : 'text-[12.5px] text-ink-2',
                  bullet && 'ml-3',
                )}
              >
                {bullet ? '• ' : ''}
                {text}
              </Text>
            )
          })}
        </View>
      ) : null}
      {info.relatedFiles.length > 0 ? (
        <View className="mt-3 border-t border-line pt-2.5">
          <Mono className="mb-1 text-[10px] uppercase tracking-wider">Related files</Mono>
          {info.relatedFiles.map((path) => (
            <Mono key={path} className="text-[11px] text-ink-2">
              {path}
            </Mono>
          ))}
        </View>
      ) : null}
    </View>
  )
}

function AgentsTab({
  session,
  conversation,
  onOpenSubagentModal,
}: {
  session: Session
  conversation: Conversation
  onOpenSubagentModal?: () => void
}) {
  const subagents = deriveSubagents(conversation.messages)
  return (
    <View>
      <ViewHeader
        eyebrow="Agents"
        right={
          onOpenSubagentModal ? (
            <Button
              variant="surface"
              label="+ Subagent"
              className="min-h-7 px-2"
              onPress={onOpenSubagentModal}
            />
          ) : (
            `${subagents.length} subagents`
          )
        }
      />
      <View className="flex-row items-center gap-2 py-1.5">
        <View className="size-1.5 rounded-full bg-green" />
        <Text className="text-[11.5px] text-ink font-semibold">{session.agent}</Text>
        <Mono className="text-[9px] uppercase text-accent font-semibold">primary</Mono>
      </View>
      {subagents.length === 0 ? (
        <View className="mt-2 rounded-lg border border-line bg-field p-3 gap-2">
          <Text className="text-[11.5px] text-ink-3">No subagents running in this session.</Text>
          {onOpenSubagentModal ? (
            <Button
              variant="primary"
              label="Spawn Subagent or Fan-Out"
              className="min-h-9"
              onPress={onOpenSubagentModal}
            />
          ) : null}
        </View>
      ) : (
        <View className="mt-1 gap-1">
          {subagents.map((agent) => (
            <View key={agent.id} className="flex-row items-center gap-2 rounded-control px-1.5 py-1.5 bg-surface border border-line">
              <View
                className={cn(
                  'size-1.5 rounded-full',
                  agent.status === 'working' ? 'bg-accent' : agent.status === 'failed' ? 'bg-red' : 'bg-green',
                )}
              />
              <Text className="min-w-0 flex-1 text-[11.5px] text-ink" numberOfLines={1}>
                {agent.name}
              </Text>
              <Mono className="text-[9px] uppercase">{agent.kind}</Mono>
            </View>
          ))}
        </View>
      )}
    </View>
  )
}

function GoalTab({ session, conversation }: { session: Session; conversation: Conversation }) {
  const objective = latestUserPrompt(conversation.messages)
  const info = latestPlanInfo(conversation.messages)
  const steps: Array<{ content: string; status?: string }> = info?.entries?.length
    ? info.entries
    : (info?.steps ?? []).map((content) => ({ content }))
  const done = steps.filter((step) => step.status === 'completed').length
  const blocked = session.status === 'waiting_for_approval' || session.status === 'waiting_for_input'
  const failed = hasRecentError(conversation.messages)
  const status = failed ? 'failed' : blocked ? 'blocked' : 'active'
  const pct = steps.length ? Math.round((done / steps.length) * 100) : 0

  return (
    <View>
      <ViewHeader eyebrow="Goal" right={steps.length ? `${done}/${steps.length} steps` : undefined} />
      <View className="flex-row items-center gap-2">
        <Text className="min-w-0 flex-1 text-[12.5px] font-semibold text-ink" numberOfLines={2}>
          {info?.title ?? session.name}
        </Text>
        <StatusPill
          tone={status === 'failed' ? 'red' : status === 'blocked' ? 'orange' : 'green'}
          label={status}
        />
      </View>

      {objective ? (
        <View className="mt-2.5 rounded-lg border border-line bg-inset px-2.5 py-2">
          <Mono className="mb-1 text-[9.5px] uppercase tracking-wider">Objective</Mono>
          <Text className="text-[12px] leading-5 text-ink-2" numberOfLines={6}>
            {objective}
          </Text>
        </View>
      ) : null}

      {steps.length > 0 ? (
        <View className="mt-3">
          <View className="h-1 overflow-hidden rounded-full bg-field">
            <View className="h-full rounded-full bg-accent" style={{ width: `${Math.max(2, pct)}%` }} />
          </View>
          <View className="mt-2 gap-1">
            {steps.slice(0, 20).map((step, index) => (
              <View key={index} className="flex-row items-start gap-2">
                <Text
                  className={cn(
                    'mt-0.5 text-[11px]',
                    step.status === 'completed'
                      ? 'text-green'
                      : step.status === 'in_progress'
                        ? 'text-accent'
                        : 'text-ink-3',
                  )}
                >
                  {step.status === 'completed' ? '✓' : step.status === 'in_progress' ? '›' : '○'}
                </Text>
                <Text
                  className={cn(
                    'min-w-0 flex-1 text-[12px] leading-4',
                    step.status === 'completed' ? 'text-ink-3 line-through' : 'text-ink-2',
                  )}
                >
                  {step.content}
                </Text>
              </View>
            ))}
          </View>
        </View>
      ) : null}

      {info?.relatedFiles.length ? (
        <View className="mt-3 flex-row flex-wrap gap-1">
          {info.relatedFiles.map((path) => (
            <View key={path} className="flex-row items-center gap-1 rounded-md bg-inset px-1.5 py-0.5">
              <FileText size={10} color={palette.ink3} />
              <Mono className="text-[9.5px] text-ink-2">{basename(path)}</Mono>
            </View>
          ))}
        </View>
      ) : null}
    </View>
  )
}

function TerminalTab({ session, conversation }: { session: Session; conversation: Conversation }) {
  const config = useStore((state) => state.configs[session.id])
  const interactive = config?.interactiveTerminal === true
  const [input, setInput] = React.useState('')

  return (
    <View>
      <ViewHeader eyebrow="Terminal" right={interactive ? 'interactive' : 'read-only'} />
      {interactive ? (
        <View className="mb-2 flex-row items-center gap-2">
          <TextInput
            value={input}
            onChangeText={setInput}
            placeholder="Type a command…"
            placeholderTextColor={palette.ink3}
            autoCapitalize="none"
            autoCorrect={false}
            className="min-h-10 flex-1 rounded-lg border border-line bg-field px-2.5 font-mono text-[12px] text-ink"
          />
          <Button
            variant="surface"
            label="Send"
            disabled={input.length === 0}
            onPress={() => {
              socket.sendTerminalInput(session.id, `${input}\n`)
              setInput('')
            }}
          />
        </View>
      ) : (
        <Text className="mb-2 text-[11px] leading-4 text-ink-3">
          This agent runs without a terminal, so output is recorded but keystrokes are not accepted.
        </Text>
      )}
      <Mono className="rounded-lg bg-term-bg px-2.5 py-2 text-[11px] leading-4 text-term-fg">
        {conversation.terminal.trim() ? conversation.terminal : 'No terminal output yet.'}
      </Mono>
    </View>
  )
}

function SubSessionsTab({ session }: { session: Session }) {
  const sessions = useStore((state) => state.sessions)
  const here = sessions.filter(
    (row) => row.id !== session.id && row.project && row.project === session.project,
  )
  return (
    <View>
      <ViewHeader eyebrow={`Sub-sessions · ${basename(session.project ?? 'workspace')}`} right={`${here.length} in workspace`} />
      {here.length === 0 ? (
        <Text className="text-[11.5px] text-ink-3">No other sessions in this workspace.</Text>
      ) : (
        <View className="gap-0.5">
          {here.map((row) => (
            <View key={row.id} className="flex-row items-center gap-2 rounded-control px-2 py-1.5">
              <View
                className={cn(
                  'size-1.5 rounded-full',
                  row.status === 'running' || row.status === 'starting' ? 'bg-accent' : 'bg-ink-3',
                )}
              />
              <Text className="min-w-0 flex-1 text-[11.5px] text-ink" numberOfLines={1}>
                {row.name}
              </Text>
              <Mono className="text-[9px] uppercase">{row.agent}</Mono>
            </View>
          ))}
        </View>
      )}
    </View>
  )
}
