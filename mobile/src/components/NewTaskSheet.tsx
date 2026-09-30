/**
 * New task — the app's only verb, as a two-step launch sheet.
 *
 * QAI SIGNAL DECK
 * ---------------
 * The desktop's provider → project → prompt becomes two deck steps: Where
 * (workspace, most-used first, Inbox last, plus a typed path) and What and
 * how (agent, first prompt, model/thought/permissions that matter at creation
 * — permission pre-explained, because `ask` on a long pocket run means
 * approving files one at a time). Rises as a deck sheet with detents; same
 * create/setConfig handlers and ordering as the desktop.
 */

import * as React from 'react'
import { Animated, Pressable, Text, View } from 'react-native'
import { Check, ChevronDown, ChevronLeft, Folder, Inbox, Sparkles } from 'lucide-react-native'

import { basename } from '@/lib/format'
import { useStore } from '@app/store'
import type { Session } from '@/types/session'
import { palette, radius, toneColor } from '@app/design/tokens'
import { Sheet, PickerSheet } from '@app/components/Sheet'
import { rowEnterStyle, staggerDelay, useEnter } from '@app/components/motion'
import {
  AgentAvatar,
  Badge,
  Button,
  Eyebrow,
  Field,
  Mono,
  haptic,
  toast,
} from '@app/components/ui'

/** The desktop's four permission modes, same ids and labels. */
const PERMISSION_MODES = [
  { value: 'ask', label: 'Ask before changes', hint: 'Pause for you before any file change.' },
  { value: 'auto_edit', label: 'Edit automatically', hint: 'Apply edits; still asks for commands.' },
  { value: 'plan', label: 'Plan mode', hint: 'Produce a plan first and wait for approval.' },
  { value: 'full', label: 'Full access', hint: 'Run with fewer confirmations.' },
]

/** Providers report models and reasoning levels in either shape. */
function choicesOf(value: unknown): Array<{ value: string; label: string }> {
  if (!Array.isArray(value)) return []
  return value
    .map((entry) => {
      if (typeof entry === 'string') return { value: entry, label: entry }
      const record = entry as { id?: string; name?: string; value?: string }
      const v = record.value ?? record.id
      if (!v) return null
      return { value: v, label: record.name ?? v }
    })
    .filter((entry): entry is { value: string; label: string } => entry !== null)
}

type Step = 1 | 2

