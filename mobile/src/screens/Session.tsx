/**
 * Session — the conversation. A compact translucent header (back · title +
 * status + project · the three view actions) over the timeline scrolling
 * beneath it; Sessions slide from the left, Model & Permissions from the
 * right with the engine switcher one level deeper. Every control keeps its
 * behavior: switching replaces the route, config choices cycle on tap.
 */

import * as React from 'react'
import { View } from 'react-native'
import { BlurTargetView } from 'expo-blur'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { useNavigation, useRoute, type RouteProp } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'

import { agentDisplayFor } from '@/lib/remote'
import { memoryApi } from '@/lib/api'
import { cn, relativeTime } from '@/lib/format'
import { useStore, useConversation } from '@/store'
import { sessionUIState, uiStateDisplay } from '@/lib/sessionState'
import type { RootStack } from '../navigation'
import { agentHue, color } from '../design/tokens'
import { MONO, W_SEMI } from '../design/fonts'
import { Bot, Check, ChevronLeft, ChevronRight, Cpu, Gauge, List, Panel, ShieldCheck, Sliders, Sparkles, Trash } from '../design/icons'
import { useKeyboardHeight } from '@/lib/keyboard'
import { Chrome, IconBtn, Label, Loader, Notice, Pill, Seg, Sheet, Tap, Text, haptic } from '../ui'
import { Timeline } from '../chat/Timeline'
import { Composer } from '../chat/Composer'
import { ContextRing } from '../chat/ContextRing'
import { contextUsageFor, formatTokens, type ContextUsage } from '../chat/context'
import { DEMO_CONVERSATION, DEMO_SESSION, isDemoSession } from '@/lib/demo'
import { WorkspacePageBody, WorkspaceTabs, type WorkspacePage } from '../chat/workspace'

type Pane = 'workspace' | 'controls' | 'engine' | 'context' | null

