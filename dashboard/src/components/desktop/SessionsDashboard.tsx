import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Chip, Dots, IconButton, Search, TextField } from '../ui'
import { useStore, getConversation } from '@/store'
import { relativeTime, cn } from '@/lib/format'
import { isActive, isBlocked, type Session } from '@/types/session'
import { basename } from '@/lib/format'
import { StatusDot, statusLabel } from '../SessionList'
import { useRoute } from '@/lib/route'

type Filter = 'all' | 'recent' | 'starred' | 'archived'
type Sort = 'modified' | 'created' | 'name'
type View = 'list' | 'grid'

const STARRED_KEY = 'agentdeck-starred'
const VIEW_KEY = 'agentdeck-desktop-view'

function loadStarred(): Set<string> {
  try {
    const raw = localStorage.getItem(STARRED_KEY)
    if (!raw) return new Set()
    return new Set(JSON.parse(raw) as string[])
  } catch {
    return new Set()
  }
}
function saveStarred(set: Set<string>) {
  try {
    localStorage.setItem(STARRED_KEY, JSON.stringify([...set]))
  } catch {}
}

function previewSnippet(session: Session): string {
  const conv = getConversation(session.id)
  for (let i = conv.messages.length - 1; i >= 0; i--) {
    const m = conv.messages[i]
    if (m.role === 'user' || m.role === 'assistant') {
      const text = m.parts
        .filter((p) => p.kind === 'text')
        .map((p) => (p as { text: string }).text)
        .join(' ')
        .trim()
      if (text) return text.slice(0, 100)
    }
  }
  return session.project ?? session.agent
}

