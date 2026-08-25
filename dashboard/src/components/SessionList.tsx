/**
 * Session list, provider rows, and the new-session flow.
 *
 * Providers render exactly what `/api/providers` reports — including
 * unavailable ones with their remedy. A CLI a user believes they have installed
 * should say "not installed", not silently vanish from the list.
 */

import { useEffect, useMemo, useState } from 'react'
import { ConfigControl } from './ConfigControls'
import { DirPicker } from './DirPicker'
import { SyncIcon, SyncLayer } from './SyncSessions'
import {
  Button,
  Check,
  Chip,
  Dot,
  Dots,
  EmptyState,
  IconButton,
  Layer,
  Plus,
  Row,
  Search,
  TextField,
} from './ui'
import { useStore } from '@/store'
import { basename, cn, relativeTime } from '@/lib/format'
import { providerExplanation, type ConfigOption, type Provider } from '@/types/provider'
import { isActive, isBlocked, type Session, type SessionStatus } from '@/types/session'

const STATUS_LABELS: Record<SessionStatus, string> = {
  starting: 'Starting',
  running: 'Working',
  waiting_for_input: 'Needs input',
  waiting_for_approval: 'Needs approval',
  idle: 'Idle',
  needs_resume: 'Needs resume',
  resuming: 'Resuming...',
  error: 'Failed',
  archived: 'Archived',
  exited: 'Stopped',
}

export function statusLabel(status: SessionStatus): string {
  return STATUS_LABELS[status]
}

export function StatusDot({ status }: { status: SessionStatus }) {
  if (isActive(status)) return <Dot tone="green" pulse />
  if (isBlocked(status)) return <Dot tone="orange" />
  if (status === 'error') return <Dot tone="red" />
  if (status === 'resuming') return <Dot tone="orange" pulse />
  return <Dot tone="dim" />
}

/** One session row. Status, name, provider, project, relative time. */
function SessionRow({
  session,
  selected,
  onOpen,
  providerName,
}: {
  session: Session
  selected: boolean
  onOpen: () => void
  providerName: string
}) {
  const active = isActive(session.status) || isBlocked(session.status)
  return (
    <button
      type="button"
      onClick={onOpen}
      aria-current={selected ? 'true' : undefined}
      className={cn(
        'flex min-h-14 w-full items-center gap-2.5 rounded-control px-2.5 py-2 text-left',
        'transition-colors duration-100 hover:bg-hover-2',
        selected && 'bg-hover',
      )}
    >
      <StatusDot status={session.status} />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[12.5px] text-ink">{session.name}</span>
        <span className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11.5px] text-ink-3">
          <span className="truncate">{providerName}</span>
          {session.project ? (
            <>
              <span aria-hidden>·</span>
              <span className="truncate font-mono">{basename(session.project)}</span>
            </>
          ) : null}
          {active ? (
            <>
              <span aria-hidden>·</span>
              <span className={cn('shrink-0', isActive(session.status) && 'text-green')}>
                {statusLabel(session.status)}
              </span>
            </>
          ) : null}
        </span>
      </span>
      <span className="shrink-0 text-[11px] tabular-nums text-ink-3">
        {relativeTime(session.updated_at)}
      </span>
    </button>
  )
}

/** Provider state as a compact trailing chip. */
function ProviderBadge({ provider }: { provider: Provider }) {
  if (provider.state === 'ready') {
    return (
      <Chip tone="default">
        {provider.models.length > 0 ? `${provider.models.length} models` : provider.transport}
      </Chip>
    )
  }
  const labels: Record<string, string> = {
    not_installed: 'Not installed',
    auth_required: 'Sign in',
    config_required: 'Limited',
    error: 'Error',
  }
  return (
    <Chip tone={provider.state === 'error' ? 'red' : 'orange'}>
      {labels[provider.state] ?? provider.state}
    </Chip>
  )
}

/**
 * New-session layer.
 *
 * Settings come from the selected provider's own `configOptions`, so this form
 * has no idea which dimensions exist. A provider reporting one shows one; one
 * reporting three shows three.
 */