export function SessionScreen() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStack>>()
  const route = useRoute<RouteProp<RootStack, 'Session'>>()
  const { sessionId } = route.params
  const insets = useSafeAreaInsets()

  const liveSession = useStore((state) => state.sessions.find((row) => row.id === sessionId))
  const demo = isDemoSession(sessionId)
  const session = demo ? DEMO_SESSION : liveSession
  const connection = useStore((state) => state.connection)
  const config = useStore((state) => state.configs[sessionId])
  const notice = useStore((state) => state.notices[sessionId])
  const dismissNotice = useStore((state) => state.dismissNotice)
  const setConfig = useStore((state) => state.setConfig)
  const respondToApproval = useStore((state) => state.respondToApproval)
  const openSession = useStore((state) => state.openSession)
  const timelineDetail = useStore((s) => s.timelineDetail)
  const setTimelineDetail = useStore((s) => s.setTimelineDetail)
  const liveConversation = useConversation(sessionId)
  const conversation = demo ? DEMO_CONVERSATION : liveConversation

  const [pane, setPane] = React.useState<Pane>(null)
  const [page, setPage] = React.useState<WorkspacePage>('plan')
  const [headerH, setHeaderH] = React.useState(100)
  // Edge-to-edge means the keyboard overlays the app rather than resizing it,
  // so the transcript and composer are lifted by the IME's own height.
  const keyboard = useKeyboardHeight()
  // The transcript is what the chrome floats over, so it is what the blur samples.
  const contentRef = React.useRef<View>(null)

  React.useEffect(() => {
    if (demo) return
    void openSession(sessionId)
  }, [sessionId, openSession, demo])

  const uiState = session ? sessionUIState(session, conversation, connection) : 'ready'
  const display = uiStateDisplay(uiState)

  const agents = useStore((state) => state.agents)

  // The vitals line: engine · model · reasoning · permission mode, the same
  // dimensions the mockup prints under the title, taken from the session's own
  // reported config rather than assumed.
  const vitals = React.useMemo(() => {
    if (!session) return undefined
    const engine = agentDisplayFor(session, conversation, connection)
    const option = (id: string) =>
      config?.options?.find((entry) => entry.id === id)?.choices.find((choice) => choice.value === config?.options?.find((o) => o.id === id)?.currentValue)?.name
    const model = option('model')
    const reasoning = option('thought_level') ?? option('reasoning_effort')
    const permission = option('permission_mode')
    // Model ids arrive namespaced (`openrouter/dots-studio/dots-3-note-preview:free`).
    // The phone shows the leaf name — the full id is one tap away in the Model
    // row, and a truncated id tells the reader less than a whole short one.
    const shortModel = model ? model.split('/').pop()?.split(':')[0] : undefined
    const parts = [session.agent, shortModel, reasoning, permission]
      .filter((value): value is string => typeof value === 'string' && value.length > 0)
      .map((value) => value.replace(/_/g, ' '))
    return parts.length > 0 ? parts.join(' · ') : engine?.detail
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, config, conversation, connection])

  const contextUsage = React.useMemo(
    () => contextUsageFor(conversation, session, agents),
    [conversation, session, agents],
  )

  function switchSession(id: string) {
    setPane(null)
    if (id === sessionId) return
    navigation.replace('Session', { sessionId: id })
  }

  if (!session) {
    return <View className="flex-1 bg-canvas" />
  }

  return (
    <View className="flex-1 bg-canvas">
      {/* Header */}
      <View
        style={{ position: 'absolute', top: 0, left: 0, right: 0, zIndex: 20 }}
        onLayout={(event) => setHeaderH(event.nativeEvent.layout.height)}
      >
        <Chrome target={contentRef} />
        <View className="px-2 pb-2" style={{ paddingTop: insets.top + 6, borderBottomWidth: 0.5, borderBottomColor: color.line }}>
          <View className="min-w-0 flex-row items-center">
            <IconBtn label="Back" onPress={() => navigation.goBack()}>
              <ChevronLeft size={22} color={color.ink} stroke={2} />
            </IconBtn>

            <View className="ml-1.5 mr-3 min-w-0 flex-1">
              <Text className="text-[16px] font-semibold text-ink" numberOfLines={1}>
                {session.name}
              </Text>
              <View className="mt-0.5 min-w-0 flex-row items-center gap-1.5">
                <Pill label={display.label} tone={display.tone} pulse={display.pulse} className="h-5 px-2" />
                {session.project ? (
                  <>
                    <Text className="shrink-0 text-ink-3">·</Text>
                    <Text className="min-w-0 flex-1 text-[12px] text-ink-3" style={{ fontFamily: MONO }} numberOfLines={1}>
                      {session.project.split('/').pop() ?? session.project}
                    </Text>
                  </>
                ) : null}
                {connection !== 'connected' ? (
                  <>
                    <Text className="shrink-0 text-ink-3">·</Text>
                    <Text className="shrink-0 text-[12px] capitalize text-ink-3">{connection}</Text>
                  </>
                ) : null}
              </View>
            </View>

            {/* Context gauge · tune · panel. One set: three 36pt circles, 8pt
                apart, glyphs sized so the nine-stroke sliders and the
                two-stroke panel carry the same weight. */}
            <View className="shrink-0 flex-row items-center gap-2">
              <ContextRing
                usage={contextUsage}
                onPress={() => setPane((current) => (current === 'context' ? null : 'context'))}
              />
            <IconBtn
              label="Model and permissions"
              kind="fill"
              on={pane === 'controls'}
              onPress={() => setPane((current) => (current === 'controls' ? null : 'controls'))}
            >
              <Sliders size={18} stroke={1.7} color={pane === 'controls' ? color.accent : color.ink} />
            </IconBtn>
            {/* The desktop's right rail, as one control. It carries the pages
                (plan, agents, goal, files) *and* the sessions pane the phone
                used to hide behind its own button. */}
            <IconBtn
              label="Agent workspace"
              kind="fill"
              on={pane === 'workspace'}
              onPress={() => {
                void haptic('light')
                setPane((current) => (current === 'workspace' ? null : 'workspace'))
              }}
            >
                <Panel size={19} stroke={1.8} color={pane === 'workspace' ? color.accent : color.ink} />
              </IconBtn>
            </View>
          </View>

          {/* The vitals line — engine, model, reasoning, permission mode. This is
              the mockup's `.sh-detail`, and the only place on a phone where the
              current model is visible without opening a sheet. */}
          {vitals ? (
            <Text className="pr-3 pt-1 text-mono-cap text-ink-3" style={{ fontFamily: MONO, paddingLeft: 50 }} numberOfLines={1}>
              {vitals}
            </Text>
          ) : null}

          {notice ? <Notice message={notice} tone="warn" onClose={() => dismissNotice(sessionId)} /> : null}
        </View>
      </View>

      <View className="flex-1" style={{ paddingBottom: keyboard }}>
        <BlurTargetView ref={contentRef} style={{ flex: 1 }}>
          <Timeline
            conversation={conversation}
            sessionId={sessionId}
            topInset={headerH}
            onRespond={(requestId, decision, meta) => {
              if (requestId.startsWith('plan:')) {
                setConfig(sessionId, 'permission_mode', decision === 'approve' ? 'auto_edit' : 'plan')
                return
              }
              respondToApproval(sessionId, requestId, decision, meta)
            }}
          />
        </BlurTargetView>
        <Composer session={session} conversation={conversation} uiState={uiState} chromeTarget={contentRef} />
      </View>

      {/* Agent workspace — the desktop's right rail, as a bottom sheet. Pages
          first, then the other sessions in this project. */}
      <Sheet
        open={pane === 'workspace'}
        onClose={() => setPane(null)}
        title="Agent workspace"
        glyph={<Panel size={19} color={color.ink2} />}
      >
        <WorkspaceTabs value={page} onChange={setPage} />
        <WorkspacePageBody
          page={page}
          session={session}
          conversation={conversation}
          onOpenSession={(id) => switchSession(id)}
        />
      </Sheet>

      {/* Model & permissions — a sheet, not a side pane: the conversation is
          the page, and a sheet keeps it in place behind the controls. */}
      <Sheet
        open={pane === 'controls'}
        onClose={() => setPane(null)}
        title="Model & permissions"
        glyph={<Sliders size={19} color={color.ink2} />}
      >
        <Controls
          sessionId={sessionId}
          config={config}
          onSet={(id, value) => setConfig(sessionId, id, value)}
          onSwitch={() => setPane('engine')}
          onOpenContext={() => setPane('context')}
        />
        <MemorySection project={session.project} />
        <Label>Timeline</Label>
        {/* A row with the label on the left and a fixed-width control on the
            right — the segmented control must not be allowed to absorb the
            row, which is what a bare `flex-1` child would do. */}
        <View className="mx-4 flex-row items-center gap-3 py-1">
          <View className="min-w-0 flex-1">
            <Text className="text-body text-ink">Technical detail</Text>
            <Text className="mt-0.5 text-meta leading-[19px] text-ink-2">
              {timelineDetail === 'detailed'
                ? 'Tool calls and timings are shown in full.'
                : 'Quiet rows are collapsed into summaries.'}
            </Text>
          </View>
          <View style={{ width: 156 }}>
            <Seg
              value={timelineDetail}
              options={[
                { value: 'simple' as const, label: 'Simple' },
                { value: 'detailed' as const, label: 'Detail' },
              ]}
              onChange={(next) => setTimelineDetail(next)}
            />
          </View>
        </View>
      </Sheet>

      {/* Switch Engine — one level deeper, same edge so the path back is the
          way it came. */}
      <Sheet
        open={pane === 'engine'}
        onClose={() => setPane(null)}
        title="Switch engine"
        back={{ label: 'Back to controls', onPress: () => setPane('controls') }}
      >
        <EngineList sessionId={sessionId} onPicked={() => setPane('controls')} />
      </Sheet>

      {/* Context window — the ring's breakdown, the same numbers the desktop
          shows on its composer control. */}
      <Sheet open={pane === 'context'} onClose={() => setPane(null)} title="Context window" glyph={<List size={19} color={color.ink2} />}>
        <ContextBreakdown usage={contextUsage} />
      </Sheet>
    </View>
  )
}

