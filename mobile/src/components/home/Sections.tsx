/**
 * Home sections — Automations and Skills, matching the desktop home composition
 * (sessions → pair → automations → skills → settings).
 *
 * Two honest differences from the desktop, both inherent to porting them:
 *
 *   - **Automations are per-device.** On the desktop the list lives in
 *     `localStorage`; here the same template catalog and the same shape live in
 *     MMKV. Neither side has a scheduler — on both, "run now" spawns a session —
 *     and the two lists do not sync, because nothing on the daemon stores them.
 *   - **Skills are shared**, because they are real: the daemon owns
 *     `.agentdeck/skills/` per project, so toggling one here changes what the
 *     desktop sees.
 */

import * as React from 'react'
import { Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native'
import { Eye, Play, Plus, Trash2, X, Zap } from 'lucide-react-native'

import { basename, cn } from '@/lib/format'
import { skillsApi } from '@app/lib/api'
import { storage } from '@app/lib/storage'
import { useStore } from '@app/store'
import { Button, Card, CardHeader, Chip, Mono } from '@app/components/ui'

/* ── Automations ─────────────────────────────────────────────────────────── */

type AutomationKind = 'scheduled' | 'idle'

interface Automation {
  id: string
  name: string
  prompt: string
  cadence: string
  kind: AutomationKind
  enabled: boolean
  lastRun?: string
}

/** Same storage key semantics as the desktop, so the shape stays identical. */
const STORAGE_KEY = 'agentdeck-automations'
const KEEP_AWAKE_KEY = 'agentdeck-keep-awake'

const IDLE_TEMPLATES: Array<Omit<Automation, 'id' | 'enabled'>> = [
  {
    name: 'Standup Git Summary',
    prompt: 'Summarize commits, module changes, and follow-ups from this week.',
    cadence: 'Soonest available',
    kind: 'idle',
  },
  {
    name: 'CI Failures & Flaky Test Report',
    prompt: 'Review recent CI failures, flaky tests, and likely causes.',
    cadence: 'Soonest available',
    kind: 'idle',
  },
  {
    name: 'Documentation sync check',
    prompt:
      'Check whether README files, docs, configuration guidance, and usage examples match the current code.',
    cadence: 'Soonest available',
    kind: 'idle',
  },
]

const SCHEDULED_TEMPLATES: Array<Omit<Automation, 'id' | 'enabled'>> = [
  {
    name: 'Morning dev brief',
    prompt: 'Summarize commits, module changes, and follow-ups since the previous workday.',
    cadence: 'Weekdays at 09:00',
    kind: 'scheduled',
  },
  {
    name: 'Risk scan',
    prompt: 'Inspect changes from the last 24 hours and report high-confidence risks with direct evidence.',
    cadence: 'Daily at 10:00',
    kind: 'scheduled',
  },
  {
    name: 'Release brief',
    prompt: "Turn this week's merged changes into team-facing and user-facing release notes.",
    cadence: 'Fridays at 16:00',
    kind: 'scheduled',
  },
]

export function AutomationsSection() {
  const agents = useStore((state) => state.agents)
  const sessions = useStore((state) => state.sessions)
  const createSession = useStore((state) => state.createSession)
  const [automations, setAutomations] = React.useState<Automation[]>(
    () => storage.getJSON<Automation[]>(STORAGE_KEY) ?? [],
  )
  const [keepAwake, setKeepAwake] = React.useState(() => storage.getString(KEEP_AWAKE_KEY) === '1')
  const [picker, setPicker] = React.useState<AutomationKind | null>(null)
  const [notice, setNotice] = React.useState<string | null>(null)

  React.useEffect(() => {
    storage.setJSON(STORAGE_KEY, automations)
  }, [automations])
  React.useEffect(() => {
    storage.set(KEEP_AWAKE_KEY, keepAwake ? '1' : '0')
  }, [keepAwake])

  function addTemplate(template: Omit<Automation, 'id' | 'enabled'>) {
    setAutomations((current) => [
      ...current.filter((automation) => automation.name !== template.name),
      { ...template, id: `automation-${Date.now()}`, enabled: true },
    ])
    setPicker(null)
    setNotice(`${template.name} added`)
  }

  function toggle(id: string) {
    setAutomations((current) =>
      current.map((automation) =>
        automation.id === id ? { ...automation, enabled: !automation.enabled } : automation,
      ),
    )
  }

  function remove(id: string) {
    setAutomations((current) => current.filter((automation) => automation.id !== id))
  }

  /** Run now spawns a session carrying the automation's prompt — same as desktop. */
  async function runNow(automation: Automation) {
    const ready = agents.find((agent) => agent.available)
    if (!ready) {
      setNotice('No agent is ready on the desktop.')
      return
    }
    const project = sessions.find((session) => session.project)?.project ?? undefined
    const session = await createSession({
      agent: ready.id,
      project,
      prompt: automation.prompt,
      name: automation.name,
    })
    setAutomations((current) =>
      current.map((entry) =>
        entry.id === automation.id ? { ...entry, lastRun: new Date().toISOString() } : entry,
      ),
    )
    setNotice(session ? `Started “${automation.name}”` : 'Could not start that automation')
  }

  return (
    <Card>
      <CardHeader
        title="Automations"
        right={<Chip tone={automations.length ? 'accent' : 'dim'} label={`${automations.length}`} />}
      />
      <View className="gap-3 p-3.5">
        <Text className="text-[11.5px] leading-5 text-ink-2">
          Templates you can start on demand. Nothing is scheduled by the daemon: “Run” spawns a real
          session with the prompt, on the desktop as well as here.
        </Text>

        {automations.length === 0 ? (
          <Text className="text-[11.5px] text-ink-3">No automations yet.</Text>
        ) : (
          automations.map((automation) => (
            <View
              key={automation.id}
              className="flex-row items-center gap-2 rounded-lg border border-line bg-inset px-2.5 py-2"
            >
              <Zap size={13} color={automation.enabled ? '#db6d28' : '#7e7e86'} />
              <View className="min-w-0 flex-1">
                <Text className="text-[12.5px] text-ink" numberOfLines={1}>
                  {automation.name}
                </Text>
                <Mono className="mt-0.5 text-[10px]" numberOfLines={1}>
                  {automation.kind === 'idle' ? 'idle · ' : ''}
                  {automation.cadence}
                </Mono>
              </View>
              <Pressable
                onPress={() => toggle(automation.id)}
                accessibilityRole="switch"
                accessibilityState={{ checked: automation.enabled }}
                className={cn(
                  'size-7 items-center justify-center rounded-lg',
                  automation.enabled ? 'bg-green-tint' : 'bg-surface',
                )}
              >
                <View className={cn('size-2 rounded-full', automation.enabled ? 'bg-green' : 'bg-ink-3')} />
              </Pressable>
              <Pressable
                onPress={() => void runNow(automation)}
                accessibilityLabel={`Run ${automation.name}`}
                className="size-7 items-center justify-center rounded-lg active:bg-hover-2"
              >
                <Play size={13} color="#b0b0b6" />
              </Pressable>
              <Pressable
                onPress={() => remove(automation.id)}
                accessibilityLabel={`Delete ${automation.name}`}
                className="size-7 items-center justify-center rounded-lg active:bg-red-tint"
              >
                <Trash2 size={13} color="#7e7e86" />
              </Pressable>
            </View>
          ))
        )}

        <View className="flex-row items-center gap-2">
          <Button variant="surface" label="Add scheduled" className="min-h-9 px-3" onPress={() => setPicker('scheduled')} />
          <Button variant="surface" label="Add idle-time" className="min-h-9 px-3" onPress={() => setPicker('idle')} />
        </View>

        <Pressable
          onPress={() => setKeepAwake((value) => !value)}
          accessibilityRole="switch"
          accessibilityState={{ checked: keepAwake }}
          className="flex-row items-center gap-2"
        >
          <View className={cn('size-3.5 rounded border', keepAwake ? 'border-accent bg-accent' : 'border-line-strong')} />
          <Text className="text-[11.5px] text-ink-2">Keep the machine awake while agents run</Text>
        </Pressable>

        {notice ? <Text className="text-[11px] text-accent">{notice}</Text> : null}
      </View>

      <Modal visible={picker !== null} transparent animationType="slide" onRequestClose={() => setPicker(null)}>
        <Pressable className="flex-1 justify-end bg-black/65" onPress={() => setPicker(null)}>
          <Pressable className="rounded-t-2xl border border-line bg-surface" onPress={() => {}}>
            <View className="flex-row items-center justify-between border-b border-line px-3.5 py-2.5">
              <Text className="text-[13px] font-medium text-ink">
                {picker === 'idle' ? 'Idle-time templates' : 'Scheduled templates'}
              </Text>
              <Pressable onPress={() => setPicker(null)} accessibilityLabel="Close" className="size-9 items-center justify-center rounded-full">
                <X size={16} color="#b0b0b6" />
              </Pressable>
            </View>
            <ScrollView contentContainerClassName="p-2">
              {(picker === 'idle' ? IDLE_TEMPLATES : SCHEDULED_TEMPLATES).map((template) => (
                <Pressable
                  key={template.name}
                  onPress={() => addTemplate(template)}
                  className="min-h-11 flex-row items-center gap-2 rounded-control px-2.5 active:bg-hover-2"
                >
                  <Plus size={14} color="#7e7e86" />
                  <View className="min-w-0 flex-1">
                    <Text className="text-[12.5px] text-ink" numberOfLines={1}>
                      {template.name}
                    </Text>
                    <Mono className="text-[10px]" numberOfLines={1}>
                      {template.cadence}
                    </Mono>
                  </View>
                </Pressable>
              ))}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </Card>
  )
}

/* ── Skills ──────────────────────────────────────────────────────────────── */

export function SkillsSection() {
  const sessions = useStore((state) => state.sessions)
  const projects = React.useMemo(
    () => Array.from(new Set(sessions.map((session) => session.project).filter(Boolean))) as string[],
    [sessions],
  )
  const [project, setProject] = React.useState<string | null>(projects[0] ?? null)
  const [installed, setInstalled] = React.useState<Array<{ id: string; name: string; enabled: boolean }>>([])
  const [available, setAvailable] = React.useState<Array<{ id: string; name: string; description?: string }>>([])
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState<string | null>(null)
  const [viewSkill, setViewSkill] = React.useState<{ id: string; name: string; content: string } | null>(null)
  const [viewLoading, setViewLoading] = React.useState(false)
  const [confirmUninstall, setConfirmUninstall] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (project === null && projects.length > 0) setProject(projects[0])
  }, [projects, project])

  const load = React.useCallback(async () => {
    setError(null)
    try {
      const [catalog, list] = await Promise.all([
        skillsApi.available().catch(() => ({ skills: [] })),
        project ? skillsApi.installed(project) : Promise.resolve({ skills: [] }),
      ])
      setAvailable(catalog.skills ?? [])
      setInstalled(list.skills ?? [])
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load skills')
    }
  }, [project])

  React.useEffect(() => {
    void load()
  }, [load])

  async function toggleSkill(id: string, enabled: boolean) {
    if (!project) return
    setBusy(id)
    try {
      await skillsApi.toggle(id, project, enabled)
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not change that skill')
    } finally {
      setBusy(null)
    }
  }

  async function install(id: string) {
    if (!project) return
    setBusy(id)
    try {
      await skillsApi.install({ skill_id: id, project })
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not install that skill')
    } finally {
      setBusy(null)
    }
  }

  async function viewSkillContent(id: string, name: string) {
    if (!project) return
    setViewLoading(true)
    try {
      const res = await skillsApi.content(id, project)
      setViewSkill({ id, name, content: res.content ?? '' })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not read skill content')
    } finally {
      setViewLoading(false)
    }
  }

  async function uninstallSkill(name: string) {
    if (!project) return
    setBusy(name)
    try {
      await skillsApi.uninstall(name, project)
      setConfirmUninstall(null)
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not uninstall that skill')
    } finally {
      setBusy(null)
    }
  }

  const installedIds = new Set(installed.map((skill) => skill.name))

  return (
    <Card>
      <CardHeader
        title="Skills"
        right={project ? <Chip label={basename(project)} /> : undefined}
      />
      <View className="gap-3 p-3.5">
        {projects.length === 0 ? (
          <Text className="text-[11.5px] text-ink-3">
            No workspace yet. Skills are installed per project, so start a session first.
          </Text>
        ) : (
          <>
            {/* Workspace picker — skills are per project, exactly as on the desktop. */}
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-1.5">
              {projects.map((candidate) => {
                const active = candidate === project
                return (
                  <Pressable
                    key={candidate}
                    onPress={() => setProject(candidate)}
                    className={cn(
                      'min-h-8 flex-row items-center gap-1.5 rounded-control border px-2.5',
                      active ? 'border-accent bg-accent-tint' : 'border-line bg-surface',
                    )}
                  >
                    <Text className={cn('text-[11.5px]', active ? 'text-ink' : 'text-ink-2')}>
                      {basename(candidate)}
                    </Text>
                  </Pressable>
                )
              })}
            </ScrollView>

            {error ? <Text className="text-[11.5px] text-red">{error}</Text> : null}

            <View>
              <Mono className="mb-1 text-[9.5px] uppercase tracking-wider">
                Installed · {installed.length}
              </Mono>
              {installed.length === 0 ? (
                <Text className="text-[11.5px] text-ink-3">Nothing installed for this project yet.</Text>
              ) : (
                installed.map((skill) => (
                  <View key={skill.id} className="min-h-10 flex-row items-center gap-1.5">
                    <Text className="min-w-0 flex-1 text-[12px] text-ink" numberOfLines={1}>
                      {skill.name}
                    </Text>
                    <Pressable
                      onPress={() => void viewSkillContent(skill.id, skill.name)}
                      disabled={viewLoading}
                      accessibilityLabel={`View ${skill.name}`}
                      className="size-7 items-center justify-center rounded-lg active:bg-hover"
                    >
                      <Eye size={13} color="#7e7e86" />
                    </Pressable>
                    <Pressable
                      onPress={() => void toggleSkill(skill.id, !skill.enabled)}
                      disabled={busy === skill.id}
                      accessibilityRole="switch"
                      accessibilityState={{ checked: skill.enabled }}
                      className={cn(
                        'size-7 items-center justify-center rounded-lg',
                        skill.enabled ? 'bg-green-tint' : 'bg-surface',
                      )}
                    >
                      <View className={cn('size-2 rounded-full', skill.enabled ? 'bg-green' : 'bg-ink-3')} />
                    </Pressable>
                    {confirmUninstall === skill.id ? (
                      <Pressable
                        onPress={() => void uninstallSkill(skill.name)}
                        disabled={busy === skill.id}
                        className="min-h-7 rounded-lg bg-red-tint px-2 items-center justify-center"
                      >
                        <Text className="text-[10.5px] font-semibold text-red">
                          {busy === skill.id ? '…' : 'Confirm'}
                        </Text>
                      </Pressable>
                    ) : (
                      <Pressable
                        onPress={() => setConfirmUninstall(skill.id)}
                        accessibilityLabel={`Uninstall ${skill.name}`}
                        className="size-7 items-center justify-center rounded-lg active:bg-red-tint"
                      >
                        <Trash2 size={13} color="#7e7e86" />
                      </Pressable>
                    )}
                  </View>
                ))
              )}
            </View>

            {available.filter((skill) => !installedIds.has(skill.name)).length > 0 ? (
              <View>
                <Mono className="mb-1 text-[9.5px] uppercase tracking-wider">From the catalog</Mono>
                {available
                  .filter((skill) => !installedIds.has(skill.name))
                  .slice(0, 8)
                  .map((skill) => (
                    <View key={skill.id} className="min-h-10 flex-row items-center gap-2">
                      <View className="min-w-0 flex-1">
                        <Text className="text-[12px] text-ink" numberOfLines={1}>
                          {skill.name}
                        </Text>
                        {skill.description ? (
                          <Mono className="text-[10px]" numberOfLines={1}>
                            {skill.description}
                          </Mono>
                        ) : null}
                      </View>
                      <Button
                        variant="ghost"
                        label={busy === skill.id ? '…' : 'Install'}
                        className="min-h-8 px-2.5"
                        disabled={busy !== null}
                        onPress={() => void install(skill.id)}
                      />
                    </View>
                  ))}
              </View>
            ) : null}
          </>
        )}
      </View>

      {/* Skill content viewer */}
      <Modal visible={viewSkill !== null} transparent animationType="slide" onRequestClose={() => setViewSkill(null)}>
        <Pressable className="flex-1 justify-end bg-black/65" onPress={() => setViewSkill(null)}>
          <Pressable className="max-h-[80%] rounded-t-2xl border border-line bg-surface" onPress={(e) => e.stopPropagation()}>
            <View className="flex-row items-center justify-between border-b border-line px-3.5 py-2.5">
              <View className="min-w-0 flex-1">
                <Mono className="text-[9.5px] uppercase tracking-wider text-ink-3">Skill content</Mono>
                <Text className="text-[13px] font-medium text-ink" numberOfLines={1}>
                  {viewSkill?.name}
                </Text>
              </View>
              <Pressable onPress={() => setViewSkill(null)} accessibilityLabel="Close" className="size-9 items-center justify-center rounded-full">
                <X size={16} color="#b0b0b6" />
              </Pressable>
            </View>
            <ScrollView className="p-3.5">
              <TextInput
                value={viewSkill?.content ?? ''}
                editable={false}
                multiline
                className="font-mono text-[11.5px] leading-5 text-ink-2"
              />
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </Card>
  )
}
