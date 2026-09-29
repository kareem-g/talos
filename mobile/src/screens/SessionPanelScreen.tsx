/**
 * Session panel — the desktop's right rail, as a full screen.
 *
 * WHY NOT A SHEET
 * ---------------
 * The rail holds a plan, a Git diff, a file tree, a browser mirror and a
 * terminal. A bottom sheet caps at 88% of the screen and has to share that with
 * a header and a grabber; at phone width, a diff with line-number gutters in a
 * 55%-height sheet has ~180pt of usable height and is unreadable. Every one of
 * those views is *content*, and content deserves the whole screen.
 *
 * So this is a pushed screen with its own app bar, its own horizontal tab
 * strip, and its own scrolling body — the same structure as the rail, with the
 * width the rail had.
 *
 * THE TABS
 * --------
 * The rail's tab set is a registry on the desktop, with the four that matter
 * open by default and a picker for the rest. That maps to a phone exactly: a
 * scrolling strip of the four default tabs, and a `+` that opens a picker of
 * the rest. Opening a fifth tab is one tap and the strip scrolls to it; there
 * is no drawer, no overflow menu nested three deep, and no way to lose a tab
 * you opened.
 *
 * WHICH FOUR
 * ----------
 * Plan, Agents, Goal and Git are the rail's own default set and they are the
 * right default for a phone too: they are the answers to "what is it about to
 * do", "what is it running", "why is it running" and "what has it changed".
 * Everything else is a thing you go and look at deliberately.
 */

import * as React from 'react'
import { Pressable, ScrollView, Text, TextInput, View } from 'react-native'
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import { ChevronRight, Plus, X } from 'lucide-react-native'

import type { Conversation } from '@/types/conversation'
import type { Session } from '@/types/session'
import { deriveSubagents, hasRecentError, latestPlanInfo, latestUserPrompt } from '@app/lib/sessionView'
import { useConversation, useStore } from '@app/store'
import type { RootStackParamList } from '@app/navigation'
import { palette, radius, toneColor, type Tone } from '@app/design/tokens'
import { useCollapse } from '@app/components/motion'
import { PickerSheet } from '@app/components/Sheet'
import { AppBar, BackButton } from '@app/components/Screen'
import {
  Badge,
  Button,
  Dot,
  EmptyState,
  Eyebrow,
  Mono,
  ProgressBar,
  StatusPill,
  Well,
  haptic,
  toast,
} from '@app/components/ui'
import { SubagentSheet } from '@app/components/SubagentModal'
import { BrowserTab, FilesTab, GitTab, ProjectsTab, RoomsTab, SideTab, TerminalsTab, TrajectoriesTab } from '@app/components/panel/Tabs'
import { socket } from '@app/lib/socket'

export type PanelTabId =
  | 'plan'
  | 'agents'
  | 'goal'
  | 'git'
  | 'files'
  | 'browser'
  | 'terminal'
  | 'terminals'
  | 'projects'
  | 'rooms'
  | 'side'
  | 'trace'

interface TabSpec {
  id: PanelTabId
  label: string
  hint: string
  group: 'Session' | 'Workspace' | 'Station'
}

/** The full registry — the desktop's `rightTabs.ts`, in one place. */
const TABS: TabSpec[] = [
  { id: 'plan', label: 'Plan', hint: 'The todos the agent is working through, live.', group: 'Session' },
  { id: 'agents', label: 'Agents', hint: 'The primary agent and the subagents it spawned.', group: 'Session' },
  { id: 'goal', label: 'Goal', hint: 'The objective, and how far the plan has got.', group: 'Session' },
  { id: 'git', label: 'Git', hint: 'Working-tree changes, inline diffs and commit.', group: 'Workspace' },
  { id: 'files', label: 'Files', hint: 'The workspace file tree, with a reader.', group: 'Workspace' },
  { id: 'browser', label: 'Browser', hint: 'The live page, driven by hand.', group: 'Workspace' },
  { id: 'terminal', label: 'Terminal', hint: 'This session’s own terminal output.', group: 'Workspace' },
  { id: 'side', label: 'Scratchpad', hint: 'Private notes and a checklist, on this device.', group: 'Workspace' },
  { id: 'projects', label: 'Projects', hint: 'Every workspace and the sessions in it.', group: 'Station' },
  { id: 'rooms', label: 'Rooms', hint: 'Rosters of workers you can fan a task out to.', group: 'Station' },
  { id: 'terminals', label: 'Terminals', hint: 'Standalone shells on the desktop.', group: 'Station' },
  { id: 'trace', label: 'Trace', hint: 'Recorded timeline events for this run.', group: 'Station' },
]