/** Engine row + every live config dimension the agent reports. */
/**
 * The session's dimensions — engine, model, permission mode, thought level,
 * context window — each on its own row with the glyph the desktop uses for it,
 * and each opening the list of values it accepts.
 *
 * These rows used to *cycle* on tap: tapping "Permission Mode" walked to the
 * next value with no way to see what the values were or to go back. A control
 * whose options are invisible is a control you have to experiment with. Tapping
 * now opens the options, with the current one checked and the rest legible in
 * place.
 */
const DIMENSION_ICON: Record<string, (props: { size?: number; color?: string; stroke?: number }) => React.ReactElement> = {
  model: Cpu,
  permission_mode: ShieldCheck,
  thought_level: Sparkles,
  reasoning_effort: Sparkles,
  context_window: Gauge,
}

function Controls({
  sessionId,
  config,
  onSet,
  onSwitch,
  onOpenContext,
}: {
  sessionId: string
  config: ReturnType<typeof useStore.getState>['configs'][string] | undefined
  onSet: (id: string, value: string) => void
  onSwitch: () => void
  onOpenContext: () => void
}) {
  const agents = useStore((state) => state.agents)
  const sessions = useStore((state) => state.sessions)
  const session = sessions.find((row) => row.id === sessionId)
  const agentId = session?.agent ?? ''
  const agentName = agents.find((agent) => agent.id === agentId)?.name ?? agentId
  const [picking, setPicking] = React.useState<string | null>(null)

  // `context_window` is filtered out: the agent reports it as a dimension, but
  // it is a reading, not a choice — and the sheet draws its own row for it
  // below, so leaving it in produced two rows with the same name.
  const options = (config?.options ?? []).filter(
    (option) =>
      !['worktree', 'cwd', 'command', 'context_window'].includes(option.id) && option.mutability !== 'start_only',
  )

  const editing = picking ? options.find((option) => option.id === picking) : undefined

  // ── The options for one dimension ────────────────────────────────────────
  if (editing) {
    const Icon = DIMENSION_ICON[editing.id]
    return (
      <View className="pb-2">
        <Tap
          accessibilityRole="button"
          accessibilityLabel="Back to controls"
          onPress={() => setPicking(null)}
          className="min-h-[44px] w-full flex-row items-center gap-1.5 px-4"
        >
          <ChevronLeft size={15} color={color.accent} />
          <Text className="text-btn-md font-semibold text-accent">All controls</Text>
        </Tap>

        <View className="flex-row items-center gap-3 px-4 pb-2 pt-1">
          {Icon ? (
            <View className="size-[30px] shrink-0 items-center justify-center rounded-lg bg-field">
              <Icon size={16} color={color.ink2} stroke={1.8} />
            </View>
          ) : null}
          <View className="min-w-0 flex-1">
            <Text className="text-page-title font-semibold text-ink" weight={W_SEMI} numberOfLines={1}>
              {editing.name}
            </Text>
            <Text className="mt-0.5 text-meta text-ink-2">
              {editing.mutability === 'live' ? 'Applies immediately' : 'Applies to the next run'}
            </Text>
          </View>
        </View>

        {editing.choices.length === 0 ? (
          <Text className="px-4 py-3 text-sub leading-[19px] text-ink-3">
            This engine has not reported any values for {editing.name.toLowerCase()}.
          </Text>
        ) : (
          editing.choices.map((choice, index) => {
            const on = choice.value === editing.currentValue
            return (
              <Tap
                key={choice.value}
                accessibilityRole="button"
                accessibilityLabel={choice.name}
                accessibilityState={{ selected: on }}
                onPress={() => {
                  void haptic('select')
                  onSet(editing.id, choice.value)
                  setPicking(null)
                }}
                className={cn(
                  'min-h-[52px] w-full flex-row items-center gap-3 px-4 py-2.5',
                  on && 'bg-accent-tint',
                  index > 0 && !on && 'border-t',
                )}
                style={index > 0 && !on ? { borderColor: color.lineSoft } : undefined}
              >
                <View className="min-w-0 flex-1">
                  <Text
                    className={cn('text-body', on ? 'text-ink' : 'text-ink')}
                    style={editing.id === 'model' ? { fontFamily: MONO, fontSize: 13 } : undefined}
                    numberOfLines={1}
                  >
                    {choice.name}
                  </Text>
                  {choice.description ? (
                    <Text className="mt-0.5 text-meta leading-[17px] text-ink-2" numberOfLines={2}>
                      {choice.description}
                    </Text>
                  ) : null}
                </View>
                {on ? <Check size={16} color={color.accent} stroke={2.4} /> : null}
              </Tap>
            )
          })
        )}
      </View>
    )
  }

  // ── The dimensions ───────────────────────────────────────────────────────
  return (
    <View className="pb-2">
      <Tap
        accessibilityRole="button"
        accessibilityLabel="Switch engine"
        onPress={() => {
          void haptic('light')
          onSwitch()
        }}
        className="min-h-[56px] w-full flex-row items-center gap-3 px-4"
      >
        <View className="size-[30px] shrink-0 items-center justify-center rounded-lg bg-field">
          <Bot size={17} color={agentHue(agentId)} stroke={1.8} />
        </View>
        <View className="min-w-0 flex-1">
          <Text className="text-body font-semibold text-ink" weight={W_SEMI} numberOfLines={1}>
            {agentName}
          </Text>
          <Text className="mt-0.5 text-meta text-ink-2" numberOfLines={1}>
            Switch engine · keeps the transcript
          </Text>
        </View>
        <ChevronRight size={15} color={color.ink3} />
      </Tap>

      {options.length === 0 ? (
        <Text className="px-4 py-3 text-sub leading-[19px] text-ink-3">
          This agent has not reported live controls yet. They appear here as soon as the session announces them.
        </Text>
      ) : (
        options.map((option) => {
          const current = option.choices.find((choice) => choice.value === option.currentValue)
          const value = current?.name || option.currentValue || '—'
          const Icon = DIMENSION_ICON[option.id]
          return (
            <Tap
              key={option.id}
              accessibilityRole="button"
              accessibilityLabel={`${option.name}: ${value}. Opens the options.`}
              onPress={() => {
                void haptic('light')
                setPicking(option.id)
              }}
              className="min-h-[56px] w-full flex-row items-center gap-3 px-4"
            >
              <View className="size-[30px] shrink-0 items-center justify-center rounded-lg bg-field">
                {Icon ? <Icon size={16} color={color.ink2} stroke={1.8} /> : <Sliders size={16} color={color.ink2} stroke={1.8} />}
              </View>
              <View className="min-w-0 flex-1">
                <Text className="text-body text-ink" numberOfLines={1}>
                  {option.name}
                </Text>
                <Text className="mt-0.5 text-meta text-ink-2" numberOfLines={1}>
                  {option.choices.length > 1
                    ? `${option.choices.length} options`
                    : option.mutability === 'live'
                      ? 'Applies immediately'
                      : 'Applies to the next run'}
                </Text>
              </View>
              <Text
                className="shrink-0 text-sub text-ink-2"
                style={option.id === 'model' ? { fontFamily: MONO, fontSize: 12 } : undefined}
                numberOfLines={1}
              >
                {value}
              </Text>
              <ChevronRight size={15} color={color.ink3} />
            </Tap>
          )
        })
      )}

      <Tap
        accessibilityRole="button"
        accessibilityLabel="Context window"
        onPress={() => {
          void haptic('light')
          onOpenContext()
        }}
        className="min-h-[56px] w-full flex-row items-center gap-3 px-4"
      >
        <View className="size-[30px] shrink-0 items-center justify-center rounded-lg bg-field">
          <Gauge size={16} color={color.ink2} stroke={1.8} />
        </View>
        <View className="min-w-0 flex-1">
          <Text className="text-body text-ink">Context window</Text>
          <Text className="mt-0.5 text-meta text-ink-2">How full this session is · tap for the breakdown</Text>
        </View>
        <ChevronRight size={15} color={color.ink3} />
      </Tap>

      <Text className="px-4 pt-3 text-cap leading-[17px] text-ink-3">
        Changes are sent to the agent over the same channel the desktop uses. Dimensions this agent hasn't reported
        appear as soon as the session announces them.
      </Text>
    </View>
  )
}

