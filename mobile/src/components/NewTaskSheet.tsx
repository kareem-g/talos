/**
 * New task — the desktop's `NewSessionLayer`, as a native sheet.
 *
 * Two steps, same as the desktop: pick the workspace, then pick the agent and
 * configure the run. Step 2 is where the configuration lives — model, thought
 * level and permission mode — because "start a chat in one tap" is not what the
 * desktop offers, and a phone that skips it can only ever start a default run.
 *
 * `model` and `thought` are accepted at creation and applied before the first
 * prompt; every other dimension is set over the socket once the session exists,
 * which is exactly the order the desktop uses.
 */

import * as React from 'react'
import { Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native'
import { ChevronLeft, ChevronRight, Folder, Inbox, X } from 'lucide-react-native'

import { basename, cn } from '@/lib/format'
import { useStore } from '@app/store'
import type { Session } from '@/types/session'
import { Button, Chip, Mono, SectionLabel } from '@app/components/ui'
import { GlassSurface } from '@app/components/Glass'
import { palette } from '@app/design/tokens'

/** The desktop's four permission modes, same ids and labels. */
const PERMISSION_MODES = [
  { value: 'ask', label: 'Ask before changes' },
  { value: 'auto_edit', label: 'Edit automatically' },
  { value: 'plan', label: 'Plan mode' },
  { value: 'full', label: 'Full access' },
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
  /** Pre-select an agent — set by the home screen's quick launch. */
  initialAgent?: string
}) {
  const agents = useStore((state) => state.agents)
  const sessions = useStore((state) => state.sessions)
  const createSession = useStore((state) => state.createSession)
  const setConfig = useStore((state) => state.setConfig)

  const [step, setStep] = React.useState<1 | 2>(1)
  const [project, setProject] = React.useState('')
  const [customPath, setCustomPath] = React.useState('')
  const [agentId, setAgentId] = React.useState<string | undefined>()
  const [prompt, setPrompt] = React.useState('')
  const [model, setModel] = React.useState<string | undefined>()
  const [thought, setThought] = React.useState<string | undefined>()
  const [permission, setPermission] = React.useState<string>('ask')
  const [picker, setPicker] = React.useState<'model' | 'thought' | 'permission' | null>(null)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const ready = agents.filter((agent) => agent.available)
  const selected = ready.find((agent) => agent.id === agentId)

  /** Workspaces ordered by how often they have been used, as the desktop does. */
  const recent = React.useMemo(() => {
    const counts = new Map<string, number>()
    for (const session of sessions) {
      if (session.project) counts.set(session.project, (counts.get(session.project) ?? 0) + 1)
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6).map(([path]) => path)
  }, [sessions])

  // Reset when the sheet opens. Deliberately keyed on `open` alone: `recent`
  // changes on every socket frame, and depending on it would wipe a prompt the
  // user is halfway through typing.
  const recentRef = React.useRef(recent)
  recentRef.current = recent
  React.useEffect(() => {
    if (!open) return
    setStep(1)
    setError(null)
    setPrompt('')
    setCustomPath('')
    setModel(undefined)
    setThought(undefined)
    setPermission('ask')
    setProject(initialProject ?? recentRef.current[0] ?? '')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialProject])

  // Quick launch wins over a stale choice; otherwise default to the first ready
  // agent so step 2 is immediately usable.
  React.useEffect(() => {
    if (open && initialAgent) {
      setAgentId(initialAgent)
      setStep(2)
      return
    }
    if (agentId || ready.length === 0) return
    setAgentId(ready[0].id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, initialAgent, agentId, ready])

  const effectiveProject = customPath.trim() || project

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
      setError(cause instanceof Error ? cause.message : 'Could not start the session')
    } finally {
      setBusy(false)
    }
  }

  const modelChoices = choicesOf(selected?.models)
  const thoughtChoices = choicesOf(selected?.reasoningLevels)

  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <View className="flex-1 justify-end bg-black/65">
        <View className="max-h-[88%] overflow-hidden rounded-t-2xl border-t border-line bg-canvas">
          {/* Glass header: back/step, title, close */}
          <GlassSurface radius={0} className="border-b border-line">
            <View className="flex-row items-center gap-2 px-3 pt-14 pb-3">
              {step === 2 ? (
                <Pressable
                  onPress={() => setStep(1)}
                  accessibilityLabel="Back"
                  className="size-9 items-center justify-center rounded-full active:bg-hover-2"
                >
                  <ChevronLeft size={18} color={palette.ink} />
                </Pressable>
              ) : (
                <View className="size-9" />
              )}
              <View className="min-w-0 flex-1">
                <Text className="text-[15px] font-semibold text-ink" numberOfLines={1}>
                  {step === 1 ? 'New task' : `Start in ${effectiveProject ? basename(effectiveProject) : 'Inbox'}`}
                </Text>
                <Mono className="text-[10px] uppercase tracking-wider">
                  Step {step} of 2 · {step === 1 ? 'workspace' : 'agent & config'}
                </Mono>
              </View>
              <Pressable
                onPress={onClose}
                accessibilityLabel="Close"
                className="size-9 items-center justify-center rounded-full active:bg-hover-2"
              >
                <X size={17} color={palette.ink2} />
              </Pressable>
            </View>
          </GlassSurface>

          {step === 1 ? (
            <ScrollView contentContainerClassName="gap-1 p-2 pb-6">
              <SectionLabel>Recent workspaces</SectionLabel>
              {recent.length === 0 ? (
                <Text className="px-2.5 py-2 text-[12px] text-ink-3">
                  No workspaces yet. Start in the Inbox, or type a path on the desktop.
                </Text>
              ) : (
                recent.map((path) => (
                  <Pressable
                    key={path}
                    onPress={() => {
                      setProject(path)
                      setCustomPath('')
                    }}
                    className={cn(
                      'min-h-12 flex-row items-center gap-2.5 rounded-xl px-2.5',
                      project === path && !customPath ? 'bg-accent-tint' : 'active:bg-hover-2',
                    )}
                  >
                    <Folder size={15} color={palette.ink3} />
                    <View className="min-w-0 flex-1">
                      <Text className="text-[13px] text-ink" numberOfLines={1}>
                        {basename(path)}
                      </Text>
                      <Mono className="text-[10.5px]" numberOfLines={1}>
                        {path}
                      </Mono>
                    </View>
                    {project === path && !customPath ? <ChevronRight size={15} color={palette.accent} /> : null}
                  </Pressable>
                ))
              )}

              <SectionLabel>Or no workspace</SectionLabel>
              <Pressable
                onPress={() => {
                  setProject('')
                  setCustomPath('')
                }}
                className={cn(
                  'min-h-12 flex-row items-center gap-2.5 rounded-xl px-2.5',
                  !effectiveProject ? 'bg-accent-tint' : 'active:bg-hover-2',
                )}
              >
                <Inbox size={15} color={palette.ink3} />
                <Text className="flex-1 text-[13px] text-ink">Inbox</Text>
              </Pressable>

              <SectionLabel>Other path on the desktop</SectionLabel>
              <TextInput
                value={customPath}
                onChangeText={setCustomPath}
                placeholder="/home/you/project"
                placeholderTextColor={palette.ink3}
                autoCapitalize="none"
                autoCorrect={false}
                className="min-h-11 rounded-xl border border-line bg-field px-3 text-[12.5px] text-ink"
              />

              <View className="px-2.5 pt-3">
                <Button variant="primary" label="Next — pick an agent" onPress={() => setStep(2)} />
              </View>
            </ScrollView>
          ) : (
            <ScrollView contentContainerClassName="gap-3 p-3 pb-6" keyboardShouldPersistTaps="handled">
              <View>
                <SectionLabel className="px-0">Agent</SectionLabel>
                <View className="flex-row flex-wrap gap-1.5">
                  {ready.map((agent) => {
                    const active = agent.id === agentId
                    return (
                      <Pressable
                        key={agent.id}
                        onPress={() => {
                          setAgentId(agent.id)
                          setModel(undefined)
                          setThought(undefined)
                        }}
                        className={cn(
                          'min-h-11 flex-row items-center gap-2 rounded-xl border px-3',
                          active ? 'border-accent bg-accent-tint' : 'border-line bg-surface',
                        )}
                      >
                        <View className={cn('size-1.5 rounded-full', active ? 'bg-accent' : 'bg-green')} />
                        <Text className={cn('text-[12.5px]', active ? 'text-ink' : 'text-ink-2')}>{agent.name}</Text>
                      </Pressable>
                    )
                  })}
                  {ready.length === 0 ? (
                    <Text className="text-[12px] text-ink-3">
                      No agent is ready on the desktop. Install a supported CLI there first.
                    </Text>
                  ) : null}
                </View>
              </View>

              <View>
                <SectionLabel className="px-0">First prompt</SectionLabel>
                <TextInput
                  value={prompt}
                  onChangeText={setPrompt}
                  placeholder="What should it do?"
                  placeholderTextColor={palette.ink3}
                  multiline
                  className="min-h-[92px] rounded-xl border border-line bg-field px-3 py-2.5 text-[13px] leading-5 text-ink"
                />
              </View>

              <View>
                <SectionLabel className="px-0">Configuration</SectionLabel>
                <View className="gap-1.5">
                  <ConfigRow
                    label="Model"
                    value={model ?? 'Default'}
                    disabled={modelChoices.length === 0}
                    onPress={() => setPicker('model')}
                  />
                  <ConfigRow
                    label="Thought level"
                    value={thought ?? 'Default'}
                    disabled={thoughtChoices.length === 0}
                    onPress={() => setPicker('thought')}
                  />
                  <ConfigRow
                    label="Permissions"
                    value={PERMISSION_MODES.find((mode) => mode.value === permission)?.label ?? 'Ask'}
                    onPress={() => setPicker('permission')}
                  />
                </View>
              </View>

              {error ? <Text className="text-[11.5px] leading-5 text-red">{error}</Text> : null}

              <Button
                variant="primary"
                label={busy ? 'Starting…' : 'Start session'}
                disabled={busy || !selected}
                onPress={() => void create()}
              />
            </ScrollView>
          )}
        </View>
      </View>

      <ChoiceOverlay
        title={picker === 'model' ? 'Model' : picker === 'thought' ? 'Thought level' : 'Permissions'}
        choices={
          picker === 'model'
            ? modelChoices
            : picker === 'thought'
              ? thoughtChoices
              : PERMISSION_MODES
        }
        selected={picker === 'model' ? model : picker === 'thought' ? thought : permission}
        onClose={() => setPicker(null)}
        onChoose={(value) => {
          if (picker === 'model') setModel(value)
          else if (picker === 'thought') setThought(value)
          else setPermission(value)
          setPicker(null)
        }}
      />
    </Modal>
  )
}

