/**
 * Subagents — spawn a focused child agent, or fan a task out across several.
 *
 * The desktop exposes these as a `WorkerModal` in the composer. On a phone the
 * composer is for typing, and the multi-agent controls are a decision made
 * *before* the prompt, not a control pressed after it. So this is a full sheet
 * with a clear mode switch at the top, and the two modes are genuinely
 * different flows rather than a toggle on one form:
 *
 *   - **Single subagent**: pick a role, write a task. One child, one answer.
 *   - **Fan-out**: pick several agents, decide whether to merge, write one
 *     task. The merge choice is a first-class switch rather than a checkbox
 *     because it changes the shape of the *result*: merged gives you one
 *     synthesised answer, unmerged gives you each worker's answer in sequence.
 *
 * Both write into the same transcript the primary agent reads, so the results
 * arrive where the user is already looking.
 */

import * as React from 'react'
import { Pressable, Text, View } from 'react-native'
import { Check, Layers, Users } from 'lucide-react-native'

import { mobileApi } from '@app/lib/api'
import { useStore } from '@app/store'
import { palette, radius } from '@app/design/tokens'
import { FormSheet } from '@app/components/Sheet'
import { rowEnterStyle, staggerDelay, useEnter } from '@app/components/motion'
import {
  AgentAvatar,
  CheckRow,
  Eyebrow,
  Field,
  Segmented,
  ToggleRow,
  haptic,
  toast,
} from '@app/components/ui'

type Mode = 'spawn' | 'orchestrate'

const BUILTIN_ROLES = [
  { id: 'worker', label: 'Worker', desc: 'General-purpose autonomous executor' },
  { id: 'reviewer', label: 'Reviewer', desc: 'Read-only code and design auditor' },
  { id: 'planner', label: 'Planner', desc: 'High-level task decomposition' },
  { id: 'summarizer', label: 'Summarizer', desc: 'Compact synthesis of progress' },
]

export function SubagentSheet({
  open,
  onClose,
  sessionId,
  onOpenSession,
}: {
  open: boolean
  onClose: () => void
  sessionId: string
  onOpenSession?: (childId: string) => void
}) {
  const agents = useStore((s) => s.agents)
  const readyAgents = agents.filter((a) => a.available)

  const [mode, setMode] = React.useState<Mode>('spawn')
  const [role, setRole] = React.useState('worker')
  const [prompt, setPrompt] = React.useState('')
  const [selected, setSelected] = React.useState<string[]>([])
  const [merge, setMerge] = React.useState(true)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!open) return
    setPrompt('')
    setError(null)
    setSelected(readyAgents.length > 0 ? [readyAgents[0].id] : [])
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open])

  function toggleAgent(agentId: string) {
    setSelected((current) =>
      current.includes(agentId) ? current.filter((id) => id !== agentId) : [...current, agentId],
    )
  }

  async function execute() {
    if (!prompt.trim()) return
    setBusy(true)
    setError(null)
    try {
      if (mode === 'spawn') {
        const res = await mobileApi.spawnSubagent(sessionId, { role, prompt: prompt.trim() })
        toast({ message: 'Subagent started', tone: 'ok' })
        if (res.child_session_id && onOpenSession) onOpenSession(res.child_session_id)
      } else {
        if (selected.length === 0) {
          setError('Pick at least one agent to fan the task out to.')
          return
        }
        await mobileApi.orchestrate(sessionId, { prompt: prompt.trim(), agents: selected, merge })
        toast({ message: `Fanned out to ${selected.length} ${selected.length === 1 ? 'agent' : 'agents'}`, tone: 'ok' })
      }
      setPrompt('')
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'That action failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <FormSheet
      open={open}
      onClose={onClose}
      eyebrow="Multi-agent"
      title={mode === 'spawn' ? 'Spawn a subagent' : 'Fan out a task'}
      submitLabel={mode === 'spawn' ? 'Spawn subagent' : `Fan out to ${selected.length || 0}`}
      onSubmit={() => void execute()}
      busy={busy}
      error={error}
      disabled={!prompt.trim()}
    >
      <Segmented
        label="Multi-agent mode"
        value={mode}
        onChange={(value) => setMode(value as Mode)}
        options={[
          { value: 'spawn', label: 'One subagent' },
          { value: 'orchestrate', label: 'Fan-out' },
        ]}
      />

      {mode === 'spawn' ? (
        <View style={{ gap: 8, marginTop: 14 }}>
          <Eyebrow>Role</Eyebrow>
          <View style={{ gap: 6 }}>
            {BUILTIN_ROLES.map((entry, index) => (
              <RoleChoice
                key={entry.id}
                role={entry}
                index={index}
                active={entry.id === role}
                onPress={() => {
                  void haptic('select')
                  setRole(entry.id)
                }}
              />
            ))}
          </View>
        </View>
      ) : (
        <View style={{ gap: 12, marginTop: 14 }}>
          <View style={{ gap: 7 }}>
            <Eyebrow>Target agents</Eyebrow>
            {readyAgents.length === 0 ? (
              <Text className="text-[13px] leading-[18px] text-ink-3">
                No agent is ready on the desktop.
              </Text>
            ) : (
              <View style={{ gap: 4 }}>
                {readyAgents.map((agent, index) => (
                  <AgentToggle
                    key={agent.id}
                    agent={agent}
                    index={index}
                    checked={selected.includes(agent.id)}
                    onPress={() => {
                      void haptic('select')
                      toggleAgent(agent.id)
                    }}
                  />
                ))}
              </View>
            )}
          </View>

          <ToggleRow
            label="Merge synthesis"
            description="Combines the workers' answers into one. Off keeps each answer separate."
            value={merge}
            onChange={setMerge}
            leading={<Layers size={17} color={palette.ink3} />}
          />
        </View>
      )}

      <View style={{ gap: 8, marginTop: 16 }}>
        <Eyebrow>{mode === 'spawn' ? 'What should it do?' : 'The task to fan out'}</Eyebrow>
        <Field
          value={prompt}
          onChangeText={setPrompt}
          placeholder={
            mode === 'spawn'
              ? 'Investigate the flaky auth test and report what you find…'
              : 'Describe the task every worker should tackle…'
          }
          accessibilityLabel="Task for the subagent"
          multiline
          containerClassName="min-h-[110px]"
          style={{ textAlignVertical: 'top', lineHeight: 21 }}
        />
      </View>
    </FormSheet>
  )
}