const DEFAULT_OPEN: PanelTabId[] = ['plan', 'agents', 'goal', 'git']

export function SessionPanelScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const route = useRoute<RouteProp<RootStackParamList, 'SessionPanel'>>()
  const { sessionId, tab } = route.params

  const sessions = useStore((state) => state.sessions)
  const configs = useStore((state) => state.configs)
  const revision = useStore((state) => state.revisions[sessionId] ?? 0)
  const session = sessions.find((row) => row.id === sessionId)
  const conversation = useConversationFor(sessionId, revision)

  const [open, setOpen] = React.useState<PanelTabId[]>([tab ?? DEFAULT_OPEN[0], ...DEFAULT_OPEN.filter((id) => id !== tab)])
  const [active, setActive] = React.useState<PanelTabId>(tab ?? 'plan')
  const [pickerOpen, setPickerOpen] = React.useState(false)
  const [subagentOpen, setSubagentOpen] = React.useState(false)

  const railSession: Session = session ?? { ...PLACEHOLDER, id: sessionId }

  function openTab(next: PanelTabId) {
    void haptic('select')
    setOpen((current) => (current.includes(next) ? current : [...current, next]))
    setActive(next)
  }

  function closeTab(id: PanelTabId) {
    setOpen((current) => {
      const next = current.filter((entry) => entry !== id)
      if (active === id) setActive(next[next.length - 1] ?? 'plan')
      return next
    })
  }

  return (
    <View className="flex-1 bg-canvas">
      <AppBar
        title={session?.name ?? 'Session'}
        subtitle={railSession.project ?? 'Inbox'}
        left={<BackButton onPress={() => navigation.goBack()} label="Back to the session" />}
        right={
          <View style={{ paddingRight: 6 }}>
            <Text className="text-[11px] text-ink-3" style={{ letterSpacing: 0.4 }}>
              TOOLS
            </Text>
          </View>
        }
      />

      {/* ── Tab strip ─────────────────────────────────────────────────────
          A horizontally scrolling strip with the active tab underlined, and a
          `+` at the end that opens the picker. Scrolling rather than wrapping:
          a wrapped strip becomes two rows of buttons and pushes the content
          down, which is the opposite of what a tool panel is for. */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          borderBottomWidth: 1,
          borderBottomColor: palette.line,
          backgroundColor: palette.chrome,
        }}
      >
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ flexDirection: 'row', alignItems: 'center', paddingHorizontal: 8 }}
        >
          {open.map((id) => {
            const spec = TABS.find((entry) => entry.id === id)!
            const isActive = id === active
            return (
              <Pressable
                key={id}
                accessibilityRole="tab"
                accessibilityLabel={spec.label}
                accessibilityHint={spec.hint}
                accessibilityState={{ selected: isActive }}
                onPress={() => {
                  void haptic('select')
                  setActive(id)
                }}
                onLongPress={() => closeTab(id)}
                style={{
                  minHeight: 42,
                  justifyContent: 'center',
                  paddingHorizontal: 11,
                }}
              >
                <View style={{ alignItems: 'center', gap: 5 }}>
                  <Text
                    style={{
                      fontSize: 13,
                      fontWeight: isActive ? '700' : '500',
                      color: isActive ? palette.ink : palette.ink3,
                    }}
                  >
                    {spec.label}
                  </Text>
                  <View
                    style={{
                      width: isActive ? 22 : 0,
                      height: 2,
                      borderRadius: 1,
                      backgroundColor: palette.accent,
                    }}
                  />
                </View>
              </Pressable>
            )
          })}
        </ScrollView>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open another tool"
          accessibilityHint="Shows the tabs that are not open"
          onPress={() => {
            void haptic('light')
            setPickerOpen(true)
          }}
          hitSlop={8}
          style={({ pressed }) => ({
            width: 42,
            height: 42,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: pressed ? palette.raised : 'transparent',
          })}
        >
          <Plus size={17} color={palette.ink2} />
        </Pressable>
      </View>

      <ScrollView
        contentContainerStyle={{ padding: 16, paddingBottom: 40, gap: 16 }}
        keyboardShouldPersistTaps="handled"
        showsVerticalScrollIndicator={false}
      >
        {active === 'plan' ? <PlanTab conversation={conversation} /> : null}
        {active === 'agents' ? (
          <AgentsTab
            session={railSession}
            conversation={conversation}
            onSpawn={() => setSubagentOpen(true)}
          />
        ) : null}
        {active === 'goal' ? <GoalTab session={railSession} conversation={conversation} /> : null}
        {active === 'git' ? <GitTab session={railSession} /> : null}
        {active === 'files' ? <FilesTab session={railSession} /> : null}
        {active === 'browser' ? <BrowserTab session={railSession} /> : null}
        {active === 'terminal' ? (
          <TerminalTab session={railSession} conversation={conversation} interactive={configs[sessionId]?.interactiveTerminal === true} />
        ) : null}
        {active === 'side' ? <SideTab session={railSession} /> : null}
        {active === 'projects' ? <ProjectsTab /> : null}
        {active === 'rooms' ? <RoomsTab /> : null}
        {active === 'terminals' ? <TerminalsTab session={railSession} /> : null}
        {active === 'trace' ? <TrajectoriesTab session={railSession} /> : null}
      </ScrollView>

      <PickerSheet
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        title="Session tools"
        subtitle={`${open.length} open`}
        searchable
        value={undefined}
        onSelect={(value) => openTab(value as PanelTabId)}
        options={TABS.filter((spec) => !open.includes(spec.id)).map((spec) => ({
          value: spec.id,
          label: spec.label,
          hint: spec.hint,
          badge: spec.group.toUpperCase(),
        }))}
        emptyLabel="Every tool is already open."
      />

      <SubagentSheet
        open={subagentOpen}
        sessionId={sessionId}
        onClose={() => setSubagentOpen(false)}
        onOpenSession={(childId) => {
          setSubagentOpen(false)
          navigation.navigate('Session', { sessionId: childId })
        }}
      />
    </View>
  )
}