function ConfigRow({
  label,
  value,
  onPress,
  disabled,
}: {
  label: string
  value: string
  onPress: () => void
  disabled?: boolean
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      className={cn(
        'min-h-12 flex-row items-center gap-2 rounded-xl border border-line bg-surface px-3',
        disabled && 'opacity-45',
      )}
    >
      <Text className="text-[12.5px] text-ink-2">{label}</Text>
      <View className="flex-1" />
      <Text className="max-w-[55%] text-[12.5px] text-ink" numberOfLines={1}>
        {value}
      </Text>
      <ChevronRight size={14} color={palette.ink3} />
    </Pressable>
  )
}

/**
 * Choice picker, rendered inside the sheet rather than as a second Modal — iOS
 * does not present a modal on top of a modal, so this is an overlay in the same
 * window.
 */
function ChoiceOverlay({
  title,
  choices,
  selected,
  onClose,
  onChoose,
}: {
  title: string
  choices: Array<{ value: string; label: string }>
  selected?: string
  onClose: () => void
  onChoose: (value: string) => void
}) {
  if (choices.length === 0) return null
  return (
    <View className="absolute inset-0 z-30 items-center justify-center bg-black/70 p-6">
      <Pressable className="absolute inset-0" onPress={onClose} accessibilityLabel="Close" />
      <View className="w-full max-w-sm overflow-hidden rounded-2xl border border-line bg-surface">
        <GlassSurface radius={0} className="border-b border-line">
          <View className="flex-row items-center justify-between px-3.5 py-3">
            <Text className="text-[13px] font-medium text-ink">{title}</Text>
            <View className="flex-row items-center gap-2">
              <Chip label={`${choices.length}`} />
              <Pressable onPress={onClose} accessibilityLabel="Close" className="size-7 items-center justify-center rounded-full active:bg-hover-2">
                <X size={15} color={palette.ink2} />
              </Pressable>
            </View>
          </View>
        </GlassSurface>
        <ScrollView contentContainerClassName="p-1.5" style={{ maxHeight: 340 }}>
          {choices.map((choice) => {
            const active = choice.value === selected
            return (
              <Pressable
                key={choice.value}
                onPress={() => onChoose(choice.value)}
                className={cn('min-h-11 flex-row items-center gap-2 rounded-control px-2.5', active && 'bg-hover')}
              >
                <Text className="min-w-0 flex-1 text-[12.5px] text-ink" numberOfLines={1}>
                  {choice.label}
                </Text>
                {active ? <View className="size-1.5 rounded-full bg-green" /> : null}
              </Pressable>
            )
          })}
        </ScrollView>
      </View>
    </View>
  )
}