function RoleChoice({
  role,
  index,
  active,
  onPress,
}: {
  role: { id: string; label: string; desc: string }
  index: number
  active: boolean
  onPress: () => void
}) {
  const enter = useEnter(staggerDelay(index), false)
  return (
    <View style={rowEnterStyle(enter)}>
      <Pressable
        accessibilityRole="radio"
        accessibilityLabel={role.label}
        accessibilityHint={role.desc}
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
          paddingVertical: 11,
          minHeight: 54,
        })}
      >
        <View
          style={{
            width: 32,
            height: 32,
            borderRadius: radius.sm,
            alignItems: 'center',
            justifyContent: 'center',
            backgroundColor: active ? palette.accentSoftStrong : palette.raised,
            borderWidth: 1,
            borderColor: active ? palette.accentBorder : palette.line,
          }}
        >
          <Users size={15} color={active ? palette.accent : palette.ink3} />
        </View>
        <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
          <Text
            className="text-[14.5px] leading-[19px]"
            style={{ color: active ? palette.ink : palette.ink2, fontWeight: active ? '600' : '500' }}
            numberOfLines={1}
          >
            {role.label}
          </Text>
          <Text className="text-[12px] leading-[16px] text-ink-3" numberOfLines={1}>
            {role.desc}
          </Text>
        </View>
        {active ? <Check size={17} color={palette.accent} strokeWidth={2.6} /> : null}
      </Pressable>
    </View>
  )
}

/**
 * One target agent in the fan-out picker.
 *
 * `CheckRow` rather than a bespoke card: the whole point of this list is the
 * checked state, and a primitive that draws the box, reports it to assistive
 * tech and keeps the 48pt target is the thing that makes every multi-select in
 * the app behave the same. The only thing this adds is the agent's avatar,
 * because a fan-out list of three bare names is a list you have to read.
 */
function AgentToggle({
  agent,
  index,
  checked,
  onPress,
}: {
  agent: { id: string; name: string }
  index: number
  checked: boolean
  onPress: () => void
}) {
  const enter = useEnter(staggerDelay(index), false)
  return (
    <View style={rowEnterStyle(enter)}>
      <CheckRow
        label={agent.name}
        checked={checked}
        onPress={onPress}
        leading={<AgentAvatar agent={agent.id} size={26} name={agent.name} />}
      />
    </View>
  )
}