const PLACEHOLDER: Session = {
  id: '',
  name: 'Session',
  agent: '',
  project: null,
  branch: null,
  status: 'idle',
  worktree_path: null,
  created_at: '',
  updated_at: '',
  cost: null,
  tokens_used: null,
  resume_command: null,
  parent_id: null,
}

/**
 * The conversation for a session, re-derived whenever it streams.
 *
 * The store keeps conversations in a `Map` *outside* zustand and signals
 * change with a per-session revision counter, so the hook has to read the
 * revision and then the map — which is exactly what `useConversation` does in
 * the store. Re-implementing it here would risk drifting from that contract,
 * so the hook is imported rather than copied.
 */
function useConversationFor(sessionId: string, _revision: number): Conversation {
  return useConversation(sessionId)
}

/* ── Panel chrome ───────────────────────────────────────────────────────────────
 * Every panel opens the same way: a mono eyebrow and a count. It is the single
 * most recognisable piece of the desktop's visual language, and reproducing it
 * on a phone is what makes a rail tab feel like the same object as a rail tab
 * on the desktop rather than a different screen. */

export function PanelHeader({
  eyebrow,
  right,
}: {
  eyebrow: string
  right?: React.ReactNode
}) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 8,
        marginBottom: 12,
        paddingBottom: 9,
        borderBottomWidth: 1,
        borderBottomColor: palette.line,
      }}
    >
      <Eyebrow>{eyebrow}</Eyebrow>
      {right}
    </View>
  )
}

