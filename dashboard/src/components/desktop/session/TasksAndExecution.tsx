/**
 * TasksPanel — Progress checklist (real plan state) + Automations card grid.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowRight,
  Bot,
  Brain,
  Check,
  ChevronDown,
  Circle,
  Clock,
  FileText,
  Hand,
  ShieldCheck,
  ShieldAlert,
  Sun,
  Zap,
} from 'lucide-react'
import { getConversation, useStore } from '@/store'
import { cn } from '@/lib/format'
import { DropdownList } from '@/components/ui'
import type { Session } from '@/types/session'

/* ── Progress checklist ─────────────────────────────────────────────────── */

interface TaskItem {
  id: string
  title: string
  status: 'pending' | 'in_progress' | 'completed'
}

/** Newest `plan` part in the conversation wins — agents replace plans per turn. */
function tasksFromConversation(sessionId: string): TaskItem[] {
  const conversation = getConversation(sessionId)
  for (let i = conversation.messages.length - 1; i >= 0; i -= 1) {
    for (const part of [...conversation.messages[i].parts].reverse()) {
      if (part.kind !== 'plan') continue
      const plan = part as { steps: string[]; entries?: Array<{ content: string; status?: string }> }
      return plan.steps.map((step, idx) => {
        const entry = plan.entries?.find((e) => e.content === step)
        const raw = entry?.status
        const status: TaskItem['status'] =
          raw === 'completed' ? 'completed' : raw === 'in_progress' ? 'in_progress' : 'pending'
        return { id: `${i}-${idx}`, title: step, status }
      })
    }
  }
  return []
}

export function ProgressWidget({ session }: { session: Session }) {
  // Re-render when conversation revisions change.
  const revision = useStore((s) => s.revisions[session.id])
  void revision
  const tasks = useMemo(() => tasksFromConversation(session.id), [session.id, revision])
  const done = tasks.filter((t) => t.status === 'completed').length
  const activeIndex = tasks.findIndex((t) => t.status === 'in_progress')

  if (tasks.length === 0) return null

  return (
    <section className="m-2 rounded-xl border border-white/[0.07] bg-[#191613] p-3">
      <header className="mb-2 flex items-center justify-between">
        <h2 className="text-[12px] font-semibold text-zinc-100">Progress</h2>
        <span className="font-mono text-[10px] text-zinc-500">
          {done}/{tasks.length}
        </span>
      </header>
      <ol className="flex flex-col gap-0.5">
        {tasks.map((task, idx) => (
          <li key={task.id} className="flex items-start gap-2 rounded-lg px-1.5 py-1 hover:bg-white/[0.04]">
            {/* State icon: ✓ done · → active · ○ pending */}
            <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center">
              {task.status === 'completed' ? (
                <span className="flex size-3.5 items-center justify-center rounded-full bg-emerald-400/20 text-emerald-400">
                  <Check size={9} strokeWidth={3} />
                </span>
              ) : task.status === 'in_progress' || (activeIndex === -1 && idx === done) ? (
                <ArrowRight size={13} className="text-zinc-100" strokeWidth={2.2} />
              ) : (
                <Circle size={11} className="text-zinc-600" strokeWidth={2} />
              )}
            </span>
            <span
              className={cn(
                'min-w-0 flex-1 break-words text-[11.5px] leading-snug',
                task.status === 'completed'
                  ? 'text-zinc-600 line-through'
                  : task.status === 'in_progress' || (activeIndex === -1 && idx === done)
                    ? 'text-zinc-50 font-medium'
                    : 'text-zinc-500',
              )}
            >
              {task.title}
            </span>
          </li>
        ))}
      </ol>
    </section>
  )
}

/* ── Automations & scheduled tasks ──────────────────────────────────────── */

const AWAKE_KEY = 'agentdeck-keep-awake'

const IDLE_TEMPLATES = [
  { icon: Bot, title: 'Standup Git Summary', detail: 'Summarize yesterday\u2019s commits when you go idle.' },
  { icon: Zap, title: 'CI Failures & Flaky Test Report', detail: 'Collect failing checks into a triage list.' },
  { icon: FileText, title: 'Documentation sync check', detail: 'Flag docs that drifted from code.' },
]