/** Ready engines only, the current one checked. */
function EngineList({ sessionId, onPicked }: { sessionId: string; onPicked: () => void }) {
  const agents = useStore((state) => state.agents)
  const switchEngine = useStore((state) => state.switchEngine)
  const sessions = useStore((state) => state.sessions)
  const session = sessions.find((row) => row.id === sessionId)
  const agentId = session?.agent ?? ''
  const ready = agents.filter((agent) => agent.available)
  return (
    <View className="pb-2">
      <Label>Keeps the transcript — only the engine changes</Label>
      {ready.map((agent) => (
        <Tap
          key={agent.id}
          accessibilityRole="button"
          accessibilityLabel={agent.name}
          accessibilityState={{ selected: agent.id === agentId }}
          onPress={() => {
            void haptic('select')
            void switchEngine(sessionId, agent.id)
            onPicked()
          }}
          className={agent.id === agentId ? 'min-h-[50px] w-full flex-row items-center gap-2.5 bg-accent-tint px-4 py-[11px]' : 'min-h-[50px] w-full flex-row items-center gap-2.5 px-4 py-[11px]'}
        >
          <View className="size-[9px] shrink-0 rounded-full" style={{ backgroundColor: agentHue(agent.id) }} />
          <View className="min-w-0 flex-1">
            <Text className="text-[15px] text-ink" numberOfLines={1}>
              {agent.name}
            </Text>
            <Text className="mt-0.5 text-[10.5px] text-ink-3" style={{ fontFamily: MONO }} numberOfLines={1}>
              {agent.id}
            </Text>
          </View>
          {agent.id === agentId ? <Check size={15} color={color.accent} stroke={2.4} /> : null}
        </Tap>
      ))}
      <Text className="px-4 pt-3 text-[11.5px] leading-[17px] text-ink-3">
        Only engines reporting as ready are listed — Agents shows why an engine is down.
      </Text>
    </View>
  )
}
/**
 * The context ring's breakdown — the same five numbers the desktop's composer
 * control shows, in the phone's grouped-row shape. Rows the agent has not
 * reported are omitted rather than shown as zero: an unreported number is not
 * a measurement.
 */
