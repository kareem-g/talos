/**
 * NewTask — the one flow that starts work from the phone: Where (recent
 * projects, Inbox, or a typed path) then What & how (agent, optional first
 * prompt, model / thought / permissions) with each dimension opening its own
 * picker inside the same sheet.
 */

import * as React from 'react'
import { View } from 'react-native'
import { basename, cn } from '@/lib/format'
import { useStore } from '@/store'
import { usePathBrowser } from '@/lib/pathBrowser'
import type { Session } from '@/types/session'
import { Btn, Empty, Field, Label, Sheet, Tap, Text, haptic } from './ui'
import { Check, ChevronRight } from './design/icons'
import { agentHue, color } from './design/tokens'
import { MONO } from './design/fonts'
import { ArrowUp, Bot, Folder, Refresh } from './design/icons'

const MODES = [
  { value: 'ask', label: 'Ask before changes', hint: 'Pause for you before any file change.' },
  { value: 'auto_edit', label: 'Edit automatically', hint: 'Apply edits; still asks for commands.' },
  { value: 'plan', label: 'Plan mode', hint: 'Produce a plan first and wait for approval.' },
  { value: 'full', label: 'Full access', hint: 'Run with fewer confirmations.' },
]

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

type Step = 'where' | 'what' | { picker: 'model' | 'thought' | 'permission' }

