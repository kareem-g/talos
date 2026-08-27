/**
 * TasksPanel — Progress checklist (real plan state) + Automations card grid.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import {
  ArrowRight,
  Bot,
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
    <section className="m-2 rounded-xl border border-white/[0.07] bg-[#0a0a0c] p-3">
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
    <section className="m-2 rounded-xl border border-white/[0.07] bg-[#0a0a0c] p-3">
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
  onChange,
}: {
  config?: { options: ConfigOptionLike[]; live?: boolean } | undefined
  agent?: string
  modelsSource?: string
  busyId?: string | null
  onChange: (id: string, value: string) => void
}) {
  void agent // no per-agent filtering: every advertised choice stays offered
  void modelsSource
  const ordered = useMemo(() => {
    const options = config?.options ?? []
    // permission_mode is rendered by the dedicated (icon) PermissionChip, not
    // as a generic icon-less config chip — exclude it here to avoid a duplicate.
    const configOptions = options.filter((o) => o.id !== 'permission_mode')
    const isThinking = (o: ConfigOptionLike) => ['effort', 'thinking', 'reasoning'].includes(o.id) || o.id.includes('effort')
    const models = configOptions.filter(isModelOption)
    // Thinking controls sit right after the model; everything else follows.
    const thinking = configOptions.filter((o) => !isModelOption(o) && isThinking(o))
    const rest = configOptions.filter((o) => !isModelOption(o) && !isThinking(o))
    return [...models, ...thinking, ...rest]
  }, [config?.options])

  return (
    <>
      <PermissionChip
        currentMode={config?.options.find((o) => o.id === 'permission_mode')?.currentValue}
        onChange={onChange}
      />
      {ordered.map((option) => (
        <InlineOptionChip key={option.id} option={option} busy={busyId === option.id} onChange={(value) => onChange(option.id, value)} />
      ))}
    </>
  )
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
  const [mode, setMode] = useState<PermissionMode['id']>(() => {
    try {
      const saved = localStorage.getItem(PERMISSION_KEY) as PermissionMode['id'] | null
      return saved && PERMISSION_MODES.some((m) => m.id === saved) ? saved : 'ask'
    } catch {
      return 'ask'
    }
  })
  const select = (id: PermissionMode['id']) => {
    setMode(id)
    try {
      localStorage.setItem(PERMISSION_KEY, id)
    } catch {
      /* storage may be unavailable */
    }
  }
  return { mode, select }
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
  const { mode, select } = usePermissionMode()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  // When the agent reports a live permission mode, reflect it back into the UI.
  const effective = currentMode ?? mode
  const selected = PERMISSION_MODES.find((m) => m.id === effective) ?? PERMISSION_MODES[0]
  const SelectedIcon = selected.icon

  // All four modes send distinct, functional values to the backend.
  // The config_id is 'permission_mode' (AgentDeck-specific), not 'mode' (agent-native).
  const toAgentMode = (id: PermissionMode['id']): string => id

  return (
    <div ref={ref} className="relative shrink-0">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="listbox"
        title={`${selected.label} — ${selected.subtext}`}
        className={cn(
          'inline-flex min-h-8 max-w-full items-center gap-1.5 rounded-lg border border-line/50 bg-surface/80 px-2.5',
          'text-[11.5px] transition-all duration-150 hover:bg-hover hover:border-line-strong',
          open && 'bg-hover border-line-strong',
        )}
      >
        <SelectedIcon size={12} className="shrink-0 text-emerald-400" />
        <span className="max-w-[120px] truncate font-medium">{selected.label}</span>
        <ChevronDown size={11} className={cn('shrink-0 opacity-60 transition-transform', open && 'rotate-180')} />
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

/* ── Inline config chips (dropdown lists, no modal) ─────────────────────── */

/**
 * Anchored option list rendered in a portal (fixed positioning), so the
 * composer's overflow clipping can never hide it. Opens above the anchor,
 * flipping below when there is no room.
 */
function DropdownList({
  anchorRef,
  onClose,
  width = 288,
  children,
}: {
  anchorRef: React.RefObject<HTMLElement | null>
  onClose: () => void
  width?: number
  children: React.ReactNode
}) {
  const [pos, setPos] = useState<{ top: number; left: number; openUp: boolean } | null>(null)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const anchor = anchorRef.current
    if (!anchor) return
    function place() {
      const anchorEl = anchorRef.current
      if (!anchorEl) return
      const rect = anchorEl.getBoundingClientRect()
      const spaceAbove = rect.top
      const spaceBelow = window.innerHeight - rect.bottom
      // Open above unless there's clearly more room below.
      const openUp = spaceAbove >= spaceBelow || spaceAbove > 300
      setPos({
        left: Math.min(Math.max(8, rect.left), Math.max(8, window.innerWidth - width - 8)),
        top: openUp ? rect.top : rect.bottom + 6,
        openUp,
      })
    }
    place()
    function onPointerDown(e: PointerEvent) {
      const target = e.target as Node
      if (listRef.current?.contains(target)) return // inside the list — let the click land
      if (anchorRef.current?.contains(target)) return // clicking the chip toggles it
      onClose()
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('resize', place)
    window.addEventListener('scroll', place, true)
    document.addEventListener('pointerdown', onPointerDown)
    document.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('resize', place)
      window.removeEventListener('scroll', place, true)
      document.removeEventListener('pointerdown', onPointerDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [anchorRef, onClose, width])

  if (!pos) return null

  return createPortal(
    <div
      ref={listRef}
      style={{
        position: 'fixed',
        left: pos.left,
        top: pos.openUp ? undefined : pos.top,
        bottom: pos.openUp ? window.innerHeight - pos.top : undefined,
        maxHeight: pos.openUp ? pos.top - 8 : undefined,
      }}
      className="z-[90]"
    >
      <div
        className="animate-up flex max-h-full flex-col overflow-hidden rounded-card border border-line bg-surface shadow-overlay"
        style={{ width }}
      >
        {children}
      </div>
    </div>,
    document.body,
  )
}

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
}: {
  option: ConfigOptionLike
  busy?: boolean
  onChange: (value: string) => void
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
          'inline-flex min-h-8 max-w-full items-center gap-1.5 rounded-lg border border-line/50 bg-surface/80 px-2.5',
          'text-[11.5px] transition-all duration-150 hover:bg-hover hover:border-line-strong',
          'disabled:opacity-40',
        )}
      >
        <span className="shrink-0 opacity-70">{option.name}</span>
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