const SCHEDULED_TEMPLATES = [
  { icon: Sun, title: 'Morning dev brief', schedule: 'Weekdays · 9:00' },
  { icon: ShieldAlert, title: 'Risk scan', schedule: 'Daily · 18:00' },
  { icon: Clock, title: 'Release brief', schedule: 'Fridays · 16:00' },
  { icon: FileText, title: 'Documentation sync check', schedule: 'Mondays · 10:00' },
]

function TemplateCard({
  icon: Icon,
  title,
  detail,
  schedule,
  onRun,
}: {
  icon: React.ComponentType<{ size?: number; className?: string }>
  title: string
  detail?: string
  schedule?: string
  onRun?: () => void
}) {
  return (
    <button
      type="button"
      onClick={onRun}
      className="group flex w-full flex-col gap-1 rounded-lg border border-white/[0.07] bg-white/[0.02] p-2.5 text-left transition hover:border-white/20 hover:bg-white/[0.05]"
    >
      <span className="flex items-center gap-1.5">
        <Icon size={12} className="shrink-0 text-zinc-500 group-hover:text-zinc-300" />
        <span className="min-w-0 flex-1 truncate text-[11px] font-medium text-zinc-200">{title}</span>
      </span>
      {detail ? (
        <span className="line-clamp-2 text-[10px] leading-snug text-zinc-600">{detail}</span>
      ) : schedule ? (
        <span className="font-mono text-[9.5px] text-zinc-600">{schedule}</span>
      ) : null}
    </button>
  )
}

export function AutomationsPanel({ session }: { session: Session }) {
  const [awake, setAwake] = useState(() => {
    try {
      return localStorage.getItem(AWAKE_KEY) !== '0'
    } catch {
      return true
    }
  })

  useEffect(() => {
    try {
      localStorage.setItem(AWAKE_KEY, awake ? '1' : '0')
    } catch {
      /* storage may be unavailable */
    }
  }, [awake])

  function runTemplate(title: string) {
    const sendPrompt = useStore.getState().sendPrompt
    void sendPrompt(
      session.id,
      `Run the "${title}" automation now and report the results.`,
    )
  }

  return (
    <section className="m-2 rounded-xl border border-white/[0.07] bg-[#191613] p-3">
      <header className="mb-2">
        <h2 className="text-[12px] font-semibold text-zinc-100">Tasks / Automations</h2>
      </header>

      {/* Keep-awake toggle */}
      <label className="mb-3 flex cursor-pointer items-center gap-2.5 rounded-lg border border-white/[0.07] bg-white/[0.02] px-2.5 py-2">
        <span className="min-w-0 flex-1 text-[11px] leading-snug text-zinc-300">
          Keep your computer awake while running a chat
        </span>
        <button
          type="button"
          role="switch"
          aria-checked={awake}
          onClick={() => setAwake((v) => !v)}
          className={cn(
            'relative h-4.5 w-8 shrink-0 rounded-full transition',
            awake ? 'bg-emerald-400/80' : 'bg-zinc-700',
          )}
          style={{ height: 18, width: 32 }}
        >
          <span
            className={cn(
              'absolute top-0.5 size-3.5 rounded-full bg-white transition-all',
              awake ? 'left-[15px]' : 'left-0.5',
            )}
            style={{ top: 2 }}
          />
        </button>
      </label>

      <h3 className="mb-1.5 font-mono text-[9.5px] uppercase tracking-[0.12em] text-zinc-600">Idle-time</h3>
      <div className="mb-3 grid grid-cols-1 gap-1.5">
        {IDLE_TEMPLATES.map((t) => (
          <TemplateCard key={t.title} icon={t.icon} title={t.title} detail={t.detail} onRun={() => runTemplate(t.title)} />
        ))}
      </div>

      <h3 className="mb-1.5 font-mono text-[9.5px] uppercase tracking-[0.12em] text-zinc-600">Scheduled</h3>
      <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
        {SCHEDULED_TEMPLATES.map((t) => (
          <TemplateCard key={t.title} icon={t.icon} title={t.title} schedule={t.schedule} onRun={() => runTemplate(t.title)} />
        ))}
      </div>
    </section>
  )
}





/**
 * The composer control row contents: permission mode first, then every live
 * config dimension (model first), all as inline dropdown chips.
 *
 * When the selected model advertises reasoning (`capabilities.reasoning`) or
 * the provider exposes an `effort`/`thinking`-style dimension, those chips
 * appear automatically — they are config options like any other.
 */