export function NewTask({
  open,
  onClose,
  project,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  project?: string
  onCreated?: (session: Session) => void
}) {
  const agents = useStore((state) => state.agents)
  const sessions = useStore((state) => state.sessions)
  const createSession = useStore((state) => state.createSession)
  const setConfig = useStore((state) => state.setConfig)

  const [view, setView] = React.useState<Step>('where')
  const [workspace, setWorkspace] = React.useState('')
  const [customPath, setCustomPath] = React.useState('')
  const [showCustom, setShowCustom] = React.useState(false)
  const browser = usePathBrowser()
  const [agentId, setAgentId] = React.useState<string | undefined>()
  const [prompt, setPrompt] = React.useState('')
  const [model, setModel] = React.useState<string | undefined>()
  const [thought, setThought] = React.useState<string | undefined>()
  const [permission, setPermission] = React.useState('ask')
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)

  const ready = agents.filter((agent) => agent.available)
  const selected = ready.find((agent) => agent.id === agentId)

  const recent = React.useMemo(() => {
    const counts = new Map<string, number>()
    for (const session of sessions) {
      if (session.project) counts.set(session.project, (counts.get(session.project) ?? 0) + 1)
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8)
  }, [sessions])

  React.useEffect(() => {
    if (!open) return
    setView('where')
    setError(null)
    setPrompt('')
    setCustomPath('')
    setShowCustom(false)
    browser.reset()
    setModel(undefined)
    setThought(undefined)
    setPermission('ask')
    setWorkspace(project ?? '')
    if (ready.length > 0) setAgentId((current) => current ?? ready[0].id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, project])

  const effectiveProject = customPath.trim() || workspace
  const modelChoices = choicesOf(selected?.models)
  const thoughtChoices = choicesOf(selected?.reasoningLevels)
  const picking = typeof view === 'object' ? view.picker : null

  function pick(value: string) {
    if (picking === 'model') setModel(value)
    else if (picking === 'thought') setThought(value)
    else setPermission(value)
    void haptic('select')
    setView('what')
  }

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
      if (permission !== 'ask') setConfig(session.id, 'permission_mode', permission)
      onCreated?.(session)
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not start that session')
    } finally {
      setBusy(false)
    }
  }

  const title = picking
    ? picking === 'model'
      ? 'Model'
      : picking === 'thought'
        ? 'Thought level'
        : 'Permissions'
    : view === 'where'
      ? 'New Session'
      : `New Session — ${effectiveProject ? basename(effectiveProject) : 'Inbox'}`

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={title}
      edge="bottom"
      back={
        picking
          ? { label: 'Back to configuration', onPress: () => setView('what') }
          : view !== 'where'
            ? { label: 'Back to workspace', onPress: () => setView('where') }
            : undefined
      }
      foot={
        showCustom && browser.open ? (
          <>
            <Btn
              kind="primary"
              size="lg"
              label="Use this folder"
              wide
              disabled={!browser.path || !!browser.error}
              onPress={() => {
                setCustomPath(browser.path)
                setWorkspace('')
                setShowCustom(false)
              }}
            />
            <Btn kind="plate" size="md" label="Cancel" wide onPress={() => setShowCustom(false)} />
          </>
        ) : view === 'where' ? (
          <Btn kind="primary" size="lg" label="Next — Choose Agent" wide onPress={() => setView('what')} />
        ) : view === 'what' ? (
          <Btn kind="primary" size="lg" label={busy ? 'Starting…' : 'Start Session'} wide disabled={busy || !selected} onPress={() => void create()} />
        ) : null
      }
    >
      {view === 'where' ? (
        <View>
          <Label>Workspace</Label>
          {recent.map(([path, count]) => (
            <TaskRow
              key={path}
              selected={path === workspace && !customPath.trim()}
              trail={<Text className="shrink-0 text-[12px] text-ink-3" style={{ fontFamily: MONO, fontVariant: ['tabular-nums'] }}>{count} {count === 1 ? 'session' : 'sessions'}</Text>}
              onSelect={() => {
                setWorkspace(path)
                setCustomPath('')
                setShowCustom(false)
              }}
            >
              <View className="size-[30px] shrink-0 items-center justify-center rounded-lg bg-field">
                <Folder size={15} color={color.ink2} />
              </View>
              <View className="min-w-0 flex-1">
                <Text className="text-[15px] text-ink" numberOfLines={1}>
                  {basename(path)}
                </Text>
                <Text className="mt-0.5 text-[10.5px] text-ink-3" style={{ fontFamily: MONO }} numberOfLines={1}>
                  {path}
                </Text>
              </View>
            </TaskRow>
          ))}
          <TaskRow
            selected={!effectiveProject}
            onSelect={() => {
              setWorkspace('')
              setCustomPath('')
              setShowCustom(false)
            }}
          >
            <View className="size-[30px] shrink-0 items-center justify-center rounded-lg bg-field">
              <Bot size={18} color={color.ink3} />
            </View>
            <View className="min-w-0 flex-1">
              <Text className="text-[15px] text-ink" numberOfLines={1}>
                Inbox
              </Text>
              <Text className="mt-0.5 text-[12px] text-ink-2" numberOfLines={1}>
                No folder — runs in the daemon's working directory
              </Text>
            </View>
          </TaskRow>
          {showCustom ? (
            <FolderBrowser
              browser={browser}
              onUse={(path) => {
                setCustomPath(path)
                setWorkspace('')
                setShowCustom(false)
              }}
            />
          ) : (
            <TaskRow onSelect={() => {
              setShowCustom(true)
              browser.go()
            }}>
              <View className="min-w-0 flex-1">
                <Text className="text-[15px] font-medium text-accent">Use another path…</Text>
                <Text className="mt-0.5 text-[12px] text-ink-2" numberOfLines={1}>
                  Browse the desktop's folders
                </Text>
              </View>
            </TaskRow>
          )}
        </View>
      ) : picking ? (
        <View className="pb-2">
          {(picking === 'model'
            ? modelChoices
            : picking === 'thought'
              ? thoughtChoices
              : MODES.map((mode) => ({ value: mode.value, label: mode.label, hint: mode.hint }))
          ).map((option) => {
            const current = picking === 'model' ? model : picking === 'thought' ? thought : permission
            return (
              <Tap
                key={option.value}
                accessibilityRole="button"
                accessibilityLabel={option.label}
                accessibilityState={{ selected: option.value === current }}
                onPress={() => pick(option.value)}
                className={cn(
                  'min-h-[54px] w-full flex-row items-start gap-3 px-4 py-3',
                  option.value === current && 'bg-accent-tint',
                )}
              >
                <View className="min-w-0 flex-1" style={{ marginTop: 2 }}>
                  <Text
                    className={cn('text-ink', picking !== 'permission' ? 'text-[13.5px]' : 'text-[15px]')}
                    style={picking !== 'permission' ? { fontFamily: MONO } : undefined}
                    numberOfLines={1}
                  >
                    {option.label}
                  </Text>
                  {'hint' in option ? (
                    <Text className="mt-1 text-[12px] leading-[16px] text-ink-2">{(option as { hint?: string }).hint}</Text>
                  ) : null}
                </View>
                {option.value === current ? <Check size={15} color={color.accent} stroke={2.4} /> : null}
              </Tap>
            )
          })}
          {picking !== 'permission' && (picking === 'model' ? modelChoices : thoughtChoices).length === 0 ? (
            <View className="pt-4">
              <Label>No list reported?</Label>
              <View className="px-4">
                <Field
                  placeholder="Any model id this agent accepts"
                  accessibilityLabel="Custom value"
                  autoCapitalize="none"
                  mono
                  onSubmitEditing={(event) => {
                    const value = event.nativeEvent.text.trim()
                    if (value) pick(value)
                  }}
                />
              </View>
              <Text className="ml-5 mr-4 mt-2 text-[11.5px] leading-[17px] text-ink-3">
                This agent reported no list — type any id it accepts and it is sent verbatim.
              </Text>
            </View>
          ) : null}
        </View>
      ) : (
        <View className="pb-2">
          <Label>Agent</Label>
          {ready.length === 0 ? (
            <Empty title="No agent is ready" note="Install a supported CLI on the desktop, then re-scan from Agents." />
          ) : (
            ready.map((agent) => (
              <TaskRow
                key={agent.id}
                selected={agent.id === agentId}
                onSelect={() => {
                  setAgentId(agent.id)
                  setModel(undefined)
                  setThought(undefined)
                }}
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
              </TaskRow>
            ))
          )}

          <Label>First prompt</Label>
          <View className="px-4">
            <Field
              value={prompt}
              onChangeText={setPrompt}
              placeholder="What should it do?"
              accessibilityLabel="First prompt for the agent"
              multiline
              className="min-h-[88px] items-start py-3"
              style={{ textAlignVertical: 'top' }}
            />
            <Text className="ml-0.5 mt-2 text-[11.5px] leading-[17px] text-ink-3">Optional — the first line becomes the session name.</Text>
          </View>

          <Label>Configuration</Label>
          <ConfigRow label="Model" value={model ?? 'Default'} onPress={() => setView({ picker: 'model' })} />
          <ConfigRow label="Thought level" value={thought ?? 'Default'} onPress={() => setView({ picker: 'thought' })} />
          <ConfigRow
            label="Permissions"
            value={MODES.find((mode) => mode.value === permission)?.label ?? 'Ask before changes'}
            onPress={() => setView({ picker: 'permission' })}
          />

          {error ? <Text className="px-4 pt-1.5 text-[13px] text-red">{error}</Text> : null}
          <Text className="px-4 pt-2 text-[12px] leading-[18px] text-ink-3" style={{ fontFamily: MONO }}>
            {effectiveProject ? effectiveProject : 'Inbox — no folder'}
          </Text>
        </View>
      )}
    </Sheet>
  )
}