function ContextBreakdown({ usage }: { usage?: ContextUsage }) {
  const rows: Array<{ label: string; value: string }> = []
  if (usage) {
    rows.push({ label: 'Context sent', value: formatTokens(usage.usedTokens) })
    if (usage.inputTokens !== undefined) rows.push({ label: 'New input', value: formatTokens(usage.inputTokens) })
    if (usage.outputTokens !== undefined) rows.push({ label: 'Last output', value: formatTokens(usage.outputTokens) })
    if (usage.cacheReadTokens !== undefined) rows.push({ label: 'Cache reads', value: formatTokens(usage.cacheReadTokens) })
    if (usage.windowTokens) rows.push({ label: 'Context window', value: formatTokens(usage.windowTokens) })
    if (usage.costUsd !== undefined) rows.push({ label: 'Last turn cost', value: `$${usage.costUsd.toFixed(4)}` })
  }

  if (rows.length === 0) {
    return (
      <View className="mx-4 my-4 rounded-card border-[1.5px] border-dashed px-5 py-8" style={{ borderColor: color.edge }}>
        <Text className="text-center text-body font-semibold text-ink-2" weight={W_SEMI}>
          Nothing reported yet
        </Text>
        <Text className="mt-1.5 text-center text-meta leading-[19px] text-ink-3">
          Token accounting appears here once the agent reports usage for a turn.
        </Text>
      </View>
    )
  }

  return (
    <View className="pb-2">
      {usage?.percent !== undefined ? (
        <View className="mx-4 mb-3 rounded-card bg-option px-4 py-3">
          <Text className="text-cap font-semibold uppercase text-ink-3" style={{ letterSpacing: 0.5 }}>
            Window
          </Text>
          <Text className="mt-1 text-large-title font-bold text-ink" style={{ fontVariant: ['tabular-nums'] }}>
            {Math.round(usage.percent)}%
          </Text>
          <Text className="mt-1 text-meta text-ink-2">
            {formatTokens(usage.usedTokens)} of {formatTokens(usage.windowTokens)} tokens used
          </Text>
        </View>
      ) : (
        <Text className="mx-4 mb-2 text-meta leading-[19px] text-ink-3">
          This engine has not reported a context window, so only the raw counts are shown.
        </Text>
      )}
      {(usage?.percent !== undefined ? rows.slice(1) : rows).map((row, index) => (
        <View
          key={row.label}
          className="flex-row items-center gap-3 px-4 py-3"
          style={index > 0 ? { borderTopWidth: 0.5, borderTopColor: color.lineSoft } : undefined}
        >
          <Text className="min-w-0 flex-1 text-body text-ink">{row.label}</Text>
          <Text className="shrink-0 text-mono-small text-ink-2" style={{ fontFamily: MONO, fontVariant: ['tabular-nums'] }}>
            {row.value}
          </Text>
        </View>
      ))}
    </View>
  )
}

