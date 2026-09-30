/**
 * Engine switch — move a live session onto a different CLI or model.
 *
 * The desktop's `EngineModelMenu` is a two-level anchored dropdown: pick the
 * provider, then the model, with the model list filtered to what that provider
 * reports. On a phone a dropdown that opens upward over a transcript is a
 * dropdown you cannot read, and a two-level one is worse — so this is a sheet,
 * and it is honest about what the operation does:
 *
 * **Switching is not free.** A digest of the previous turns is handed to the
 * new provider so the conversation survives, which means a new process, a new
 * cost, and a context that is no longer byte-identical to what the old agent
 * saw. Saying so up front is the difference between a switch and a trap, and
 * it is why the current engine is labelled and the confirm button is disabled
 * until you pick something different.
 *
 * The model list is the provider's own. Model ids are opaque — never split on
 * `/`, never lowercased — because some providers namespace ids and the case is
 * part of them.
 */

import * as React from 'react'
import { Pressable, Text, View } from 'react-native'
import { Check } from 'lucide-react-native'

import { useStore } from '@app/store'
import { palette, radius } from '@app/design/tokens'
import { FormSheet } from '@app/components/Sheet'
import { rowEnterStyle, staggerDelay, useEnter } from '@app/components/motion'
import { AgentAvatar, Badge, Eyebrow, Mono, Notice, haptic, toast } from '@app/components/ui'

export function EngineSwitchSheet({
  open,
  onClose,
  sessionId,
  currentAgent,
}: {
  open: boolean
  onClose: () => void
  sessionId: string
  currentAgent?: string
}) {
  const agents = useStore((s) => s.agents)
  const switchEngine = useStore((s) => s.switchEngine)

  const readyAgents = agents.filter((a) => a.available)
  const [selectedAgent, setSelectedAgent] = React.useState<string>(currentAgent ?? '')
  const [selectedModel, setSelectedModel] = React.useState<string | undefined>()
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (!open) return
    setSelectedAgent(currentAgent ?? readyAgents[0]?.id ?? '')
    setSelectedModel(undefined)
    setError(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, currentAgent])

  const agent = agents.find((a) => a.id === selectedAgent)
  const models = React.useMemo(() => {
    if (!Array.isArray(agent?.models)) return [] as string[]
    return (agent!.models as Array<string | { id?: string }>)
      .map((model) => (typeof model === 'string' ? model : (model.id ?? '')))
      .filter(Boolean)
  }, [agent])

  const unchanged = selectedAgent === currentAgent && !selectedModel
  const canSubmit = Boolean(selectedAgent) && readyAgents.length > 0 && !unchanged

  async function submit() {
    if (!selectedAgent) return
    setBusy(true)
    setError(null)
    try {
      const ok = await switchEngine(sessionId, selectedAgent, selectedModel)
      if (ok) {
        toast({
          message: `Running on ${agent?.name ?? selectedAgent}`,
          detail: selectedModel ? `Model: ${selectedModel}` : undefined,
          tone: 'ok',
        })
        onClose()
      } else {
        setError('The desktop refused to switch that session.')
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Switch failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <FormSheet
      open={open}
      onClose={onClose}
      eyebrow="Session"
      title="Switch agent"
      submitLabel={busy ? 'Switching…' : 'Switch agent'}
      onSubmit={() => void submit()}
      busy={busy}
      error={error}
      disabled={!canSubmit}
    >
      <Notice
        tone="info"
        message="A digest of the previous turns is handed to the new agent so the conversation survives. That means a new process, a new cost, and a context that is a summary rather than the original."
      />

      <View style={{ gap: 7 }}>
        <Eyebrow>Agent</Eyebrow>
        {readyAgents.length === 0 ? (
          <Text className="text-[13.5px] leading-[19px] text-ink-3">
            No agent is ready on the desktop. Install a supported CLI there, then re-scan from the
            Agents tab.
          </Text>
        ) : (
          readyAgents.map((entry, index) => (
            <AgentRow
              key={entry.id}
              id={entry.id}
              name={entry.name}
              index={index}
              active={entry.id === selectedAgent}
              current={entry.id === currentAgent}
              onPress={() => {
                void haptic('select')
                setSelectedAgent(entry.id)
                setSelectedModel(undefined)
              }}
            />
          ))
        )}
      </View>

      {models.length > 0 ? (
        <View style={{ gap: 7, marginTop: 8 }}>
          <Eyebrow>Model — optional</Eyebrow>
          <View style={{ gap: 6 }}>
            <ModelRow
              label="Keep the current model"
              active={selectedModel === undefined}
              onPress={() => setSelectedModel(undefined)}
            />
            {models.map((model) => (
              <ModelRow
                key={model}
                label={model}
                mono
                active={selectedModel === model}
                onPress={() => setSelectedModel(model)}
              />
            ))}
          </View>
        </View>
      ) : null}
    </FormSheet>
  )
}

function AgentRow({
  id,
  name,
  index,
  active,
  current,
  onPress,
}: {
  id: string
  name: string
  index: number
  active: boolean
  current: boolean
  onPress: () => void
}) {
  const enter = useEnter(staggerDelay(index), false)
  return (
    <View style={rowEnterStyle(enter)}>
      <Pressable
        accessibilityRole="radio"
        accessibilityLabel={name}
        accessibilityHint={current ? 'This session is already running on this agent' : undefined}
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
          minHeight: 56,
        })}
      >
        <AgentAvatar agent={id} size={32} name={name} />
        <View style={{ flex: 1, minWidth: 0, gap: 1 }}>
          <Text className="text-[15px] leading-[20px] font-semibold text-ink" numberOfLines={1}>
            {name}
          </Text>
          <Mono className="text-[11px] leading-[15px]" numberOfLines={1}>
            {id}
          </Mono>
        </View>
        {current ? (
          <Badge tone={active ? 'accent' : 'muted'} mono>
            Current
          </Badge>
        ) : null}
        {active && !current ? <Check size={17} color={palette.accent} strokeWidth={2.6} /> : null}
      </Pressable>
    </View>
  )
}

function ModelRow({
  label,
  mono,
  active,
  onPress,
}: {
  label: string
  mono?: boolean
  active: boolean
  onPress: () => void
}) {
  return (
    <Pressable
      accessibilityRole="radio"
      accessibilityLabel={label}
      accessibilityState={{ selected: active }}
      onPress={() => {
        void haptic('select')
        onPress()
      }}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 10,
        borderRadius: radius.md,
        borderWidth: 1,
        borderColor: active ? palette.accentBorder : palette.line,
        backgroundColor: active
          ? palette.accentSoft
          : pressed
            ? palette.raised
            : palette.surface,
        paddingHorizontal: 12,
        paddingVertical: 10,
        minHeight: 46,
      })}
    >
      {/* Model ids are opaque — namespaced, mixed-case, and not English. The
          mono face is not decoration here: it is the typeface that makes
          `claude-opus-4-6` read as one identifier rather than three
          hyphenated words, which is the difference between picking the model
          you meant and picking a plausible-looking one. */}
      {mono ? (
        <Mono
          className="flex-1 text-[13px] leading-[18px]"
          style={{ color: active ? palette.ink : palette.ink2 }}
          numberOfLines={1}
        >
          {label}
        </Mono>
      ) : (
        <Text
          className="flex-1 text-[14px] leading-[19px]"
          style={{ color: active ? palette.ink : palette.ink2, fontWeight: active ? '600' : '400' }}
          numberOfLines={1}
        >
          {label}
        </Text>
      )}
      {active ? <Check size={16} color={palette.accent} strokeWidth={2.6} /> : null}
    </Pressable>
  )
}