export function NewSessionLayer({
  open,
  onClose,
  onCreated,
  initialProvider,
  initialProject,
}: {
  open: boolean
  onClose: () => void
  onCreated: (session: Session) => void
  /** Pre-select an agent — used by quick-launch buttons on the home screen. */
  initialProvider?: string
  initialProject?: string
}) {
  const providers = useStore((state) => state.providers)
  const providersLoading = useStore((state) => state.providersLoading)
  const providersError = useStore((state) => state.providersError)
  const loadProviders = useStore((state) => state.loadProviders)
  const createSession = useStore((state) => state.createSession)
  const setConfig = useStore((state) => state.setConfig)
  const sessions = useStore((state) => state.sessions)

  const [step, setStep] = useState<1 | 2>(1)
  const [providerId, setProviderId] = useState<string>()
  const [project, setProject] = useState('')
  const [prompt, setPrompt] = useState('')
  const [pickerOpen, setPickerOpen] = useState(false)
  /** Chosen values, keyed by the provider's own option ids. */
  const [values, setValues] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  const ready = useMemo(() => providers.filter((p) => p.state === 'ready'), [providers])
  const unavailable = useMemo(() => providers.filter((p) => p.state !== 'ready'), [providers])
  const selected = providers.find((provider) => provider.id === providerId)
  const recentWorkspaces = useMemo(() => {
    const map = new Map<string, number>()
    for (const s of sessions) if (s.project) map.set(s.project, (map.get(s.project) ?? 0) + 1)
    return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([p]) => p)
  }, [sessions])

  // Reset to step 1 on open, and apply initial project/provider
  useEffect(() => {
    if (!open) return
    setStep(1)
    setError(undefined)
    if (initialProject) setProject(initialProject)
    else if (!project && recentWorkspaces[0]) setProject(recentWorkspaces[0])
  }, [open, initialProject, recentWorkspaces])

  // Default to the requested provider, else the first ready one, so the form
  // is immediately usable.
  useEffect(() => {
    if (providerId) return
    const wanted = initialProvider ? ready.find((provider) => provider.id === initialProvider) : undefined
    const fallback = ready.length > 0 ? ready[0].id : undefined
    const next = wanted?.id ?? fallback
    if (next) setProviderId(next)
  }, [providerId, ready, initialProvider])

  // Re-openings with a new quick-launch target must win over a stale choice.
  useEffect(() => {
    if (open && initialProvider) setProviderId(initialProvider)
  }, [open, initialProvider])
  useEffect(() => {
    if (open && initialProject) setProject(initialProject)
  }, [open, initialProject])

  // Reset chosen values when the provider changes: another provider's model id
  // is meaningless here.
  useEffect(() => {
    setValues({})
  }, [providerId])

  const options: ConfigOption[] = useMemo(() => {
    if (!selected) return []
    return selected.configOptions.map((option) => ({
      ...option,
      currentValue: values[option.id] ?? option.currentValue,
    }))
  }, [selected, values])

  async function create() {
    if (!selected) return
    setBusy(true)
    setError(undefined)
    try {
      const session = await createSession({
        agent: selected.id,
        project: project.trim() || undefined,
        prompt: prompt.trim() || undefined,
        name: prompt.trim().split('\n')[0]?.slice(0, 60) || undefined,
        // `model` is accepted at creation and applied before the first prompt.
        model: values.model,
      })
      // Any other dimension the provider exposes is set once the session exists.
      for (const [configId, value] of Object.entries(values)) {
        if (configId === 'model') continue
        await setConfig(session.id, configId, value)
      }
      setPrompt('')
      setValues({})
      onCreated(session)
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not start the session')
    } finally {
      setBusy(false)
    }
  }

  if (!open) return null

  const canGoNext = true // workspace is optional (inbox)
  const canStart = !!selected && !busy

  return (
    <Layer
      open
      onClose={onClose}
      title={step === 1 ? 'New workspace session' : `Start in ${project ? project.split('/').pop() : 'Inbox'}`}
      size="lg"
      footer={
        <div className="flex flex-col gap-2">
          {/* Step indicator */}
          <div className="flex items-center justify-center gap-1.5 pb-1">
            <span className={cn('h-1 w-8 rounded-full transition-colors', step === 1 ? 'bg-white' : 'bg-white/20')} />
            <span className={cn('h-1 w-8 rounded-full transition-colors', step === 2 ? 'bg-white' : 'bg-white/20')} />
            <span className="ml-2 font-mono text-[11px] text-ink-3">Step {step} of 2</span>
          </div>
          {error ? <p className="text-[11.5px] text-red">{error}</p> : null}
          <div className="flex gap-2">
            {step === 2 ? (
              <Button variant="surface" onClick={() => setStep(1)} className="min-h-10 flex-1">
                Back
              </Button>
            ) : null}
            {step === 1 ? (
              <Button variant="primary" onClick={() => setStep(2)} disabled={!canGoNext} className="min-h-10 flex-1">
                Next — choose agent
              </Button>
            ) : (
              <Button variant="primary" onClick={() => void create()} disabled={!canStart} className="min-h-10 flex-1">
                {busy ? 'Starting…' : 'Start session'}
              </Button>
            )}
          </div>
        </div>
      }
    >
      {step === 1 ? (
        <div className="flex flex-col gap-4 px-1 py-1">
          <div className="space-y-1 px-1">
            <h3 className="text-[13px] font-semibold text-white">Where should the agent work?</h3>
            <p className="font-mono text-[11px] leading-[1.5] text-zinc-400">Each workspace is an isolated folder & branch. Pick a project or use Inbox for quick tasks.</p>
          </div>

          <label className="block space-y-2">
            <span className="flex items-center justify-between">
              <span className="font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-zinc-400">Project directory</span>
              <button type="button" onClick={() => setPickerOpen(true)} className="rounded-full border border-white/10 bg-white/5 px-2.5 py-1 font-mono text-[11px] text-zinc-300 transition hover:bg-white/10">
                Browse…
              </button>
            </span>
            <TextField value={project} onChange={(e) => setProject(e.target.value)} placeholder="/path/to/project — or leave empty for Inbox" className="bg-black/20" />
            <span className="block font-mono text-[10px] text-zinc-500">Leave empty to use Inbox. You can change this later.</span>
          </label>

          {recentWorkspaces.length > 0 ? (
            <div className="space-y-1.5">
              <span className="px-1 font-mono text-[11px] font-medium uppercase tracking-[0.08em] text-zinc-400">Recent workspaces</span>
              <div className="grid gap-1.5">
                {recentWorkspaces.map((p) => (
                  <button
                    key={p}
                    type="button"
                    onClick={() => setProject(p)}
                    className={cn('flex items-center gap-2 rounded-xl border px-3 py-2.5 text-left transition', project === p ? 'border-white/20 bg-white/10' : 'border-white/10 bg-white/[0.02] hover:bg-white/5')}
                  >
                    <span className="flex size-7 items-center justify-center rounded-lg bg-white/5 text-zinc-400">⌘</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[12.5px] font-medium text-white">{p.split('/').pop()}</span>
                      <span className="block truncate font-mono text-[11px] text-zinc-500">{p}</span>
                    </span>
                    {project === p ? <Check size={14} className="text-white" /> : null}
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          <button type="button" onClick={() => setProject('')} className={cn('rounded-xl border px-3 py-2.5 text-left transition', !project ? 'border-white/20 bg-white/10' : 'border-white/5 bg-transparent hover:bg-white/5')}>
            <span className="block text-[12.5px] font-medium text-white">Inbox — no folder</span>
            <span className="block font-mono text-[11px] text-zinc-500">Quick tasks, no git worktree</span>
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-4 px-1 py-1">
          <div className="rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2.5">
            <div className="flex items-center gap-2">
              <span className="flex size-6 items-center justify-center rounded-full bg-white text-[10px] font-bold text-black">↗</span>
              <span className="truncate font-mono text-[11px] text-zinc-300">{project || 'Inbox — no folder'}</span>
              <button type="button" onClick={() => setStep(1)} className="ml-auto font-mono text-[11px] text-white underline decoration-white/20 underline-offset-4 hover:decoration-white/40">
                Change
              </button>
            </div>
          </div>

          <section className="space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.08em] text-zinc-400">Agent</span>
              <button type="button" onClick={() => void loadProviders(true)} className="rounded-full bg-white/5 px-2 py-1 font-mono text-[11px] text-zinc-400 hover:bg-white/10">
                Rescan
              </button>
            </div>
            {providersLoading && providers.length === 0 ? (
              <div className="rounded-xl border border-white/10 bg-black/20 p-4">
                <Dots label="Detecting agents…" />
              </div>
            ) : null}
            {providersError ? <p className="rounded-xl border border-red-500/20 bg-red-500/5 px-3 py-2 font-mono text-[11.5px] text-red-400">{providersError}</p> : null}
            <div className="grid gap-1.5">
              {ready.map((provider) => (
                <button
                  key={provider.id}
                  type="button"
                  onClick={() => setProviderId(provider.id)}
                  className={cn('flex items-center gap-3 rounded-xl border px-3 py-3 text-left transition', providerId === provider.id ? 'border-white bg-white text-black' : 'border-white/10 bg-white/[0.03] hover:bg-white/5 hover:border-white/15')}
                >
                  <span className={cn('flex size-8 items-center justify-center rounded-lg text-[11px] font-bold', providerId === provider.id ? 'bg-black text-white' : 'bg-white/10 text-white')}>{provider.name[0]}</span>
                  <span className="min-w-0 flex-1">
                    <span className={cn('block text-[13px] font-semibold', providerId === provider.id ? 'text-black' : 'text-white')}>{provider.name}</span>
                    <span className={cn('block truncate font-mono text-[11px]', providerId === provider.id ? 'text-black/60' : 'text-zinc-500')}>{provider.version ?? provider.id} · {provider.models.length} models</span>
                  </span>
                  {providerId === provider.id ? <Check size={16} className="text-black" /> : <span className="size-2 rounded-full bg-white/20" />}
                </button>
              ))}
            </div>
            {ready.length === 0 && !providersLoading ? (
              <p className="rounded-xl border border-white/5 bg-black/20 px-3 py-3 font-mono text-[12px] leading-[1.6] text-zinc-500">No agent is ready. Install one to continue.</p>
            ) : null}
            {unavailable.length > 0 ? (
              <details className="rounded-xl border border-white/5 bg-black/10">
                <summary className="cursor-pointer list-none px-3 py-2 font-mono text-[11px] text-zinc-500 hover:text-zinc-300">{unavailable.length} unavailable</summary>
                <div className="space-y-1 p-2 pt-0">
                  {unavailable.map((p) => (
                    <Row key={p.id} disabled primary={p.name} secondary={providerExplanation(p)} trailing={<ProviderBadge provider={p} />} />
                  ))}
                </div>
              </details>
            ) : null}
          </section>

          {options.length > 0 ? (
            <section className="space-y-2 rounded-xl border border-white/5 bg-black/20 p-3">
              <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.08em] text-zinc-400">Model & settings</span>
              <div className="flex flex-wrap gap-1.5 pt-1">
                {options.map((option) => (
                  <ConfigControl key={option.id} option={option} source={option.id === 'model' ? selected?.modelsSource : undefined} onChange={(v) => setValues((prev) => ({ ...prev, [option.id]: v }))} />
                ))}
              </div>
            </section>
          ) : null}

          <label className="block space-y-2">
            <span className="font-mono text-[11px] font-semibold uppercase tracking-[0.08em] text-zinc-400">First message — what should the agent do?</span>
            <textarea
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
              rows={4}
              placeholder="e.g., Fix the auth bug, add tests for the new API, or just say hi to keep it warm…"
              className="min-h-[96px] w-full resize-none rounded-xl border border-white/10 bg-black/30 px-3 py-3 text-[13px] leading-[1.6] text-white outline-none transition placeholder:text-zinc-500 focus:border-white/20 focus:bg-black/40"
            />
            <span className="block font-mono text-[10px] text-zinc-500">Leave empty to start an empty session — you can send the first message later.</span>
          </label>
        </div>
      )}

      <DirPicker
        open={pickerOpen}
        onClose={() => setPickerOpen(false)}
        onPick={setProject}
      />
    </Layer>
  )
}

/** The session list. */
export function SessionList({
  selectedId,
  onSelect,
}: {
  selectedId?: string
  onSelect: (session: Session) => void
}) {
  const sessions = useStore((state) => state.sessions)
  const loading = useStore((state) => state.sessionsLoading)
  const providers = useStore((state) => state.providers)
  const [creating, setCreating] = useState(false)
  const [syncing, setSyncing] = useState(false)
  const [filter, setFilter] = useState('')

  const visible = useMemo(() => {
    const listed = sessions.filter((session) => session.status !== 'archived')
    const needle = filter.trim().toLowerCase()
    if (!needle) return listed
    return listed.filter(
      (session) =>
        session.name.toLowerCase().includes(needle) ||
        session.agent.toLowerCase().includes(needle) ||
        (session.project ?? '').toLowerCase().includes(needle),
    )
  }, [sessions, filter])

  /**
   * Active sessions first, then newest.
   *
   * The tiebreaker is `created_at`, deliberately not `updated_at`: a streaming
   * session's `updated_at` changes constantly, which would reshuffle rows under
   * the user's finger mid-tap. Creation order is stable, so a row stays put
   * unless its status actually changes.
   */
  const ordered = useMemo(() => {
    return [...visible].sort((a, b) => {
      const aActive = isActive(a.status) || isBlocked(a.status)
      const bActive = isActive(b.status) || isBlocked(b.status)
      if (aActive !== bActive) return aActive ? -1 : 1
      return b.created_at.localeCompare(a.created_at)
    })
  }, [visible])

  function providerName(agentId: string): string {
    return providers.find((provider) => provider.id === agentId)?.name ?? agentId
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center gap-1.5 px-2.5 pb-2">
        <TextField
          type="search"
          value={filter}
          onChange={(changeEvent) => setFilter(changeEvent.target.value)}
          placeholder="Search sessions"
          aria-label="Search sessions"
          leading={<Search />}
          className="min-w-0 flex-1"
        />
        <IconButton label="Sync sessions from your CLIs" onClick={() => setSyncing(true)}>
          <SyncIcon />
        </IconButton>
        <IconButton label="New session" tone="accent" onClick={() => setCreating(true)}>
          <Plus />
        </IconButton>
      </div>

      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto overscroll-contain px-1.5 pb-2">
        {loading && sessions.length === 0 ? (
          <div className="px-2.5 py-3">
            <Dots label="Loading sessions…" />
          </div>
        ) : ordered.length === 0 ? (
          <EmptyState
            title={sessions.length === 0 ? 'No sessions yet' : 'No matches'}
            description={
              sessions.length === 0
                ? 'Start an agent here, or import the sessions your CLIs already have.'
                : undefined
            }
            action={
              sessions.length === 0 ? (
                <div className="flex flex-wrap justify-center gap-1.5">
                  <Button variant="primary" onClick={() => setCreating(true)}>
                    <Plus />
                    New session
                  </Button>
                  <Button onClick={() => setSyncing(true)}>
                    <SyncIcon size={12} />
                    Sync from CLIs
                  </Button>
                </div>
              ) : undefined
            }
          />
        ) : (
          ordered.map((session) => (
            <SessionRow
              key={session.id}
              session={session}
              selected={session.id === selectedId}
              onOpen={() => onSelect(session)}
              providerName={providerName(session.agent)}
            />
          ))
        )}
      </div>

      <NewSessionLayer open={creating} onClose={() => setCreating(false)} onCreated={onSelect} />
      <SyncLayer open={syncing} onClose={() => setSyncing(false)} />
    </div>
  )
}