/* ── Plan ──────────────────────────────────────────────────────────────────────
 * The plan is a *checklist*, so it is a checklist: one row per step, a mark
 * that is a glyph and not a colour, and the whole thing collapsible. On the
 * desktop the chevron rotates and the body clips; the same, measured, so a
 * nine-step plan and a one-step plan both animate at a believable speed. */

function PlanTab({ conversation }: { conversation: Conversation }) {
  const info = latestPlanInfo(conversation.messages)
  const [open, setOpen] = React.useState(true)
  const collapse = useCollapse(open)

  if (!info || (!info.text && info.stepCount === 0)) {
    return (
      <View>
        <PanelHeader eyebrow="Plan" />
        <EmptyState
          title="No plan yet"
          body="When the agent proposes one, its steps appear here and tick off as it works."
        />
      </View>
    )
  }

  const steps = info.entries?.length
    ? info.entries
    : info.steps.map((content) => ({ content, status: 'pending' }))
  const done = steps.filter((step) => step.status === 'completed').length

  return (
    <View>
      <PanelHeader
        eyebrow={`Plan · ${info.stepCount} ${info.stepCount === 1 ? 'step' : 'steps'}`}
        right={
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={open ? 'Collapse the plan' : 'Expand the plan'}
            accessibilityState={{ expanded: open }}
            onPress={() => {
              void haptic('light')
              setOpen((value) => !value)
            }}
            hitSlop={10}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}
          >
            <Text style={{ color: palette.ink3, fontSize: 11.5 }}>{open ? 'Collapse' : 'Expand'}</Text>
            <ChevronRight
              size={13}
              color={palette.ink3}
              style={{ transform: [{ rotate: open ? '-90deg' : '0deg' }] }}
            />
          </Pressable>
        }
      />

      {info.title ? (
        <Text
          className="mb-3 text-[17px] font-semibold text-ink"
          style={{ letterSpacing: -0.25, lineHeight: 23 }}
        >
          {info.title}
        </Text>
      ) : null}

      <View style={{ gap: 2, marginBottom: 12 }}>
        <ProgressBar value={steps.length ? done / steps.length : 0} tone={done === steps.length && steps.length > 0 ? 'ok' : 'accent'} />
        <Text className="text-[11.5px] text-ink-3">
          {done} of {steps.length} complete
        </Text>
      </View>

      <View {...(collapse.measured ? { onLayout: collapse.onLayout } : {})} style={collapse.style}>
        <View style={{ gap: 2 }}>
          {steps.map((step, index) => (
            <StepRow key={index} index={index} content={step.content} status={step.status ?? 'pending'} />
          ))}
        </View>

        {info.text ? (
          <View
            style={{
              marginTop: 14,
              borderRadius: radius.md,
              borderWidth: 1,
              borderColor: palette.line,
              backgroundColor: palette.well,
              padding: 13,
              gap: 6,
            }}
          >
            {info.text
              .split('\n')
              .filter((line) => line.trim().length > 0)
              .map((line, index) => {
                const heading = /^#{1,4}\s+/.test(line)
                const bullet = /^\s*[-*]\s+/.test(line)
                const text = line.replace(/^#{1,4}\s+/, '').replace(/^\s*[-*]\s+/, '')
                return (
                  <Text
                    key={index}
                    style={{
                      fontSize: heading ? 14 : 13.5,
                      lineHeight: 20,
                      fontWeight: heading ? '600' : '400',
                      color: heading ? palette.ink : palette.ink2,
                      marginLeft: bullet ? 10 : 0,
                    }}
                  >
                    {bullet ? '• ' : ''}
                    {text}
                  </Text>
                )
              })}
          </View>
        ) : null}

        {info.relatedFiles.length > 0 ? (
          <View style={{ marginTop: 14, gap: 6 }}>
            <Eyebrow>Related files</Eyebrow>
            {info.relatedFiles.map((path) => (
              <Mono key={path} className="text-[12px] leading-[18px] text-ink-2">
                {path}
              </Mono>
            ))}
          </View>
        ) : null}
      </View>
    </View>
  )
}