export function ComposerControls({
  config,
  agent,
  modelsSource,
  busyId,
  mode,
  onChange,
  part = 'left',
  subagents,
}: {
  config?: { options: ConfigOptionLike[]; live?: boolean } | undefined
  agent?: string
  modelsSource?: string
  busyId?: string | null
  /** Live session mode from the agent (e.g. plan ↔ act), when reported. */
  mode?: { id: string; modes: Array<{ id: string; name?: string }> }
  onChange: (id: string, value: string) => void
  /** Which half of the control row this instance renders. */
  part?: 'left' | 'right'
  /** Subagents spawned by this session — renders the popup control. */
  subagents?: Array<{ id: string; name: string; kind: string; status: 'working' | 'completed' | 'failed' }>
}) {
  void agent // no per-agent filtering: every advertised choice stays offered
  void modelsSource
  const ordered = useMemo(() => {
    const options = config?.options ?? []
    // permission_mode is rendered by the dedicated (icon) PermissionChip, not
    // as a generic icon-less config chip — exclude it here to avoid a duplicate.
    // The `mode` dimension is likewise rendered by SessionModeChip when the
    // agent reports live modes (opencode's build/plan), so a config `mode`
    // option must not render twice either.
    const liveModeShown = Boolean(mode && mode.modes.length > 0)
    const configOptions = options.filter(
      (o) => o.id !== 'permission_mode' && !(liveModeShown && o.id === 'mode'),
    )
    const isThinking = (o: ConfigOptionLike) => ['effort', 'thinking', 'reasoning'].includes(o.id) || o.id.includes('effort')
    const models = configOptions.filter(isModelOption)
    // Thinking controls sit right after the model; everything else follows.
    const thinking = configOptions.filter((o) => !isModelOption(o) && isThinking(o))
    const rest = configOptions.filter((o) => !isModelOption(o) && !isThinking(o))
    return [...models, ...thinking, ...rest]
  }, [config?.options, mode])

  // Reference layout: the model/effort chips belong on the RIGHT of the
  // control row (beside the status ring); everything else sits LEFT next to
  // the attach button. Callers render ComposerControls twice with part=
  // "left" / "right".
  const isPrimary = (option: ConfigOptionLike) => isModelOption(option) || isThinkingOption(option)
  const primary = ordered.filter(isPrimary)
  const rest = ordered.filter((option) => !isPrimary(option))

  if (part === 'right') {
    return (
      <>
        {mode && mode.modes.length > 0 ? (
          <SessionModeChip mode={mode} onChange={(value) => onChange('mode', value)} />
        ) : null}
        {primary.map((option) => (
          <InlineOptionChip
            key={option.id}
            option={option}
            busy={busyId === option.id}
            onChange={(value) => onChange(option.id, value)}
            minimal={isThinkingOption(option)}
          />
        ))}
      </>
    )
  }

  return (
    <>
      <PermissionChip
        currentMode={config?.options.find((o) => o.id === 'permission_mode')?.currentValue}
        onChange={onChange}
      />
      {subagents ? <SubagentsControl subagents={subagents} /> : null}
      {rest.map((option) => (
        <InlineOptionChip key={option.id} option={option} busy={busyId === option.id} onChange={(value) => onChange(option.id, value)} />
      ))}
    </>
  )
}

function isThinkingOption(option: ConfigOptionLike): boolean {
  return ['effort', 'thinking', 'reasoning'].includes(option.id) || option.id.includes('effort')
}

function isModelOption(option: ConfigOptionLike): boolean {
  return option.id === 'model' || option.id.includes('model')
}

/* ── Inline config chips (dropdown lists, no modal) ─────────────────────── */

export interface PermissionMode {
  id: 'ask' | 'auto_edit' | 'plan' | 'full'
  label: string
  subtext: string
  icon: React.ComponentType<{ size?: number; className?: string }>
}

export const PERMISSION_MODES: PermissionMode[] = [
  { id: 'ask', label: 'Ask before changes', subtext: 'Ask before file changes.', icon: Hand },
  { id: 'auto_edit', label: 'Edit automatically', subtext: 'Edit files automatically.', icon: ShieldCheck },
  { id: 'plan', label: 'Plan mode', subtext: 'Plan before editing.', icon: FileText },
  { id: 'full', label: 'Full access', subtext: 'Run with fewer confirmations.', icon: ShieldAlert },
]

const PERMISSION_KEY = 'agentdeck-permission-mode'