export function SessionsDashboard() {
  const sessions = useStore((s) => s.sessions)
  const providers = useStore((s) => s.providers)
  const loading = useStore((s) => s.sessionsLoading)
  const createSession = useStore((s) => s.createSession)
  const deleteSession = useStore((s) => s.deleteSession)
  const { navigate } = useRoute()

  const [search, setSearch] = useState('')
  const [filter, setFilter] = useState<Filter>('all')
  const [sort, setSort] = useState<Sort>('modified')
  const [view, setView] = useState<View>(() => {
    try {
      const v = localStorage.getItem(VIEW_KEY)
      return v === 'grid' || v === 'list' ? (v as View) : 'list'
    } catch {
      return 'list'
    }
  })
  const [starred, setStarred] = useState<Set<string>>(() => loadStarred())
  const searchRef = useRef<HTMLInputElement>(null)
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    try {
      localStorage.setItem(VIEW_KEY, view)
    } catch {}
  }, [view])

  const toggleStar = (id: string) => {
    setStarred((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      saveStarred(next)
      return next
    })
  }

  const filtered = useMemo(() => {
    let list = [...sessions]
    if (filter === 'archived') list = list.filter((s) => s.status === 'archived')
    else if (filter === 'starred') list = list.filter((s) => starred.has(s.id) && s.status !== 'archived')
    else if (filter === 'recent') {
      const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000
      list = list.filter((s) => new Date(s.updated_at).getTime() > weekAgo && s.status !== 'archived')
    } else list = list.filter((s) => s.status !== 'archived')

    const needle = search.trim().toLowerCase()
    if (needle) {
      list = list.filter(
        (s) =>
          s.name.toLowerCase().includes(needle) ||
          (s.project ?? '').toLowerCase().includes(needle) ||
          s.agent.toLowerCase().includes(needle) ||
          previewSnippet(s).toLowerCase().includes(needle),
      )
    }

    list.sort((a, b) => {
      if (sort === 'name') return a.name.localeCompare(b.name)
      if (sort === 'created') return b.created_at.localeCompare(a.created_at)
      return b.updated_at.localeCompare(a.updated_at)
    })
    // Active first within same sort? Keep spec optional – we keep stable sorts
    return list
  }, [sessions, filter, search, sort, starred])

  const providerName = (agentId: string) => providers.find((p) => p.id === agentId)?.name ?? agentId

  const handleNewSession = async () => {
    if (creating) return
    setCreating(true)
    try {
      // pick first ready provider or fallback
      const prov = providers.find((p) => p.state === 'ready') ?? providers[0]
      if (!prov) return
      const session = await createSession({ agent: prov.id, name: 'New Session' })
      navigate({ name: 'session', sessionId: session.id })
    } finally {
      setCreating(false)
    }
  }

  // Keyboard shortcuts for Screen1: Cmd+N -> new, Cmd+K -> search
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'n') {
        e.preventDefault()
        void handleNewSession()
      }
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        searchRef.current?.focus()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  return (
    <div className="flex min-w-0 flex-1 flex-col bg-canvas">
      {/* Top bar */}
      <div className="flex h-[56px] shrink-0 items-center gap-3 border-b border-line bg-canvas px-6">
        <h1 className="text-[15px] font-medium tracking-[-0.01em] text-ink">Sessions</h1>
        <div className="ml-2 flex min-w-0 max-w-[420px] flex-1">
          <TextField
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name, date or tag"
            aria-label="Search sessions"
            leading={<Search />}
            className="w-full"
          />
        </div>
        <div className="ml-auto flex items-center gap-2">
          <span className="hidden text-[11px] text-ink-3 lg:inline">
            {filtered.length} {filtered.length === 1 ? 'session' : 'sessions'}
          </span>
          <Button variant="primary" onClick={() => void handleNewSession()} disabled={creating} className="h-9 rounded-[8px] px-4 text-[13px]">
            {creating ? 'Creating…' : 'New Session'}
          </Button>
        </div>
      </div>

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-line bg-inset px-6 py-2.5">
        <div className="flex items-center gap-1.5">
          {(['all', 'recent', 'starred', 'archived'] as Filter[]).map((f) => (
            <button
              key={f}
              type="button"
              onClick={() => setFilter(f)}
              className={cn(
                'rounded-full border px-3 py-1 text-[12px] font-medium transition-colors',
                filter === f ? 'border-accent bg-accent-tint text-ink' : 'border-line bg-surface text-ink-2 hover:bg-hover',
              )}
            >
              {f === 'all' ? 'All' : f === 'recent' ? 'Recent' : f === 'starred' ? 'Starred' : 'Archived'}
            </button>
          ))}
        </div>
        <div className="ml-auto flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-[11.5px] text-ink-3">
            Sort
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value as Sort)}
              className="rounded-control border border-line bg-surface px-2 py-1 text-[12px] text-ink outline-none focus:border-line-strong"
            >
              <option value="modified">Last modified</option>
              <option value="created">Created</option>
              <option value="name">Name A–Z</option>
            </select>
          </label>
          <div className="ml-1 flex rounded-control border border-line bg-surface p-0.5">
            <button
              type="button"
              aria-label="List view"
              onClick={() => setView('list')}
              className={cn('rounded-[6px] px-2 py-1 text-[11px]', view === 'list' ? 'bg-hover text-ink' : 'text-ink-3')}
            >
              List
            </button>
            <button
              type="button"
              aria-label="Grid view"
              onClick={() => setView('grid')}
              className={cn('rounded-[6px] px-2 py-1 text-[11px]', view === 'grid' ? 'bg-hover text-ink' : 'text-ink-3')}
            >
              Grid
            </button>
          </div>
        </div>
      </div>

      {/* Content */}
      <div className="scroll-thin flex-1 overflow-y-auto bg-inset p-6">
        {loading && sessions.length === 0 ? (
          <div className="flex h-40 items-center justify-center">
            <Dots label="Loading sessions…" />
          </div>
        ) : filtered.length === 0 ? (
          <div className="mx-auto flex max-w-[560px] flex-col items-center justify-center gap-3 rounded-card border border-line bg-surface px-8 py-12 text-center shadow-hairline">
            <span className="flex size-10 items-center justify-center rounded-full bg-inset text-ink-3">
              <GridIcon />
            </span>
            <p className="text-[13px] font-medium text-ink">No sessions yet. Start a new session to begin.</p>
            <p className="max-w-[420px] text-[12px] leading-[1.6] text-ink-3">
              Sessions are isolated workspaces for your agents. Create one to start collaborating.
            </p>
            <Button variant="primary" onClick={() => void handleNewSession()} className="mt-1">
              New Session
            </Button>
          </div>
        ) : view === 'list' ? (
          <div className="mx-auto flex max-w-[900px] flex-col gap-2">
            {filtered.map((s) => (
              <SessionRowCard
                key={s.id}
                session={s}
                preview={previewSnippet(s)}
                providerName={providerName(s.agent)}
                starred={starred.has(s.id)}
                onToggleStar={() => toggleStar(s.id)}
                onOpen={() => navigate({ name: 'session', sessionId: s.id })}
                onDelete={async () => {
                  if (confirm(`Delete "${s.name}"?`)) await deleteSession(s.id)
                }}
                onArchive={async () => {
                  // archive via status update – use store? For now delete toast
                  await deleteSession(s.id)
                }}
              />
            ))}
          </div>
        ) : (
          <div className="mx-auto grid max-w-[1100px] grid-cols-2 gap-3 xl:grid-cols-3">
            {filtered.map((s) => (
              <SessionGridCard
                key={s.id}
                session={s}
                preview={previewSnippet(s)}
                providerName={providerName(s.agent)}
                starred={starred.has(s.id)}
                onToggleStar={() => toggleStar(s.id)}
                onOpen={() => navigate({ name: 'session', sessionId: s.id })}
              />
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function SessionRowCard({
  session,
  preview,
  providerName,
  starred,
  onToggleStar,
  onOpen,
  onDelete,
}: {
  session: Session
  preview: string
  providerName: string
  starred: boolean
  onToggleStar: () => void
  onOpen: () => void
  onDelete?: () => void
  onArchive?: () => void
}) {
  const active = isActive(session.status) || isBlocked(session.status)
  return (
    <button
      type="button"
      onClick={onOpen}
      onDoubleClick={() => {
        const next = prompt('Rename session', session.name)
        if (next && next !== session.name) {
          // inline rename – store lacks rename, would need API; stub for UX
          // keep as future – show notice
        }
      }}
      className="group flex items-center gap-3 rounded-card border border-line bg-surface px-4 py-3 text-left shadow-hairline transition-colors hover:border-line-strong hover:bg-hover"
    >
      <StatusDot status={session.status} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-1.5">
          <span className="truncate text-[13px] font-medium text-ink">{session.name}</span>
          {starred ? <span className="text-[11px] text-orange">★</span> : null}
          <span className={cn('ml-1 hidden text-[11px] sm:inline', active ? 'text-green' : 'text-ink-3')}>{statusLabel(session.status)}</span>
        </span>
        <span className="mt-0.5 line-clamp-1 block text-[12px] leading-[1.5] text-ink-3">{preview}</span>
        <span className="mt-1 flex flex-wrap items-center gap-1.5">
          <Chip mono tone="default">{providerName}</Chip>
          {session.project ? <Chip mono>{basename(session.project)}</Chip> : null}
          <span className="text-[11px] text-ink-3">{relativeTime(session.updated_at)}</span>
        </span>
      </span>
      <span className="hidden items-center gap-1 opacity-0 transition-opacity group-hover:opacity-100 sm:flex" onClick={(e) => e.stopPropagation()}>
        <IconButton label={starred ? 'Unstar' : 'Star'} onClick={onToggleStar} className="size-8">
          <span className={starred ? 'text-orange' : 'text-ink-3'}>{starred ? '★' : '☆'}</span>
        </IconButton>
        <IconButton label="Delete" onClick={onDelete}>
          <TrashIcon />
        </IconButton>
      </span>
    </button>
  )
}

function SessionGridCard({
  session,
  preview,
  providerName,
  starred,
  onToggleStar,
  onOpen,
}: {
  session: Session
  preview: string
  providerName: string
  starred: boolean
  onToggleStar: () => void
  onOpen: () => void
}) {
  return (
    <button
      type="button"
      onClick={onOpen}
      className="group flex flex-col gap-2 rounded-card border border-line bg-surface p-4 text-left shadow-hairline transition-colors hover:border-line-strong"
    >
      <span className="flex items-start justify-between gap-2">
        <span className="flex items-center gap-2">
          <StatusDot status={session.status} />
          <span className="line-clamp-1 text-[13px] font-medium text-ink">{session.name}</span>
        </span>
        <span
          onClick={(e) => {
            e.stopPropagation()
            onToggleStar()
          }}
          className={cn('text-[12px]', starred ? 'text-orange' : 'text-ink-3 opacity-0 group-hover:opacity-100')}
        >
          {starred ? '★' : '☆'}
        </span>
      </span>
      <span className="line-clamp-2 min-h-[36px] text-[12px] leading-[1.6] text-ink-3">{preview || 'No preview'}</span>
      <span className="flex flex-wrap items-center gap-1.5 pt-1">
        <Chip tone="default">{providerName}</Chip>
        <span className="text-[11px] text-ink-3">{relativeTime(session.updated_at)}</span>
      </span>
    </button>
  )
}

function TrashIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M3 6h18" />
      <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
      <path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
    </svg>
  )
}
function GridIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
    </svg>
  )
}