export function NewTaskSheet({
  open,
  onClose,
  onCreated,
  initialProject,
  initialAgent,
}: {
  open: boolean
  onClose: () => void
  onCreated: (session: Session) => void
  initialProject?: string | null
  /** Pre-selects an agent and jumps to step 2 — set by a quick launch. */
  initialAgent?: string
}) {
  const agents = useStore((state) => state.agents)
  const sessions = useStore((state) => state.sessions)
  const createSession = useStore((state) => state.createSession)
  const setConfig = useStore((state) => state.setConfig)

  const [step, setStep] = React.useState<Step>(1)
  const [project, setProject] = React.useState('')
  const [customPath, setCustomPath] = React.useState('')
  const [agentId, setAgentId] = React.useState<string | undefined>()
  const [prompt, setPrompt] = React.useState('')
  const [model, setModel] = React.useState<string | undefined>()
  const [thought, setThought] = React.useState<string | undefined>()
  const [permission, setPermission] = React.useState('ask')
  const [picker, setPicker] = React.useState<'model' | 'thought' | 'permission' | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [showCustom, setShowCustom] = React.useState(false)

  const ready = agents.filter((agent) => agent.available)
  const selected = ready.find((agent) => agent.id === agentId)

  /** Workspaces ordered by how often they have been used, as the desktop does. */
  const recent = React.useMemo(() => {
    const counts = new Map<string, number>()
    for (const session of sessions) {
      if (session.project) counts.set(session.project, (counts.get(session.project) ?? 0) + 1)
    }
    return [...counts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([path, count]) => ({ path, count }))
  }, [sessions])

  // Reset when the sheet opens. Deliberately keyed on `open` alone: `recent`
  // changes on every socket frame, and depending on it would wipe a prompt the
  // user is halfway through typing.
  const recentRef = React.useRef(recent)
  recentRef.current = recent
  React.useEffect(() => {
    if (!open) return
    setStep(initialAgent ? 2 : 1)
    setError(null)
    setPrompt('')
    setCustomPath('')
    setShowCustom(false)
    setModel(undefined)
    setThought(undefined)
    setPermission('ask')
    setProject(initialProject ?? recentRef.current[0]?.path ?? '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialProject, initialAgent])

  // Quick launch wins over a stale choice; otherwise default to the first ready
  // agent so step 2 is immediately usable.
  React.useEffect(() => {
    if (open && initialAgent) {
      setAgentId(initialAgent)
      return
    }
    if (agentId || ready.length === 0) return
    setAgentId(ready[0].id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialAgent, agentId, ready])

  const effectiveProject = customPath.trim() || project
  const modelChoices = choicesOf(selected?.models)
  const thoughtChoices = choicesOf(selected?.reasoningLevels)

  async function create() {
    if (!selected) return
    setBusy(true)
    setError(null)
    try {
      const firstLine = prompt.trim().split('\n')[0]?.slice(0, 60)
      const session = await createSession({
        agent: selected.id,
        project: effectiveProject || undefined,
        prompt: prompt.trim() || undefined,
        name: firstLine || undefined,
        model,
        thought,
      })
      if (!session) throw new Error('The desktop refused to start that session.')
      // Anything the agent exposes beyond model/thought is applied live.
      if (permission !== 'ask') setConfig(session.id, 'permission_mode', permission)
      setPrompt('')
      onCreated(session)
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not start that session')
    } finally {
      setBusy(false)
    }
  }

  const canStart = Boolean(selected) && ready.length > 0

  return (
    <>
      <Sheet
        open={open}
        onClose={onClose}
        title={step === 1 ? 'Where' : 'What and how'}
        eyebrow={`New task · Step ${step} of 2`}
        snapPoints={[0.62, 0.94]}
        footer={
          step === 1 ? (
            <Button
              variant="primary"
              label="Next — pick an agent"
              full
              trailingIcon={<Sparkles size={16} color={palette.accentInk} />}
              onPress={() => {
                void haptic('light')
                setStep(2)
              }}
            />
          ) : (
            <View style={{ gap: 8 }}>
              {error ? (
                <Text className="text-[12px] leading-[16px] text-danger" numberOfLines={2}>
                  {error}
                </Text>
              ) : null}
              <Button
                variant="primary"
                label={busy ? 'Starting…' : 'Start session'}
                full
                disabled={busy || !canStart}
                onPress={() => void create()}
              />
            </View>
          )
        }
      >
        {step === 1 ? (
          <View style={{ gap: 10 }}>
            {recent.length === 0 ? (
              <Text className="py-1 text-[13px] leading-[18px] text-ink-3">
                No workspaces yet. Start in the Inbox, or type a path that exists on the desktop.
              </Text>
            ) : (
              recent.map((entry, index) => (
                <WorkspaceChoice
                  key={entry.path}
                  name={basename(entry.path)}
                  path={entry.path}
                  count={entry.count}
                  index={index}
                  active={entry.path === project && !customPath.trim()}
                  onPress={() => {
                    void haptic('select')
                    setProject(entry.path)
                    setCustomPath('')
                    setShowCustom(false)
                  }}
                />
              ))
            )}

            <WorkspaceRow
              name="Inbox"
              path="No folder — runs in the daemon's working directory"
              icon={<Inbox size={16} color={palette.ink3} />}
              active={!effectiveProject}
              onPress={() => {
                void haptic('select')
                setProject('')
                setCustomPath('')
                setShowCustom(false)
              }}
            />

            {showCustom ? (
              <View style={{ gap: 8, paddingTop: 4 }}>
                <Field
                  value={customPath}
                  onChangeText={(value) => {
                    setCustomPath(value)
                    setProject('')
                  }}
                  placeholder="/home/you/project"
                  accessibilityLabel="Project path on the desktop"
                  autoCapitalize="none"
                  autoCorrect={false}
                  mono
                />
                <Text className="text-[12px] leading-[16px] text-ink-3">
                  The path is resolved on the desktop, not on this phone.
                </Text>
              </View>
            ) : (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Enter a project path manually"
                onPress={() => {
                  void haptic('light')
                  setShowCustom(true)
                }}
                style={({ pressed }) => ({
                  minHeight: 48,
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: radius.md,
                  borderWidth: 1,
                  borderStyle: 'dashed',
                  borderColor: pressed ? palette.lineStrong : palette.line,
                  backgroundColor: pressed ? palette.raised : 'transparent',
                })}
              >
                <Text className="text-[13px] leading-[18px] font-semibold text-ink-3">Use another path…</Text>
              </Pressable>
            )}
          </View>
        ) : (
          <View style={{ gap: 20 }}>
            {/* ── Agent ────────────────────────────────────────────────────
                Cards, not chips: an agent is a decision with a name, a hue and
                a readiness, and a 40pt pill cannot carry that. */}
            <View style={{ gap: 8 }}>
              <Eyebrow>Agent</Eyebrow>
              {ready.length === 0 ? (
                <View
                  style={{
                    borderRadius: radius.md,
                    borderWidth: 1,
                    borderColor: palette.line,
                    backgroundColor: palette.well,
                    padding: 14,
                  }}
                >
                  <Text className="text-[13px] leading-[18px] text-ink-2">
                    No agent is ready on the desktop. Install a supported CLI there, then re-scan
                    from System → Agents.
                  </Text>
                </View>
              ) : (
                ready.map((agent, index) => (
                  <AgentChoice
                    key={agent.id}
                    agent={agent}
                    index={index}
                    active={agent.id === agentId}
                    onPress={() => {
                      void haptic('select')
                      setAgentId(agent.id)
                      setModel(undefined)
                      setThought(undefined)
                    }}
                  />
                ))
              )}
            </View>

            {/* ── First prompt ───────────────────────────────────────────── */}
            <View style={{ gap: 8 }}>
              <Eyebrow>First prompt</Eyebrow>
              <Field
                value={prompt}
                onChangeText={setPrompt}
                placeholder="What should it do?"
                accessibilityLabel="First prompt for the agent"
                multiline
                containerClassName="min-h-[96px]"
                style={{ lineHeight: 22 }}
              />
              <Text className="text-[12px] leading-[16px] text-ink-3">
                Optional — you can send it from the session instead. If you leave this blank the
                session opens empty and ready.
              </Text>
            </View>

            {/* ── Configuration ─────────────────────────────────────────── */}
            <View style={{ gap: 8 }}>
              <Eyebrow>Configuration</Eyebrow>
              <View style={{ gap: 6 }}>
                <ConfigRow
                  label="Model"
                  value={model ?? 'Default'}
                  disabled={modelChoices.length === 0}
                  hint={modelChoices.length === 0 ? 'This agent has no model list' : undefined}
                  onPress={() => setPicker('model')}
                />
                <ConfigRow
                  label="Thought level"
                  value={thought ?? 'Default'}
                  disabled={thoughtChoices.length === 0}
                  hint={thoughtChoices.length === 0 ? 'This agent reports none' : undefined}
                  onPress={() => setPicker('thought')}
                />
                <ConfigRow
                  label="Permissions"
                  value={PERMISSION_MODES.find((mode) => mode.value === permission)?.label ?? 'Ask'}
                  hint={PERMISSION_MODES.find((mode) => mode.value === permission)?.hint}
                  tone="wait"
                  onPress={() => setPicker('permission')}
                />
              </View>
            </View>
          </View>
        )}
      </Sheet>

      <PickerSheet
        open={picker !== null}
        onClose={() => setPicker(null)}
        title={picker === 'model' ? 'Model' : picker === 'thought' ? 'Thought level' : 'Permissions'}
        subtitle={picker === 'permission' ? 'How much this run may do without stopping' : effectiveProject || 'Inbox'}
        value={picker === 'model' ? model : picker === 'thought' ? thought : permission}
        onSelect={(value) => {
          if (picker === 'model') setModel(value)
          else if (picker === 'thought') setThought(value)
          else setPermission(value)
        }}
        options={
          picker === 'model'
            ? modelChoices
            : picker === 'thought'
              ? thoughtChoices
              : PERMISSION_MODES.map((mode) => ({ value: mode.value, label: mode.label, hint: mode.hint }))
        }
        searchable={picker === 'permission' ? false : true}
        allowsCustomValue={picker === 'model' || picker === 'thought'}
        customPlaceholder="Any model id this agent accepts"
      />
    </>
  )
}

/**
 * One workspace option.
 *
 * Its own component so the entry animation's `Animated.Value` is created by a
 * hook on a stable component rather than inside a `.map` callback — a hook in a
 * loop is a hook whose order depends on the list length, which is exactly the
 * class of bug that only shows up after a session is archived.
 */
function WorkspaceChoice({
  name,
  path,
  count,
  index,
  active,
  onPress,
}: {
  name: string
  path: string
  count: number
  index: number
  active: boolean
  onPress: () => void
}) {
  const enter = useEnter(staggerDelay(index), false)
  return (
    <Animated.View style={rowEnterStyle(enter)}>
      <WorkspaceRow
        name={name}
        path={path}
        detail={`${count} ${count === 1 ? 'session' : 'sessions'}`}
        active={active}
        onPress={onPress}
      />
    </Animated.View>
  )
}

function AgentChoice({
  agent,
  index,
  active,
  onPress,
}: {
  agent: { id: string; name: string; protocol?: string }
  index: number
  active: boolean
  onPress: () => void
}) {
  const enter = useEnter(staggerDelay(index), false)
  return (
    <Animated.View style={rowEnterStyle(enter)}>
      <Pressable
        accessibilityRole="radio"
        accessibilityLabel={agent.name}
        accessibilityState={{ selected: active }}
        onPress={onPress}
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          borderRadius: radius.md,
          borderWidth: 1,
          borderColor: active ? palette.accentBorder : palette.line,
          backgroundColor: active
            ? palette.accentSoft
            : pressed
              ? palette.raised
              : palette.surface,
          paddingHorizontal: 13,
          paddingVertical: 12,
          minHeight: 60,
        })}
      >
        <AgentAvatar agent={agent.id} size={34} name={agent.name} />
        <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
          <Text className="text-[15px] leading-[20px] font-semibold text-ink" numberOfLines={1}>
            {agent.name}
          </Text>
          <Mono className="text-[11px] leading-[15px]" numberOfLines={1}>
            {agent.id}
          </Mono>
        </View>
        {agent.protocol ? (
          <Badge tone={active ? 'accent' : 'muted'} mono>
            {agent.protocol}
          </Badge>
        ) : null}
        {active ? (
          <View
            style={{
              width: 22,
              height: 22,
              borderRadius: 11,
              alignItems: 'center',
              justifyContent: 'center',
              backgroundColor: palette.accent,
            }}
          >
            <Check size={13} color={palette.accentInk} strokeWidth={3} />
          </View>
        ) : null}
      </Pressable>
    </Animated.View>
  )
}

function WorkspaceRow({
  name,
  path,
  detail,
  icon,
  active,
  onPress,
}: {
  name: string
  path: string
  detail?: string
  icon?: React.ReactNode
  active: boolean
  onPress: () => void
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={name}
      accessibilityHint={path}
      accessibilityState={{ selected: active }}
      onPress={onPress}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 12,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: active ? palette.accentBorder : palette.line,
        backgroundColor: active ? palette.accentSoft : pressed ? palette.raised : palette.surface,
        paddingHorizontal: 13,
        paddingVertical: 11,
        minHeight: 58,
      })}
    >
      <View
        style={{
          width: 34,
          height: 34,
          borderRadius: radius.sm,
          alignItems: 'center',
          justifyContent: 'center',
          backgroundColor: active ? palette.accentSoftStrong : palette.raised,
          borderWidth: 1,
          borderColor: active ? palette.accentBorder : palette.line,
        }}
      >
        {icon ?? <Folder size={16} color={active ? palette.accent : palette.ink3} />}
      </View>
      <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
        <Text
          className="text-[15px] leading-[20px]"
          style={{ color: active ? palette.ink : palette.ink2, fontWeight: active ? '600' : '500' }}
          numberOfLines={1}
        >
          {name}
        </Text>
        <Mono className="text-[11px] leading-[15px]" numberOfLines={1}>
          {detail ?? path}
        </Mono>
      </View>
      {active ? <Check size={18} color={palette.accent} strokeWidth={2.6} /> : null}
    </Pressable>
  )
}