export function usePermissionMode() {
  // No local state: the session's backend config (pending_config
  // "permission_mode") is authoritative. `select` only remembers the last
  // choice as a hint for brand-new sessions that have never set a mode.
  const select = (id: PermissionMode['id']) => {
    try {
      localStorage.setItem(PERMISSION_KEY, id)
    } catch {
      /* storage may be unavailable */
    }
  }
  return { select }
}

export function PermissionChip({
  currentMode,
  onChange,
}: {
  /** Live permission mode from the backend, if available. */
  currentMode?: string
  /** Persist a permission choice (config id + value). */
  onChange?: (id: string, value: string) => void
}) {
  const { select } = usePermissionMode()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // When the agent reports a live permission mode, reflect it back into the UI.
  const effective = currentMode ?? 'ask'
  const selected = PERMISSION_MODES.find((m) => m.id === effective) ?? PERMISSION_MODES[0]

  // All four modes send distinct, functional values to the backend.
  // The config_id is 'permission_mode' (Plumb-specific), not 'mode' (agent-native).
  const toAgentMode = (id: PermissionMode['id']): string => id

  // Icon-only trigger, like the reference: the orange shield IS the
  // permission state; the label lives in the dropdown and the tooltip.
  const TriggerIcon = selected.icon

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={`Permission: ${selected.label}`}
        title={`${selected.label} — ${selected.subtext}`}
        className={cn(
          'inline-flex size-7 shrink-0 items-center justify-center rounded-lg',
          'transition-colors duration-150 hover:bg-hover-2',
          open && 'bg-hover-2',
        )}
      >
        <TriggerIcon size={15} className="shrink-0 text-orange" />
      </button>

      {open ? (
        <DropdownList anchorRef={ref} onClose={() => setOpen(false)} width={256}>
          <div role="listbox" className="p-1">
            {PERMISSION_MODES.map((option) => {
              const Icon = option.icon
              const active = effective === option.id
              return (
                <button
                  key={option.id}
                  type="button"
                  role="option"
                  aria-selected={active}
                  onClick={() => {
                    select(option.id)
                    // Send the distinct permission mode value to the backend.
                    onChange?.('permission_mode', toAgentMode(option.id))
                    setOpen(false)
                  }}
                  className={cn(
                    'flex w-full items-start gap-2.5 px-2.5 py-2 text-left transition-colors',
                    active ? 'bg-hover' : 'hover:bg-hover-2',
                  )}
                >
                  <Icon size={15} className={cn('mt-0.5 shrink-0', active ? 'text-emerald-400' : 'opacity-60')} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12.5px] font-medium text-ink">{option.label}</span>
                    <span className="block text-[11px] leading-snug text-ink-3">{option.subtext}</span>
                  </span>
                  {active ? <Check size={13} className="mt-0.5 shrink-0 text-emerald-400" /> : null}
                </button>
              )
            })}
          </div>
        </DropdownList>
      ) : null}
    </div>
  )
}

/**
 * Subagents control — appears in the composer's control row only when this
 * session has spawned subagents. The count badge shows while at least one is
 * running and hides when the work settles; the popup (like the context-windows
 * popover) lists every child with its live status.
 */
