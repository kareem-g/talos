/**
 * Session list, provider rows, and the new-session flow.
 *
 * Providers render exactly what `/api/providers` reports — including
 * unavailable ones with their remedy. A CLI a user believes they have installed
 * should say "not installed", not silently vanish from the list.
 */

import { useEffect, useMemo, useState } from 'react'
import { ConfigControl } from './ConfigControls'
import { SyncIcon, SyncLayer } from './SyncSessions'
import {
  Button,
  Chip,
  Dot,
  Dots,
  EmptyState,
  IconButton,
  Layer,
  Plus,
  Row,
  Search,
  SectionLabel,
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
  needs_resume: 'Resumable',
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
function NewSessionLayer({
  open,
  onClose,
  onCreated,
}: {
  open: boolean
  onClose: () => void
  onCreated: (session: Session) => void
}) {
  const providers = useStore((state) => state.providers)
  const providersLoading = useStore((state) => state.providersLoading)
  const providersError = useStore((state) => state.providersError)
  const loadProviders = useStore((state) => state.loadProviders)
  const createSession = useStore((state) => state.createSession)
  const setConfig = useStore((state) => state.setConfig)

  const [providerId, setProviderId] = useState<string>()
  const [project, setProject] = useState('')
  const [prompt, setPrompt] = useState('')
  /** Chosen values, keyed by the provider's own option ids. */
  const [values, setValues] = useState<Record<string, string>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  const ready = useMemo(() => providers.filter((p) => p.state === 'ready'), [providers])
  const unavailable = useMemo(() => providers.filter((p) => p.state !== 'ready'), [providers])
  const selected = providers.find((provider) => provider.id === providerId)

  // Default to the first ready provider so the form is immediately usable.
  useEffect(() => {
    if (!providerId && ready.length > 0) setProviderId(ready[0].id)
  }, [providerId, ready])

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

  return (
    <Layer
      open
      onClose={onClose}
      title="New session"
      size="lg"
      footer={
        <div className="flex flex-col gap-2">
          {error ? <p className="text-[11.5px] text-red">{error}</p> : null}
          <Button
            variant="primary"
            onClick={() => void create()}
            disabled={!selected || busy}
            className="min-h-10 w-full"
          >
            {busy ? 'Starting…' : 'Start session'}
          </Button>
        </div>
      }
    >
      <section>
        <div className="flex items-center justify-between pr-1">
          <SectionLabel>Agent</SectionLabel>
          <button
            type="button"
            onClick={() => void loadProviders(true)}
            className="rounded-[6px] px-1.5 py-1 text-[11px] text-ink-3 transition-colors hover:bg-hover-2 hover:text-ink"
          >
            Rescan
          </button>
        </div>

        {providersLoading && providers.length === 0 ? (
          <div className="px-2.5 py-3">
            <Dots label="Detecting installed agents…" />
          </div>
        ) : null}
        {providersError ? (
          <p className="px-2.5 py-2 text-[11.5px] text-red">{providersError}</p>
        ) : null}

        {ready.map((provider) => (
          <Row
            key={provider.id}
            selected={provider.id === providerId}
            onSelect={() => setProviderId(provider.id)}
            primary={provider.name}
            secondary={provider.version}
            trailing={<ProviderBadge provider={provider} />}
          />
        ))}

        {ready.length === 0 && !providersLoading ? (
          <p className="px-2.5 py-3 text-[12px] leading-[1.6] text-ink-3">
            No agent CLI is ready on this machine. Install one, or check the list below for what
            needs attention.
          </p>
        ) : null}

        {unavailable.length > 0 ? (
          <details>
            <summary className="cursor-pointer list-none px-2.5 py-2 text-[11.5px] text-ink-3 transition-colors hover:text-ink-2">
              {unavailable.length} unavailable
            </summary>
            {unavailable.map((provider) => (
              <Row
                key={provider.id}
                disabled
                primary={provider.name}
                secondary={providerExplanation(provider)}
                trailing={<ProviderBadge provider={provider} />}
              />
            ))}
          </details>
        ) : null}
      </section>

      {options.length > 0 ? (
        <section>
          <SectionLabel>Settings</SectionLabel>
          <div className="flex flex-wrap gap-1.5 px-2.5 pb-1">
            {options.map((option) => (
              <ConfigControl
                key={option.id}
                option={option}
                source={option.id === 'model' ? selected?.modelsSource : undefined}
                onChange={(value) =>
                  setValues((previous) => ({ ...previous, [option.id]: value }))
                }
              />
            ))}
          </div>
        </section>
      ) : null}

      <section className="flex flex-col gap-2 px-2.5 pb-1 pt-2">
        <label className="block">
          <span className="block pb-1.5 text-[11.5px] text-ink-3">Project directory</span>
          <TextField
            value={project}
            onChange={(changeEvent) => setProject(changeEvent.target.value)}
            placeholder="/path/to/project"
          />
        </label>
        <label className="block">
          <span className="block pb-1.5 text-[11.5px] text-ink-3">First message</span>
          <textarea
            value={prompt}
            onChange={(changeEvent) => setPrompt(changeEvent.target.value)}
            rows={3}
            placeholder="What should the agent do?"
            className="w-full resize-none rounded-control border border-line bg-field px-2.5 py-2 text-[12.5px] leading-[1.6] text-ink outline-none transition-colors focus:border-line-strong placeholder:text-ink-3"
          />
        </label>
      </section>
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