/** One selectable row in the wizard — rounded, tinted when selected. */
function TaskRow({
  children,
  selected,
  trail,
  onSelect,
}: {
  children: React.ReactNode
  selected?: boolean
  trail?: React.ReactNode
  onSelect: () => void
}) {
  return (
    <Tap
      accessibilityRole="button"
      accessibilityState={{ selected: !!selected }}
      onPress={() => {
        void haptic('select')
        onSelect()
      }}
      className={cn(
        'min-h-[56px] w-full flex-row items-center gap-3 px-4',
        selected && 'bg-accent-tint',
      )}
    >
      {children}
      {trail}
      {selected ? <Check size={15} color={color.accent} stroke={2.4} /> : null}
    </Tap>
  )
}

/** One configuration row — label, current value, chevron into the picker. */
function ConfigRow({ label, value, onPress }: { label: string; value: string; onPress: () => void }) {
  return (
    <Tap
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={() => {
        void haptic('light')
        onPress()
      }}
      className="min-h-[56px] w-full flex-row items-center gap-3 px-4"
    >
      <Text className="min-w-0 flex-1 text-[15px] text-ink" numberOfLines={1}>
        {label}
      </Text>
      <Text className="shrink-0 text-[13px] text-ink-2" numberOfLines={1}>
        {value}
      </Text>
      <ChevronRight size={15} color={color.ink3} />
    </Tap>
  )
}
/**
 * FolderBrowser — the desktop's directories, one level at a time.
 *
 * Picking a project folder is a recognition task, not a recall one: nobody
 * knows `~/Documents/agentdeck-linux` by heart, they know it is called
 * agentdeck-linux and it lives under Documents. So the row offers a walk
 * instead of a text field — the current path, one row per folder, an "up" rung
 * to climb, and the shortcuts the daemon calls out (`~/Documents`, `~/code`).
 *
 * A typed path stays available underneath, because the daemon accepts any path
 * the user can name; browsing is the fast route, not the only one.
 */