function ConfigRow({
  label,
  value,
  hint,
  onPress,
  disabled,
  tone,
}: {
  label: string
  value: string
  hint?: string
  onPress: () => void
  disabled?: boolean
  tone?: 'wait'
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={`${label}: ${value}`}
      accessibilityHint={hint}
      onPress={onPress}
      disabled={disabled}
      style={({ pressed }) => ({
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: palette.line,
        backgroundColor: pressed ? palette.raised : palette.surface,
        paddingHorizontal: 13,
        paddingVertical: 11,
        minHeight: 52,
        opacity: disabled ? 0.4 : 1,
      })}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
        <Text className="text-[13px] leading-[18px] text-ink-2">{label}</Text>
        <View style={{ flex: 1 }} />
        {tone === 'wait' && value !== 'Ask before changes' ? (
          <View
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={{ width: 6, height: 6, borderRadius: 3, backgroundColor: toneColor.wait }}
          />
        ) : null}
        <Text className="max-w-[55%] text-[14px] leading-[19px] font-semibold text-ink" numberOfLines={1}>
          {value}
        </Text>
        <ChevronDown size={15} color={palette.ink4} />
      </View>
      {hint ? (
        <Text className="mt-1 text-[12px] leading-[16px] text-ink-3" numberOfLines={2}>
          {hint}
        </Text>
      ) : null}
    </Pressable>
  )
}

export { ChevronLeft, Sparkles, toast }
