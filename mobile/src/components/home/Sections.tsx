/**
 * System sections — Automations and Skills.
 *
 * QAI SIGNAL DECK: named things you toggle, run and delete. Automations stay
 * per-device (same template catalog, same MMKV shape, no daemon scheduler —
 * Run spawns a real session, stated on the card). Skills stay shared (the
 * daemon's per-project skills directory, same toggle/install/uninstall/
 * content handlers — a switch here fires on the desktop too). Enabled
 * automations lift onto accent hairlines; the rest stays quiet.
 */

import * as React from 'react'
import {
  Animated,
  Pressable,
  ScrollView,
  View,
} from 'react-native'
import { Text } from '@app/components/Text'
import { ChevronDown, Eye, Play, Plus, Trash2, Zap } from 'lucide-react-native'

import { basename, cn } from '@/lib/format'
import { skillsApi } from '@app/lib/api'
import { storage } from '@app/lib/storage'
import { useStore } from '@app/store'
import { palette, radius } from '@app/design/tokens'
import { rowEnterStyle, staggerDelay, useEnter } from '@app/components/motion'
import { PickerSheet, Sheet } from '@app/components/Sheet'
import {
  Button,
  Card,
  Eyebrow,
  Mono,
  Notice,
  ToggleRow,
  Well,
  haptic,
  toast,
} from '@app/components/ui'

/* ── Automations ───────────────────────────────────────────────────────────── */

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

const STORAGE_KEY = 'qai-automations'
const KEEP_AWAKE_KEY = 'qai-keep-awake'

const IDLE_TEMPLATES: Array<Omit<Automation, 'id' | 'enabled'>> = [
  {
    name: 'Standup git summary',
    prompt: 'Summarize commits, module changes, and follow-ups from this week.',
    cadence: 'When the machine is idle',
    kind: 'idle',
  },
  {
    name: 'CI failures & flaky tests',
    prompt: 'Review recent CI failures, flaky tests, and likely causes.',
    cadence: 'When the machine is idle',
    kind: 'idle',
  },
  {
    name: 'Documentation drift',
    prompt:
      'Check whether README files, docs, configuration guidance, and usage examples match the current code.',
    cadence: 'When the machine is idle',
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
    prompt:
      'Inspect changes from the last 24 hours and report high-confidence risks with direct evidence.',
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
  const [confirmRemove, setConfirmRemove] = React.useState<string | null>(null)

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
    void haptic('success')
    toast({ message: `“${template.name}” added`, tone: 'ok' })
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
    setConfirmRemove(null)
  }

  /** Run now spawns a session carrying the automation's prompt — same as desktop. */
  async function runNow(automation: Automation) {
    const ready = agents.find((agent) => agent.available)
    if (!ready) {
      toast({ message: 'No agent is ready on the desktop', tone: 'danger' })
      return
    }
    void haptic('medium')
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
    toast(
      session
        ? { message: `Started “${automation.name}”`, tone: 'ok' }
        : { message: `Could not start “${automation.name}”`, tone: 'danger' },
    )
  }

  return (
    <View className="gap-3">
      <Card>
        <View className="gap-3.5 p-4">
          <Text className="text-[13px] leading-[18px] text-ink-2">
            Templates you start on demand. Nothing is scheduled by the daemon: “Run” spawns a real
            session with the prompt, on the desktop as well as here.
          </Text>

          {automations.length === 0 ? (
            <View className="rounded-md border border-dashed border-line p-3.5">
              <Text className="text-[13px] leading-[18px] text-ink-3">
                No automations yet. Add one to keep a prompt you run often.
              </Text>
            </View>
          ) : (
            <View className="gap-1.5">
              {automations.map((automation, index) => (
                <AutomationRow
                  key={automation.id}
                  automation={automation}
                  index={index}
                  confirming={confirmRemove === automation.id}
                  onToggle={() => {
                    void haptic('select')
                    toggle(automation.id)
                  }}
                  onRun={() => void runNow(automation)}
                  onRemove={() => {
                    void haptic('warn')
                    setConfirmRemove(automation.id)
                  }}
                  onConfirmRemove={() => remove(automation.id)}
                />
              ))}
            </View>
          )}

          <View className="flex-row flex-wrap gap-2">
            <Button
              size="sm"
              variant="secondary"
              label="Add a scheduled template"
              icon={<Plus size={14} color={palette.ink2} />}
              onPress={() => setPicker('scheduled')}
            />
            <Button
              size="sm"
              variant="secondary"
              label="Add an idle template"
              onPress={() => setPicker('idle')}
            />
          </View>

          <View className="h-px bg-line" />

          <ToggleRow
            label="Keep the machine awake"
            description="Ask the desktop not to sleep while agents are running."
            value={keepAwake}
            onChange={(next) => {
              void haptic('select')
              setKeepAwake(next)
            }}
            leading={<Zap size={17} color={keepAwake ? palette.wait : palette.ink3} />}
          />
        </View>
      </Card>

      <PickerSheet
        open={picker !== null}
        onClose={() => setPicker(null)}
        title={picker === 'idle' ? 'Idle-time templates' : 'Scheduled templates'}
        subtitle="Stored on this device"
        searchable
        value={undefined}
        onSelect={(value) => {
          const template = (picker === 'idle' ? IDLE_TEMPLATES : SCHEDULED_TEMPLATES).find(
            (entry) => entry.name === value,
          )
          if (template) addTemplate(template)
        }}
        options={(picker === 'idle' ? IDLE_TEMPLATES : SCHEDULED_TEMPLATES).map((template) => ({
          value: template.name,
          label: template.name,
          hint: template.prompt,
        }))}
      />
    </View>
  )
}