/**
 * Memory — what this project has taught the daemon, and the switch that decides
 * whether any of it is injected.
 *
 * It sits with the session's other live dimensions (model, thought level,
 * permissions) because it is one of them: something the next prompt carries,
 * scoped to this session's project. The same setting is reachable from a
 * workspace on the home screen — one per-project flag, two places that show it,
 * never two copies of it.
 */
export function MemorySection({ project }: { project: string | null }) {
  const [entries, setEntries] = React.useState<Array<{ id: string; content: string; created_at: string }> | null>(null)
  const [enabled, setEnabled] = React.useState<boolean | null>(null)
  const [error, setError] = React.useState<string | undefined>(undefined)
  const [busy, setBusy] = React.useState(false)

  const load = React.useCallback(async () => {
    if (!project) {
      setEntries([])
      return
    }
    setError(undefined)
    try {
      const [list, config] = await Promise.all([memoryApi.list(project), memoryApi.config(project)])
      setEntries(list.memories ?? [])
      setEnabled(config.enabled)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not read this project’s memory.')
    }
  }, [project])

  React.useEffect(() => {
    void load()
  }, [load])

  async function toggle(next: boolean) {
    if (!project) return
    setBusy(true)
    setEnabled(next)
    try {
      await memoryApi.setConfig(next, project)
      void haptic('select')
    } catch (cause) {
      setEnabled(!next)
      setError(cause instanceof Error ? cause.message : 'Could not change that setting.')
    } finally {
      setBusy(false)
    }
  }

  async function forget(id: string) {
    setEntries((current) => (current ?? []).filter((entry) => entry.id !== id))
    try {
      await memoryApi.delete(id)
    } catch {
      void load()
    }
  }

  if (!project) {
    return (
      <>
        <Label>Memory</Label>
        <Text className="mx-4 text-sub leading-[19px] text-ink-3">
          This session has no project folder, and memory is kept per project — so there is nothing here to
          remember.
        </Text>
      </>
    )
  }

  return (
    <>
      <Label>Memory</Label>
      <View className="mx-4 mb-3 flex-row items-center gap-3 rounded-card bg-option px-3.5 py-3">
        <View className="min-w-0 flex-1">
          <Text className="text-body text-ink">Use project memory</Text>
          <Text className="mt-0.5 text-meta leading-[18px] text-ink-2">
            Inject what this project has learned into each new prompt.
          </Text>
        </View>
        {/* The Seg's segments are `flex-1`, so it needs a width to divide. */}
        <View style={{ width: 132, opacity: busy ? 0.5 : 1 }}>
          <Seg
            value={enabled === false ? 'off' : 'on'}
            options={[
              { value: 'on' as const, label: 'On' },
              { value: 'off' as const, label: 'Off' },
            ]}
            onChange={(next) => void toggle(next === 'on')}
          />
        </View>
      </View>

      {error ? <Text className="mx-4 mb-2 text-meta leading-[18px] text-red">{error}</Text> : null}

      <View className="mx-4 mb-2 flex-row items-center gap-2">
        <Text className="text-cap font-semibold uppercase text-ink-3" style={{ letterSpacing: 0.5 }}>
          Remembered
        </Text>
        <View className="flex-1" />
        <Text className="text-cap text-ink-3" style={{ fontVariant: ['tabular-nums'] }}>
          {entries?.length ?? 0}
        </Text>
      </View>

      {entries === null ? (
        <View className="mx-4 mb-2 rounded-card bg-option px-4 py-3">
          <Loader label="Reading memory…" />
        </View>
      ) : entries.length === 0 ? (
        <Text className="mx-4 text-sub leading-[19px] text-ink-3">
          Nothing remembered yet. Entries appear here as the agent saves what it works out about this project.
        </Text>
      ) : (
        entries.map((entry) => (
          <View key={entry.id} className="mx-4 mb-2 rounded-card bg-card px-3.5 py-3">
            <Text className="text-sub leading-[20px] text-ink">{entry.content}</Text>
            <View className="mt-2 flex-row items-center gap-2">
              <Text className="min-w-0 flex-1 text-mono-cap text-ink-3" style={{ fontFamily: MONO }}>
                {relativeTime(entry.created_at)}
              </Text>
              <Tap
                accessibilityRole="button"
                accessibilityLabel="Forget this entry"
                onPress={() => void forget(entry.id)}
                hitSlop={8}
                className="shrink-0 flex-row items-center gap-1 rounded-pill bg-field px-2.5 py-1"
              >
                <Trash size={12} color={color.ink2} />
                <Text className="text-cap font-semibold text-ink-2">Forget</Text>
              </Tap>
            </View>
          </View>
        ))
      )}

      <Text className="mx-4 mt-1 text-cap leading-[16px] text-ink-3">
        Stored on the desktop at .agentdeck/memory.json inside the project.
      </Text>
    </>
  )
}