function FolderBrowser({
  browser,
  onUse,
}: {
  browser: ReturnType<typeof usePathBrowser>
  onUse: (path: string) => void
}) {
  const [typed, setTyped] = React.useState('')

  if (!browser.open) return null

  return (
    <View className="px-4 pb-3 pt-1">
      {/* Where we are, and the two ways out of it */}
      <View className="flex-row items-center gap-2 rounded-control bg-option px-3 py-2.5">
        <Folder size={15} color={color.ink3} />
        <Text className="min-w-0 flex-1 text-[11.5px] text-ink-2" style={{ fontFamily: MONO }} numberOfLines={1}>
          {browser.path || browser.error || 'Reading the desktop…'}
        </Text>
        {browser.canGoBack ? (
          <Tap
            accessibilityRole="button"
            accessibilityLabel="Back to the previous folder"
            onPress={browser.back}
            hitSlop={8}
            className="shrink-0 px-1"
          >
            <Text className="text-[11.5px] font-semibold text-accent">Back</Text>
          </Tap>
        ) : null}
        <Tap
          accessibilityRole="button"
          accessibilityLabel="Reload this folder"
          onPress={() => browser.go(browser.path || undefined)}
          hitSlop={8}
          className="shrink-0 px-1"
        >
          <Refresh size={13} color={color.ink3} />
        </Tap>
      </View>

      {browser.loading ? (
        <Text className="py-3 text-[12px] text-ink-3">Reading the desktop…</Text>
      ) : browser.error ? (
        <Text className="py-3 text-[12.5px] leading-[18px] text-red">{browser.error}</Text>
      ) : (
        <View className="pt-1">
          {browser.parent ? (
            <Tap
              accessibilityRole="button"
              accessibilityLabel="Up one folder"
              onPress={browser.up}
              className="min-h-[52px] w-full flex-row items-center gap-3 py-2"
            >
              <View className="size-[30px] shrink-0 items-center justify-center rounded-lg bg-field">
                <ArrowUp size={15} color={color.ink2} />
              </View>
              <Text className="min-w-0 flex-1 text-[15px] text-ink">Up one folder</Text>
              <Text className="shrink-0 text-[11px] text-ink-3" style={{ fontFamily: MONO }} numberOfLines={1}>
                {browser.parent}
              </Text>
            </Tap>
          ) : null}

          {browser.roots.length > 0
            ? browser.roots.map((root) => (
                <Tap
                  key={root.path}
                  accessibilityRole="button"
                  accessibilityLabel={root.name}
                  onPress={() => browser.go(root.path)}
                  className="min-h-[52px] w-full flex-row items-center gap-3 py-2"
                >
                  <View className="size-[30px] shrink-0 items-center justify-center rounded-lg bg-accent-tint">
                    <Folder size={15} color={color.accent} />
                  </View>
                  <Text className="min-w-0 flex-1 text-[15px] text-ink" numberOfLines={1}>
                    {root.name}
                  </Text>
                  <ChevronRight size={14} color={color.ink3} />
                </Tap>
              ))
            : null}

          {browser.entries.map((entry) => (
            <Tap
              key={entry.path}
              accessibilityRole="button"
              accessibilityLabel={entry.name}
              onPress={() => browser.go(entry.path)}
              className="min-h-[52px] w-full flex-row items-center gap-3 py-2"
            >
              <View className="size-[30px] shrink-0 items-center justify-center rounded-lg bg-field">
                <Folder size={15} color={color.ink2} />
              </View>
              <Text className="min-w-0 flex-1 text-[15px] text-ink" numberOfLines={1}>
                {entry.name}
              </Text>
              <ChevronRight size={14} color={color.ink3} />
            </Tap>
          ))}

          {browser.entries.length === 0 && browser.roots.length === 0 ? (
            <Text className="py-3 text-[12.5px] leading-[18px] text-ink-3">
              No folders here — this one only holds files, or the daemon cannot read it.
            </Text>
          ) : null}
        </View>
      )}

      <View className="mt-3">
        <Label>Or type a path</Label>
        <Field
          value={typed}
          onChangeText={setTyped}
          onSubmitEditing={() => {
            const value = typed.trim()
            if (value) onUse(value)
          }}
          placeholder="/home/you/project"
          accessibilityLabel="Project path on the desktop"
          autoCapitalize="none"
          autoCorrect={false}
          mono
        />
        <Text className="mt-1.5 text-[11.5px] text-ink-3">The path is resolved on the desktop, not on this phone.</Text>
      </View>
    </View>
  )
}