function AutomationRow({
  automation,
  index,
  confirming,
  onToggle,
  onRun,
  onRemove,
  onConfirmRemove,
}: {
  automation: Automation
  index: number
  confirming: boolean
  onToggle: () => void
  onRun: () => void
  onRemove: () => void
  onConfirmRemove: () => void
}) {
  const enter = useEnter(staggerDelay(index), false)
  return (
    <Animated.View style={rowEnterStyle(enter)}>
      <View
        className={cn(
          'flex-row items-center gap-2.5 rounded-md border py-2 pl-3 pr-1',
          // An enabled automation gets an accent hairline — the toggle dot
          // carries the state, the edge carries the emphasis.
          automation.enabled ? 'border-accent-border bg-raised' : 'border-line bg-transparent',
        )}
        style={automation.enabled ? undefined : { opacity: 0.72 }}
      >
        <Zap size={14} color={automation.enabled ? palette.ink2 : palette.ink4} />
        <View className="min-w-0 flex-1 gap-0.5">
          <Text className="text-[13px] leading-[18px] font-medium text-ink" numberOfLines={1}>
            {automation.name}
          </Text>
          <Text className="text-[11px] leading-[15px] text-ink-3" numberOfLines={1}>
            {automation.kind === 'idle' ? 'idle · ' : ''}
            {automation.cadence}
            {automation.lastRun ? ' · ran' : ''}
          </Text>
        </View>

        <Pressable
          accessibilityRole="switch"
          accessibilityLabel={`${automation.name} enabled`}
          accessibilityState={{ checked: automation.enabled }}
          onPress={onToggle}
          hitSlop={8}
          style={({ pressed }) => ({
            width: 34,
            height: 34,
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: radius.pill,
            backgroundColor: pressed ? palette.hover : 'transparent',
          })}
        >
          <View
            style={{
              width: 9,
              height: 9,
              borderRadius: 5,
              backgroundColor: automation.enabled ? palette.accent : palette.ink4,
            }}
          />
        </Pressable>

        <Pressable
          accessibilityRole="button"
          accessibilityLabel={`Run ${automation.name} now`}
          onPress={onRun}
          hitSlop={8}
          style={({ pressed }) => ({
            width: 34,
            height: 34,
            alignItems: 'center',
            justifyContent: 'center',
            borderRadius: radius.pill,
            backgroundColor: pressed ? palette.hover : 'transparent',
          })}
        >
          <Play size={15} color={palette.ink2} />
        </Pressable>

        {confirming ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Confirm deleting ${automation.name}`}
            onPress={onConfirmRemove}
            style={({ pressed }) => ({
              minHeight: 30,
              justifyContent: 'center',
              borderRadius: radius.sm,
              backgroundColor: pressed ? palette.dangerSoft : palette.dangerSoft,
              paddingHorizontal: 9,
            })}
          >
            <Text style={{ color: palette.danger, fontSize: 11.5, fontWeight: '700' }}>Delete</Text>
          </Pressable>
        ) : (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={`Delete ${automation.name}`}
            onPress={onRemove}
            hitSlop={8}
            style={({ pressed }) => ({
              width: 34,
              height: 34,
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: radius.pill,
              backgroundColor: pressed ? palette.dangerSoft : 'transparent',
            })}
          >
            <Trash2 size={15} color={palette.ink3} />
          </Pressable>
        )}
      </View>
    </Animated.View>
  )
}

/* ── Skills ────────────────────────────────────────────────────────────────────
 * The one home-page section that is genuinely remote control: the daemon owns
 * `.agentdeck/skills/` per project, so a toggle here changes what the desktop
 * injects into every subsequent turn. That is worth saying on the card, because
 * a user tapping a switch on a phone and expecting it to stay local would be
 * wrong about the most consequential thing this section does. */

export function SkillsSection() {
  const sessions = useStore((state) => state.sessions)
  const projects = React.useMemo(
    () => Array.from(new Set(sessions.map((session) => session.project).filter(Boolean))) as string[],
    [sessions],
  )
  const [project, setProject] = React.useState<string | null>(null)
  const [installed, setInstalled] = React.useState<Array<{ id: string; name: string; enabled: boolean }>>([])
  const [available, setAvailable] = React.useState<Array<{ id: string; name: string; description?: string }>>([])
  const [error, setError] = React.useState<string | null>(null)
  const [busy, setBusy] = React.useState<string | null>(null)
  const [projectPicker, setProjectPicker] = React.useState(false)
  const [viewSkill, setViewSkill] = React.useState<{ name: string; content: string } | null>(null)
  const [viewLoading, setViewLoading] = React.useState(false)
  const [confirmUninstall, setConfirmUninstall] = React.useState<string | null>(null)

  React.useEffect(() => {
    if (project === null && projects.length > 0) setProject(projects[0])
  }, [projects, project])

  const load = React.useCallback(async () => {
    if (!project) {
      setInstalled([])
      setAvailable([])
      return
    }
    setError(null)
    try {
      const [catalog, list] = await Promise.all([
        skillsApi.available().catch(() => ({ skills: [] })),
        skillsApi.installed(project),
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
      void haptic('select')
    } catch (cause) {
      toast({
        message: 'Could not change that skill',
        detail: cause instanceof Error ? cause.message : undefined,
        tone: 'danger',
      })
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
      toast({ message: 'Skill installed', tone: 'ok' })
    } catch (cause) {
      toast({
        message: 'Could not install that skill',
        detail: cause instanceof Error ? cause.message : undefined,
        tone: 'danger',
      })
    } finally {
      setBusy(null)
    }
  }

  async function viewSkillContent(id: string, name: string) {
    if (!project) return
    setViewLoading(true)
    try {
      const res = await skillsApi.content(id, project)
      setViewSkill({ name, content: res.content ?? '' })
    } catch (cause) {
      toast({
        message: 'Could not read that skill',
        detail: cause instanceof Error ? cause.message : undefined,
        tone: 'danger',
      })
    } finally {
      setViewLoading(false)
    }
  }

  async function uninstall(name: string) {
    if (!project) return
    setBusy(name)
    try {
      await skillsApi.uninstall(name, project)
      setConfirmUninstall(null)
      await load()
      toast({ message: 'Skill uninstalled', tone: 'ok' })
    } catch (cause) {
      toast({
        message: 'Could not uninstall that skill',
        detail: cause instanceof Error ? cause.message : undefined,
        tone: 'danger',
      })
    } finally {
      setBusy(null)
    }
  }

  const installedIds = new Set(installed.map((skill) => skill.name))
  const catalog = available.filter((skill) => !installedIds.has(skill.name))

  if (projects.length === 0) {
    return (
      <Card>
        <View className="p-4">
          <Text className="text-[13px] leading-[18px] text-ink-3">
            No workspace yet. Skills install per project, so start a session first.
          </Text>
        </View>
      </Card>
    )
  }

  return (
    <View className="gap-3">
      <Card>
        <View className="gap-3.5 p-4">
          <Text className="text-[13px] leading-[18px] text-ink-2">
            Skills install into the project's skills directory on the desktop
            and are injected into every turn by the context assembler — on the desktop as well as
            here. A switch here is not local.
          </Text>

          <View className="gap-1.5">
            <Eyebrow>Project</Eyebrow>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Skills for ${project ? basename(project) : 'no project'}. Tap to change.`}
              onPress={() => setProjectPicker(true)}
              className="min-h-11 flex-row items-center gap-2 rounded-md border border-line bg-field px-3.5 active:bg-raised"
            >
              <Mono className="min-w-0 flex-1 text-[12.5px] text-ink" numberOfLines={1}>
                {project ? basename(project) : 'Choose a project'}
              </Mono>
              <ChevronDown size={15} color={palette.ink3} />
            </Pressable>
          </View>

          {error ? <Notice tone="danger" message={error} /> : null}

          <View className="gap-1">
            <Eyebrow>Installed · {installed.length}</Eyebrow>
            {installed.length === 0 ? (
              <Text className="py-2 text-[13px] leading-[18px] text-ink-3">
                Nothing installed for this project.
              </Text>
            ) : (
              installed.map((skill) => (
                <View
                  key={skill.id}
                  className="min-h-11 flex-row items-center gap-0.5"
                >
                  <Text
                    className="min-w-0 flex-1 pl-1.5 text-[14px] leading-[19px] text-ink"
                    numberOfLines={1}
                  >
                    {skill.name}
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Read ${skill.name}`}
                    disabled={viewLoading}
                    onPress={() => void viewSkillContent(skill.id, skill.name)}
                    hitSlop={8}
                    style={({ pressed }) => ({
                      width: 34,
                      height: 34,
                      alignItems: 'center',
                      justifyContent: 'center',
                      borderRadius: radius.pill,
                      backgroundColor: pressed ? palette.raised : 'transparent',
                    })}
                  >
                    <Eye size={15} color={palette.ink3} />
                  </Pressable>
                  <Pressable
                    accessibilityRole="switch"
                    accessibilityLabel={`${skill.name} enabled`}
                    accessibilityState={{ checked: skill.enabled }}
                    disabled={busy === skill.id}
                    onPress={() => void toggleSkill(skill.id, !skill.enabled)}
                    hitSlop={8}
                    style={({ pressed }) => ({
                      width: 34,
                      height: 34,
                      alignItems: 'center',
                      justifyContent: 'center',
                      borderRadius: radius.pill,
                      backgroundColor: pressed ? palette.raised : 'transparent',
                    })}
                  >
                    <View
                      style={{
                        width: 9,
                        height: 9,
                        borderRadius: 5,
                        backgroundColor: skill.enabled ? palette.accent : palette.ink4,
                      }}
                    />
                  </Pressable>
                  {confirmUninstall === skill.id ? (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Confirm uninstalling ${skill.name}`}
                      disabled={busy === skill.id}
                      onPress={() => void uninstall(skill.name)}
                      style={({ pressed }) => ({
                        minHeight: 30,
                        justifyContent: 'center',
                        borderRadius: radius.sm,
                        backgroundColor: pressed ? palette.dangerSoft : palette.dangerSoft,
                        paddingHorizontal: 9,
                      })}
                    >
                      <Text style={{ color: palette.danger, fontSize: 11.5, fontWeight: '700' }}>
                        Uninstall
                      </Text>
                    </Pressable>
                  ) : (
                    <Pressable
                      accessibilityRole="button"
                      accessibilityLabel={`Uninstall ${skill.name}`}
                      onPress={() => {
                        void haptic('warn')
                        setConfirmUninstall(skill.id)
                      }}
                      hitSlop={8}
                      style={({ pressed }) => ({
                        width: 34,
                        height: 34,
                        alignItems: 'center',
                        justifyContent: 'center',
                        borderRadius: radius.pill,
                        backgroundColor: pressed ? palette.dangerSoft : 'transparent',
                      })}
                    >
                      <Trash2 size={15} color={palette.ink3} />
                    </Pressable>
                  )}
                </View>
              ))
            )}
          </View>

          {catalog.length > 0 ? (
            <View className="gap-1">
              <Eyebrow>From the catalog</Eyebrow>
              {catalog.slice(0, 8).map((skill) => (
                <View key={skill.id} className="min-h-11 flex-row items-center gap-3 py-1">
                  <View className="min-w-0 flex-1 gap-0.5">
                    <Text className="text-[14px] leading-[19px] text-ink" numberOfLines={1}>
                      {skill.name}
                    </Text>
                    {skill.description ? (
                      <Text className="text-[12px] leading-[16px] text-ink-3" numberOfLines={2}>
                        {skill.description}
                      </Text>
                    ) : null}
                  </View>
                  <Button
                    size="sm"
                    variant="secondary"
                    label={busy === skill.id ? '…' : 'Install'}
                    disabled={busy !== null}
                    onPress={() => void install(skill.id)}
                  />
                </View>
              ))}
            </View>
          ) : null}
        </View>
      </Card>

      <PickerSheet
        open={projectPicker}
        onClose={() => setProjectPicker(false)}
        title="Skills are per project"
        subtitle="Installed per project on the desktop"
        searchable
        value={project ?? undefined}
        onSelect={(value) => setProject(value)}
        options={projects.map((candidate) => ({
          value: candidate,
          label: basename(candidate),
          hint: candidate,
        }))}
      />

      <SkillViewer skill={viewSkill} onClose={() => setViewSkill(null)} />
    </View>
  )
}

/**
 * The skill's own text.
 *
 * Read-only and horizontally scrollable rather than a wrapped paragraph: this
 * is a prompt, and a prompt re-wrapped at phone width is a prompt whose
 * structure you cannot see.
 */
function SkillViewer({
  skill,
  onClose,
}: {
  skill: { name: string; content: string } | null
  onClose: () => void
}) {
  return (
    <Sheet
      open={skill !== null}
      onClose={onClose}
      title={skill?.name ?? ''}
      eyebrow="Skill"
      snapPoints={[0.6, 0.92]}
    >
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <ScrollView style={{ maxHeight: 420 }} nestedScrollEnabled>
          <Well className="p-3.5" style={{ borderRadius: radius.md }}>
            <Mono className="text-[12px] leading-[18px] text-code-ink">
              {skill?.content ?? ''}
            </Mono>
          </Well>
        </ScrollView>
      </ScrollView>
      <Button variant="secondary" label="Close" full onPress={onClose} />
    </Sheet>
  )
}