const STEP_COLOR: Record<string, string> = {
  completed: palette.ok,
  in_progress: palette.accent,
  failed: palette.danger,
  blocked: palette.wait,
  pending: palette.ink4,
}

const STEP_MARK: Record<string, string> = {
  completed: '✓',
  in_progress: '▸',
  failed: '!',
  blocked: '!',
  pending: '○',
}

function StepRow({ index, content, status }: { index: number; content: string; status: string }) {
  const done = status === 'completed'
  const active = status === 'in_progress'
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'flex-start',
        gap: 10,
        borderRadius: radius.sm,
        paddingHorizontal: 9,
        paddingVertical: 8,
        backgroundColor: active ? palette.raised : 'transparent',
      }}
    >
      <Text style={{ width: 16, marginTop: 1, fontSize: 12, lineHeight: 18, fontWeight: '700', color: STEP_COLOR[status] ?? palette.ink4 }}>
        {STEP_MARK[status] ?? '○'}
      </Text>
      <Text
        style={{
          flex: 1,
          fontSize: 14,
          lineHeight: 20,
          color: done ? palette.ink3 : active ? palette.ink : palette.ink2,
          textDecorationLine: done ? 'line-through' : 'none',
          fontWeight: active ? '600' : '400',
        }}
      >
        {content}
      </Text>
      <Text style={{ color: palette.ink4, fontSize: 10.5, fontVariant: ['tabular-nums'] }}>{index + 1}</Text>
    </View>
  )
}

/* ── Agents ───────────────────────────────────────────────────────────────────
 * The primary agent and the subagents it spawned, plus the control that spawns
 * more. A subagent row carries a status *dot* and a status *word*, because the
 * interesting case is "one of these failed" and a dot alone makes you tap to
 * find out which. */

function AgentsTab({
  session,
  conversation,
  onSpawn,
}: {
  session: Session
  conversation: Conversation
  onSpawn: () => void
}) {
  const subagents = deriveSubagents(conversation.messages)
  const running = subagents.filter((agent) => agent.status === 'working').length

  return (
    <View>
      <PanelHeader
        eyebrow="Agents"
        right={
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Text style={{ color: palette.ink3, fontSize: 11 }}>
              {subagents.length === 0 ? 'none' : `${running}/${subagents.length} running`}
            </Text>
            <Button size="sm" variant="secondary" label="Spawn" onPress={onSpawn} />
          </View>
        }
      />

      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 11,
          borderRadius: radius.md,
          borderWidth: 1,
          borderColor: palette.line,
          backgroundColor: palette.well,
          paddingHorizontal: 13,
          paddingVertical: 12,
        }}
      >
        <Dot tone="ok" />
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text className="text-[15px] font-semibold text-ink" numberOfLines={1}>
            {session.agent || 'agent'}
          </Text>
          <Text className="mt-0.5 text-[12px] text-ink-3">Primary</Text>
        </View>
      </View>

      {subagents.length === 0 ? (
        <View style={{ marginTop: 14 }}>
          <EmptyState
            title="No subagents"
            body="A subagent is a focused child task — a review, a plan, a parallel implementation — that runs under this session."
            action={<Button size="sm" variant="secondary" label="Spawn one" onPress={onSpawn} />}
          />
        </View>
      ) : (
        <View style={{ marginTop: 12, gap: 6 }}>
          {subagents.map((agent) => (
            <View
              key={agent.id}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 11,
                borderRadius: radius.md,
                borderWidth: 1,
                borderColor: palette.line,
                backgroundColor: palette.well,
                paddingHorizontal: 13,
                paddingVertical: 11,
              }}
            >
              <Dot
                tone={agent.status === 'working' ? 'accent' : agent.status === 'failed' ? 'danger' : 'ok'}
                pulse={agent.status === 'working'}
              />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text className="text-[14px] text-ink-2" numberOfLines={1}>
                  {agent.name}
                </Text>
                <Text className="mt-0.5 text-[11px]" style={{ color: subagentTone(agent.status) }}>
                  {subagentLabel(agent.status)}
                </Text>
              </View>
              <Mono className="shrink-0 text-[10px] uppercase text-ink-3">{agent.kind}</Mono>
            </View>
          ))}
        </View>
      )}
    </View>
  )
}