export function SubagentsControl({
  subagents,
}: {
  subagents: Array<{ id: string; name: string; kind: string; status: 'working' | 'completed' | 'failed' }>
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function onOutside(event: MouseEvent) {
      if (ref.current && !ref.current.contains(event.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onOutside)
    return () => document.removeEventListener('mousedown', onOutside)
  }, [open])

  const running = subagents.filter((subagent) => subagent.status === 'working').length
  if (subagents.length === 0) return null

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-label={`Subagents: ${running} running, ${subagents.length} total`}
        title={running > 0 ? `${running} subagent${running === 1 ? '' : 's'} running` : `${subagents.length} subagent${subagents.length === 1 ? '' : 's'}`}
        className={cn(
          'relative inline-flex size-7 shrink-0 items-center justify-center rounded-lg',
          'transition-colors duration-150 hover:bg-hover-2',
          open && 'bg-hover-2',
        )}
      >
        <Bot size={15} className={cn('shrink-0', running > 0 ? 'text-green' : 'text-ink-3')} />
        {running > 0 ? (
          <span
            aria-hidden
            className="absolute -right-0.5 -top-0.5 flex h-3.5 min-w-3.5 items-center justify-center rounded-full bg-accent px-0.5 font-mono text-[8.5px] font-semibold leading-none text-accent-ink"
          >
            {running}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          className={cn(
            'absolute bottom-full left-0 z-40 mb-2 w-64 animate-up rounded-xl border border-line',
            'bg-surface p-2 shadow-overlay',
          )}
          role="dialog"
          aria-label="Subagents"
        >
          <p className="mb-1 px-1 text-[11px] font-medium text-ink-2">
            Subagents · {running > 0 ? `${running} running` : `${subagents.length} total`}
          </p>
          <div className="flex max-h-56 flex-col gap-0.5 overflow-y-auto scroll-thin">
            {subagents.map((subagent) => (
              <div key={subagent.id} className="flex items-center gap-2 rounded-lg px-1.5 py-1.5">
                {subagent.status === 'working' ? (
                  <span className="size-2 shrink-0 animate-spin rounded-full border-[1.5px] border-green border-t-transparent" aria-hidden />
                ) : (
                  <Check
                    size={11}
                    strokeWidth={2.4}
                    className={cn('shrink-0', subagent.status === 'failed' ? 'text-red' : 'text-green')}
                  />
                )}
                <span className="min-w-0 flex-1 truncate text-[11.5px] text-ink-2">{subagent.name}</span>
                {subagent.kind ? (
                  <span className="shrink-0 font-mono text-[9px] uppercase text-ink-3">{subagent.kind}</span>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  )
}

/* ── Session mode chip (plan / act) ─────────────────────────────────────── */

/**
 * The agent's working mode — e.g. "plan" (think and propose) vs "act"
 * (execute changes). Populated by `mode_changed` events; the agent declares
 * its available modes at runtime, so this chip only appears when there is a
 * choice to make. Selecting a mode sends a `mode` config update.
 */
function SessionModeChip({
  mode,
  onChange,
}: {
  mode: { id: string; modes: Array<{ id: string; name?: string }> }
  onChange: (value: string) => void
}) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  const current = mode.modes.find((m) => m.id === mode.id)
  const label = current?.name ?? current?.id ?? mode.id

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="listbox"
        title={`Session mode: ${label}`}
        className={cn(
          'inline-flex min-h-8 max-w-full shrink-0 items-center gap-1.5 rounded-lg border border-line/50 bg-surface/80 px-2.5',
          'text-[11.5px] transition-all duration-150 hover:bg-hover hover:border-line-strong',
          open && 'bg-hover border-line-strong',
        )}
      >
        <ModeIcon size={12} className="shrink-0 text-blue-400" />
        <span className="max-w-[100px] truncate font-medium">{label}</span>
        <ChevronDown size={11} className={cn('shrink-0 opacity-60 transition-transform', open && 'rotate-180')} />
      </button>

      {open ? (
        <DropdownList anchorRef={ref} onClose={() => setOpen(false)} width={220}>
          <div role="listbox" className="p-1">
            {mode.modes.map((option) => {
              const active = option.id === mode.id
              return (
                <button
                  key={option.id}
                  type="button"
                  role="option"
                  aria-selected={active}
                  onClick={() => {
                    onChange(option.id)
                    setOpen(false)
                  }}
                  className={cn(
                    'flex w-full items-center gap-2.5 px-2.5 py-2 text-left transition-colors',
                    active ? 'bg-hover' : 'hover:bg-hover-2',
                  )}
                >
                  <Check size={11} strokeWidth={2.6} className={cn('shrink-0', active ? 'text-emerald-400' : 'text-transparent')} />
                  <span className="min-w-0 flex-1 truncate text-[12px] text-ink">{option.name ?? option.id}</span>
                </button>
              )
            })}
          </div>
        </DropdownList>
      ) : null}
    </div>
  )
}

function ModeIcon({ size, className }: { size?: number; className?: string }) {
  return (
    <svg width={size ?? 14} height={size ?? 14} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden>
      <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
    </svg>
  )
}

/* ── Inline config chips (dropdown lists, no modal) ─────────────────────── */

/** One config dimension as an inline chip whose options drop down. */

type ConfigOptionLike = {
  id: string
  name: string
  currentValue?: string
  allowsCustomValue?: boolean
  choices: Array<{ value: string; name: string }>
}

/** One config dimension as an inline chip whose options drop down. */
function InlineOptionChip({
  option,
  busy,
  onChange,
  minimal,
}: {
  option: ConfigOptionLike
  busy?: boolean
  onChange: (value: string) => void
  /** Minimal chips (effort) show an icon + value only — no dimension name. */
  minimal?: boolean
}) {
  const [open, setOpen] = useState(false)
  const [filter, setFilter] = useState('')
  const [custom, setCustom] = useState('')
  const ref = useRef<HTMLDivElement>(null)

  const choices = option.choices ?? []
  const needle = filter.trim().toLowerCase()
  const filtered = needle ? choices.filter((c) => c.name.toLowerCase().includes(needle) || c.value.toLowerCase().includes(needle)) : choices
  const current = option.currentValue
  const currentLabel = current
    ? (choices.find((c) => c.value === current)?.name ?? current)
    : choices.length === 1
      ? choices[0].name
      : 'Not set'

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        disabled={busy}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-busy={busy}
        title={`${option.name}: ${currentLabel}`}
        className={cn(
          'inline-flex min-h-8 max-w-full shrink-0 items-center gap-1.5 rounded-lg border border-line/50 bg-surface/80 px-2.5',
          'text-[11.5px] transition-all duration-150 hover:bg-hover hover:border-line-strong',
          'disabled:opacity-40',
        )}
      >
        {minimal ? (
          <Brain size={13} className="shrink-0 opacity-70" />
        ) : (
          <span className="shrink-0 opacity-70">{option.name}</span>
        )}
        <span className="min-w-0 max-w-44 truncate font-medium">{currentLabel}</span>
        {busy ? (
          <span className="size-3 shrink-0 animate-spin rounded-full border-2 border-ink-3 border-t-transparent" aria-hidden />
        ) : (
          <ChevronDown size={11} className={cn('shrink-0 opacity-60 transition-transform', open && 'rotate-180')} />
        )}
      </button>

      {open ? (
        <DropdownList anchorRef={ref} onClose={() => setOpen(false)} width={288}>
          {choices.length > 8 ? (
            <div className="border-b border-line/40 p-1.5">
              <input
                autoFocus
                type="search"
                value={filter}
                onChange={(e) => setFilter(e.target.value)}
                placeholder={`Filter ${choices.length} options`}
                aria-label={`Filter ${option.name} options`}
                className="h-7 w-full rounded-md border border-line/60 bg-field px-2 text-[11px] text-ink outline-none placeholder:text-ink-3 focus:border-line-strong"
              />
            </div>
          ) : null}
          <div role="listbox" className="scroll-thin min-h-0 flex-1 overflow-y-auto p-1">
            {filtered.map((choice) => {
              const active = choice.value === current
              return (
                <button
                  key={choice.value}
                  type="button"
                  role="option"
                  aria-selected={active}
                  title={choice.name === choice.value ? undefined : choice.value}
                  onClick={() => {
                    onChange(choice.value)
                    setOpen(false)
                  }}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-control px-2 py-1.5 text-left transition-colors',
                    active ? 'bg-hover' : 'hover:bg-hover-2',
                  )}
                >
                  <Check size={11} strokeWidth={2.6} className={cn('shrink-0', active ? 'text-emerald-400' : 'text-transparent')} />
                  <span className="min-w-0 flex-1 truncate text-[11.5px] text-ink">{choice.name}</span>
                </button>
              )
            })}
            {filtered.length === 0 ? (
              <p className="px-2 py-4 text-center text-[11px] text-ink-3">No matches.</p>
            ) : null}
          </div>
          {/* Custom model id entry — for CLIs whose model flag takes any string. */}
          {option.allowsCustomValue ? (
            <form
              className="flex items-center gap-1.5 border-t border-line/40 p-1.5"
              onSubmit={(e) => {
                e.preventDefault()
                const value = custom.trim()
                if (!value) return
                onChange(value)
                setCustom('')
                setOpen(false)
              }}
            >
              <input
                value={custom}
                onChange={(e) => setCustom(e.target.value)}
                placeholder="Any model id this agent accepts"
                aria-label={`Custom ${option.name}`}
                className="h-7 min-w-0 flex-1 rounded-md border border-line/60 bg-field px-2 font-mono text-[10.5px] text-ink outline-none placeholder:text-ink-3 focus:border-line-strong"
              />
              <button
                type="submit"
                disabled={!custom.trim()}
                className="shrink-0 rounded-md bg-ink px-2 py-1 text-[10.5px] font-medium text-canvas disabled:opacity-40"
              >
                Use
              </button>
            </form>
          ) : null}
        </DropdownList>
      ) : null}
    </div>
  )
}