function subagentTone(status: string): string {
  return status === 'working' ? palette.accent : status === 'failed' ? palette.danger : palette.ok
}
function subagentLabel(status: string): string {
  return status === 'working' ? 'Running' : status === 'failed' ? 'Failed' : 'Done'
}

/* ── Goal ─────────────────────────────────────────────────────────────────────
 * The objective, the progress bar, and the step list. This is the desktop's
 * `GoalView` with the progress bar made legible on a phone: a bar you can
 * actually see, and a percentage next to it, because a 3pt bar on a 360pt
 * screen is not a number you can read. */

function GoalTab({ session, conversation }: { session: Session; conversation: Conversation }) {
  const objective = latestUserPrompt(conversation.messages)
  const info = latestPlanInfo(conversation.messages)
  const steps: Array<{ content: string; status?: string }> = info?.entries?.length
    ? info.entries
    : (info?.steps ?? []).map((content) => ({ content }))
  const done = steps.filter((step) => step.status === 'completed').length
  const blocked = session.status === 'waiting_for_approval' || session.status === 'waiting_for_input'
  const failed = hasRecentError(conversation.messages)
  const pct = steps.length ? Math.round((done / steps.length) * 100) : 0
  const tone: Tone = failed ? 'danger' : blocked ? 'wait' : steps.length === 0 ? 'muted' : 'ok'
  const label = failed ? 'Failed' : blocked ? 'Blocked on you' : steps.length === 0 ? 'No plan' : 'On track'

  return (
    <View>
      <PanelHeader eyebrow="Goal" right={<StatusPill tone={tone} label={label} size="sm" />} />

      <Text
        className="text-[19px] font-semibold text-ink"
        style={{ letterSpacing: -0.35, lineHeight: 26 }}
      >
        {info?.title ?? session.name ?? 'Session'}
      </Text>

      {objective ? (
        <View
          style={{
            marginTop: 12,
            borderRadius: radius.md,
            borderWidth: 1,
            borderColor: palette.line,
            backgroundColor: palette.well,
            padding: 13,
            gap: 6,
          }}
        >
          <Eyebrow>Objective</Eyebrow>
          <Text className="text-[14px] leading-[20px] text-ink-2">{objective}</Text>
        </View>
      ) : (
        <Text className="mt-3 text-[13.5px] leading-[19px] text-ink-3">
          No objective yet — this is the first thing you asked the agent.
        </Text>
      )}

      {steps.length > 0 ? (
        <View style={{ marginTop: 18, gap: 10 }}>
          <View style={{ flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' }}>
            <Text className="text-[13px] text-ink-2">Progress</Text>
            <Text style={{ color: palette.ink2, fontSize: 13, fontWeight: '700', fontVariant: ['tabular-nums'] }}>
              {done}/{steps.length} · {pct}%
            </Text>
          </View>
          <ProgressBar value={pct / 100} tone={tone} />
          <View style={{ gap: 2, marginTop: 4 }}>
            {steps.slice(0, 20).map((step, index) => (
              <StepRow key={index} index={index} content={step.content} status={step.status ?? 'pending'} />
            ))}
          </View>
        </View>
      ) : null}
    </View>
  )
}

/* ── Terminal ────────────────────────────────────────────────────────────────
 * The session's own output. Read-only unless the agent exposes an interactive
 * shell, and the distinction is stated rather than left to be discovered by
 * typing into a field that goes nowhere. */

function TerminalTab({
  session,
  conversation,
  interactive,
}: {
  session: Session
  conversation: Conversation
  interactive: boolean
}) {
  const [input, setInput] = React.useState('')
  const scrollRef = React.useRef<ScrollView>(null)

  React.useEffect(() => {
    const timer = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: false }), 60)
    return () => clearTimeout(timer)
  }, [conversation.terminal])

  return (
    <View style={{ gap: 12 }}>
      <PanelHeader
        eyebrow="Terminal"
        right={<Badge tone={interactive ? 'ok' : 'muted'} outline>{interactive ? 'interactive' : 'read-only'}</Badge>}
      />

      {interactive ? (
        <View style={{ flexDirection: 'row', gap: 8 }}>
          <TextInputShell
            value={input}
            onChangeText={setInput}
            placeholder="Type a command…"
            onSubmit={() => {
              if (!input.trim()) return
              socket.sendTerminalInput(session.id, `${input}\n`)
              setInput('')
            }}
          />
          <Button
            size="sm"
            variant="secondary"
            label="Send"
            disabled={input.trim().length === 0}
            onPress={() => {
              if (!input.trim()) return
              socket.sendTerminalInput(session.id, `${input}\n`)
              setInput('')
            }}
          />
        </View>
      ) : (
        <View
          style={{
            borderRadius: radius.sm,
            borderWidth: 1,
            borderColor: palette.line,
            backgroundColor: palette.waitSoft,
            padding: 11,
          }}
        >
          <Text className="text-[12.5px] leading-[17px]" style={{ color: toneColor.wait }}>
            This agent runs without a terminal, so its output is recorded but keystrokes are not
            accepted.
          </Text>
        </View>
      )}

      {/* A `Well`, not a `Card`: terminal output is a *hole* in the surface. It
          is darker than everything around it, it is never raised, and it is
          never the thing you tap — those three properties are what make a block
          read as output rather than as a control, and `Well` is the one
          component that guarantees all three. */}
      <Well className="max-h-[460px] border border-line" style={{ borderRadius: radius.md }}>
        <ScrollView ref={scrollRef} contentContainerStyle={{ padding: 12 }} nestedScrollEnabled>
          <Mono className="text-[12px] leading-[17px] text-code-ink">
            {conversation.terminal.trim() ? conversation.terminal : 'No terminal output yet.'}
          </Mono>
        </ScrollView>
      </Well>
    </View>
  )
}

function TextInputShell({
  value,
  onChangeText,
  placeholder,
  onSubmit,
}: {
  value: string
  onChangeText: (value: string) => void
  placeholder: string
  onSubmit: () => void
}) {
  return (
    <TextInput
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={palette.ink4}
      accessibilityLabel={placeholder}
      autoCapitalize="none"
      autoCorrect={false}
      onSubmitEditing={onSubmit}
      returnKeyType="send"
      blurOnSubmit={false}
      style={{
        flex: 1,
        minHeight: 40,
        borderRadius: radius.sm,
        borderWidth: 1,
        borderColor: palette.line,
        backgroundColor: palette.field,
        paddingHorizontal: 11,
        paddingVertical: 0,
        color: palette.ink,
        fontSize: 13,
        fontFamily: 'Menlo',
      }}
    />
  )
}

export { X, toast }
