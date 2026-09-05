/**
 * LeftSidebar — the session navigator, 304px fixed.
 *
 * Four zones, top to bottom:
 *   1. Workspace — project selector, new-task shortcut, search (pinned).
 *   2. Rooms     — worker channels first; the team above the threads.
 *   3. Sessions  — "Needs you" pinned first, then the recency-sorted list
 *      for the active workspace (the only growing scroll region).
 *   4. Explorer  — the active workspace's file tree (fixed max height, own
 *      scroll). Clicking a file previews it in the right pane.
 *
 * Git branch management lives in the right rail's Git tab, not here: the
 * sidebar switches sessions and browses files; version control has its own
 * surface with diffs.
 */

import { useEffect, useMemo, useState } from 'react'
import {
  Archive,
  Check,
  ChevronDown,
  ChevronRight,
  Files,
  Folder,
  MessagesSquare,
  Plus,
  RefreshCw,
  Search,
  X,
} from 'lucide-react'
import { getConversation, useStore } from '@/store'
import { useOpenFile } from '@/lib/fileViewer'
import { cn, relativeTime } from '@/lib/format'
import { sessionUIState, isInternalSession } from '@/lib/sessionState'
import { NewSessionLayer } from '@/components/SessionList'
import { FileExplorer } from './FileExplorer'
import { RoomsSection } from './RoomsSection'
import type { Session } from '@/types/session'

const ATTENTION = new Set(['approval', 'input', 'failed', 'paused'])
const LIVE = new Set(['working', 'starting', 'resuming'])

function dotFor(uiState: string): string {
  if (uiState === 'failed') return 'bg-red-400'
  if (LIVE.has(uiState)) return 'bg-emerald-400'
  if (ATTENTION.has(uiState)) return 'bg-orange-400'
  return 'bg-zinc-600'
}

export function LeftSidebar({
  session,
  onSelect,
  onOpenFile,
  searchRef,
  fill,
}: {
  session: Session
  onSelect: (id: string) => void
  /** Preview a workspace file in the right pane. */
  onOpenFile: (project: string, path: string) => void
  /** Ref for the search input, so the right-panel Search icon can focus it. */
  searchRef?: React.RefObject<HTMLInputElement | null>
  /** Fit the sidebar to its container instead of a fixed 304px width. Used
   *  when embedded in a constrained surface (the mobile side sheet), where
   *  the fixed desktop width would overflow the phone screen. */
  fill?: boolean
}) {
  const sessions = useStore((s) => s.sessions)
  const connection = useStore((s) => s.connection)
  const deleteSession = useStore((s) => s.deleteSession)
  const archiveSession = useStore((s) => s.archiveSession)
  const openFile = useOpenFile()

  /* ── Workspace selector ─────────────────────────────────────────────── */
  const [activeWorkspace, setActiveWorkspace] = useState<string>(session.project ?? '__inbox__')
  const [dropdownOpen, setDropdownOpen] = useState(false)

  const workspaces = useMemo(() => {
    const grouped = new Map<string, Session[]>()
    for (const s of sessions) {
      if (s.status === 'archived' || isInternalSession(s)) continue
      const key = s.project ?? '__inbox__'
      grouped.set(key, [...(grouped.get(key) ?? []), s])
    }
    return [...grouped.entries()]
      .map(([key, items]) => ({
        key,
        name: key === '__inbox__' ? 'Inbox' : (key.split('/').pop() ?? key),
        full: key === '__inbox__' ? 'No folder' : key,
        count: items.length,
        latest: items.reduce((a, b) => (a > b.updated_at ? a : b.updated_at), ''),
      }))
      .sort((a, b) => b.latest.localeCompare(a.latest))
  }, [sessions])

  useEffect(() => {
    setActiveWorkspace(session.project ?? '__inbox__')
  }, [session.project])

  // Close the workspace menu on outside click / Escape.
  useEffect(() => {
    if (!dropdownOpen) return
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setDropdownOpen(false)
    }
    function onPointer(e: PointerEvent) {
      const el = (e.target as HTMLElement).closest('[data-workspace-menu]')
      if (!el) setDropdownOpen(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onPointer)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onPointer)
    }
  }, [dropdownOpen])

  const activeMeta = workspaces.find((w) => w.key === activeWorkspace)
  const explorerRoot = activeWorkspace === '__inbox__' ? '' : activeWorkspace

  /* ── Search + session rows ──────────────────────────────────────────── */
  const [query, setQuery] = useState('')

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase()
    return sessions
      .filter((s) => s.status !== 'archived' && !isInternalSession(s) && (s.project ?? '__inbox__') === activeWorkspace)
      .filter(
        (s) =>
          !needle ||
          [s.name, s.agent, s.project ?? ''].some((v) => v.toLowerCase().includes(needle)),
      )
      .map((s) => ({ session: s, uiState: sessionUIState(s, getConversation(s.id), connection) }))
      .sort((a, b) => b.session.updated_at.localeCompare(a.session.updated_at))
  }, [sessions, connection, activeWorkspace, query])

  const attention = useMemo(() => rows.filter((r) => ATTENTION.has(r.uiState)), [rows])
  const rest = useMemo(() => rows.filter((r) => !ATTENTION.has(r.uiState)), [rows])

  /* ── Explorer collapse ──────────────────────────────────────────────── */
  const [explorerOpen, setExplorerOpen] = useState(true)
  const [treeTick, setTreeTick] = useState(0)

  /* ── New session ────────────────────────────────────────────────────── */
  const [creating, setCreating] = useState(false)

  function renderRow({ session: s, uiState }: { session: Session; uiState: string }) {
    const active = s.id === session.id
    const needsYou = ATTENTION.has(uiState)
    return (
      <div key={s.id} className="group relative mb-px flex items-center">
        <button
          type="button"
          onClick={() => onSelect(s.id)}
          aria-current={active ? 'true' : undefined}
          title={s.name}
          className={cn(
            'flex h-8 min-w-0 flex-1 items-center gap-2 rounded-lg py-1 pl-2 pr-14 text-left transition-colors duration-100',
            active
              ? 'bg-white/[0.09] text-white ring-1 ring-inset ring-white/[0.08]'
              : needsYou
                ? 'text-zinc-200 hover:bg-white/[0.05]'
                : 'text-zinc-400 hover:bg-white/[0.05] hover:text-zinc-100',
          )}
        >
          <span className={cn('size-1.5 shrink-0 rounded-full', dotFor(uiState), LIVE.has(uiState) && 'animate-pulse')} aria-hidden />
          <span className="min-w-0 flex-1 truncate text-[12px] leading-none">{s.name}</span>
          <span className="shrink-0 font-mono text-[9.5px] tabular-nums text-zinc-600">
            {relativeTime(s.updated_at).replace(' ago', '')}
          </span>
        </button>
        {needsYou && !active ? (
          <span className="pointer-events-none absolute right-2 size-1.5 animate-pulse rounded-full bg-orange-400 group-hover:opacity-0" aria-hidden />
        ) : null}
        {!active ? (
          <>
            <button
              type="button"
              onClick={() => void archiveSession(s.id).catch(() => {})}
              title={`Archive ${s.name}`}
              aria-label={`Archive ${s.name}`}
              className="absolute right-7 hidden rounded p-1 text-zinc-600 hover:bg-white/[0.06] hover:text-zinc-200 group-hover:block"
            >
              <Archive size={12} />
            </button>
            <button
              type="button"
              onClick={() => void deleteSession(s.id).catch(() => {})}
              title={`Stop ${s.name}`}
              aria-label={`Stop ${s.name}`}
              className="absolute right-1 hidden rounded p-1 text-zinc-600 hover:bg-white/[0.06] hover:text-red-400 group-hover:block"
            >
              <X size={12} />
            </button>
          </>
        ) : null}
      </div>
    )
  }

  return (
    <aside
      className={cn(
        'flex flex-col bg-[#191613] text-zinc-100',
        fill ? 'h-full w-full min-w-0 overflow-hidden' : 'w-[304px] shrink-0 border-r border-line/60',
      )}
    >
      {/* ── 1. Workspace ─────────────────────────────────────────────── */}
      <div className="shrink-0 px-2.5 pb-1.5 pt-2.5" data-workspace-menu>
        <div className="flex items-center gap-1.5">
          <div className="relative min-w-0 flex-1">
            <button
              type="button"
              onClick={() => setDropdownOpen((v) => !v)}
              aria-expanded={dropdownOpen}
              aria-haspopup="listbox"
              title={activeWorkspace === '__inbox__' ? 'Inbox' : activeWorkspace}
              className="flex h-9 w-full items-center gap-2 rounded-lg border border-white/[0.08] bg-white/[0.04] px-2.5 text-left transition hover:border-white/[0.14] hover:bg-white/[0.07]"
            >
              <Folder size={13} className="shrink-0 text-zinc-500" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12px] font-medium leading-tight text-zinc-200">
                  {activeMeta?.name ?? 'Inbox'}
                </span>
                <span className="block truncate font-mono text-[9.5px] leading-tight text-zinc-600">
                  {activeMeta ? `${activeMeta.count} session${activeMeta.count === 1 ? '' : 's'}` : ''}
                </span>
              </span>
              <ChevronDown size={13} className={cn('shrink-0 text-zinc-500 transition-transform', dropdownOpen && 'rotate-180')} />
            </button>
            {dropdownOpen ? (
              <div role="listbox" aria-label="Workspaces" className="absolute left-0 right-0 top-full z-30 mt-1 max-h-64 overflow-y-auto scroll-thin rounded-xl border border-white/[0.1] bg-[#2a241e] p-1 shadow-2xl animate-up">
                {workspaces.map((workspace) => (
                  <button
                    key={workspace.key}
                    type="button"
                    role="option"
                    aria-selected={workspace.key === activeWorkspace}
                    title={workspace.full}
                    onClick={() => {
                      setActiveWorkspace(workspace.key)
                      setDropdownOpen(false)
                      setQuery('')
                    }}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left transition',
                      workspace.key === activeWorkspace ? 'bg-white/[0.08] text-white' : 'text-zinc-400 hover:bg-white/[0.05]',
                    )}
                  >
                    <Folder size={12} className="shrink-0 text-zinc-600" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[11.5px]">{workspace.name}</span>
                      <span className="block truncate font-mono text-[9px] text-zinc-600">{workspace.full}</span>
                    </span>
                    <span className="shrink-0 font-mono text-[10px] text-zinc-600">{workspace.count}</span>
                    {workspace.key === activeWorkspace ? <Check size={12} className="shrink-0 text-emerald-400" /> : null}
                  </button>
                ))}
              </div>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => setCreating(true)}
            title="New session in this workspace"
            aria-label="New session"
            className="flex size-9 shrink-0 items-center justify-center rounded-lg bg-accent text-accent-ink transition hover:bg-accent-hover active:scale-95"
          >
            <Plus size={15} />
          </button>
        </div>

        <div className="mt-1.5 flex h-8 items-center gap-1.5 rounded-lg border border-white/[0.07] bg-black/40 px-2 transition-colors focus-within:border-white/[0.18]">
          <Search size={12} className="shrink-0 text-zinc-600" />
          <input
            ref={searchRef}
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search sessions…"
            aria-label="Search sessions"
            className="min-w-0 flex-1 bg-transparent text-[12px] text-zinc-200 outline-none placeholder:text-zinc-600"
          />
          {query ? (
            <button type="button" onClick={() => setQuery('')} aria-label="Clear search" className="rounded p-0.5 text-zinc-600 hover:text-zinc-200">
              <X size={11} />
            </button>
          ) : null}
        </div>
      </div>

      {/* ── 2. Rooms (channels first — the team above the threads) ─────── */}
      <RoomsSection session={{ id: session.id, project: session.project ?? null }} onSelect={onSelect} />

      {/* ── 3. Sessions (the growing scroll region) ────────────────────── */}
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-2 pb-2">
        {attention.length > 0 ? (
          <section aria-label="Needs your attention" className="mt-1">
            <div className="px-2 pb-1">
              <p className="font-mono text-[9.5px] font-medium uppercase tracking-[0.12em] text-orange-300/80">
                Needs you · {attention.length}
              </p>
            </div>
            <div className="rounded-lg border border-orange-400/15 bg-orange-400/[0.04] p-1">
              {attention.map(renderRow)}
            </div>
          </section>
        ) : null}

        <div className="mt-2 flex items-center justify-between px-2 pb-1">
          <p className="flex items-center gap-1.5 font-mono text-[9.5px] font-medium uppercase tracking-[0.12em] text-zinc-600">
            <MessagesSquare size={10} className="text-zinc-500" />
            Sessions{rows.length ? ` · ${rows.length}` : ''}
          </p>
        </div>

        {rows.length === 0 ? (
          <div className="rounded-lg border border-dashed border-white/[0.08] px-3 py-5 text-center">
            <p className="text-[11.5px] font-medium text-zinc-400">{query ? 'No matches' : 'No sessions here yet'}</p>
            <p className="mt-0.5 text-[10.5px] leading-relaxed text-zinc-600">
              {query ? 'Try another search.' : 'Start one with + above.'}
            </p>
          </div>
        ) : attention.length > 0 && rest.length === 0 ? (
          <p className="px-2 py-2 text-[10.5px] text-zinc-600">Everything else is clear.</p>
        ) : (
          rest.map(renderRow)
        )}
      </div>

      {/* ── 4. Explorer ──────────────────────────────────────────────── */}
      <div className="shrink-0 border-t border-white/[0.07]">
        <div className="flex w-full items-center gap-1.5 px-3 pb-1 pt-2">
          <button
            type="button"
            onClick={() => setExplorerOpen((v) => !v)}
            aria-expanded={explorerOpen}
            aria-label={explorerOpen ? 'Collapse explorer' : 'Expand explorer'}
            className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
          >
            <ChevronRight size={12} className={cn('shrink-0 text-zinc-600 transition-transform', explorerOpen && 'rotate-90')} />
            <Files size={11} className="shrink-0 text-zinc-500" />
            <span className="min-w-0 flex-1 truncate font-mono text-[9.5px] font-medium uppercase tracking-[0.12em] text-zinc-600">
              Explorer{activeMeta && explorerRoot ? ` · ${activeMeta.name}` : ''}
            </span>
          </button>
          {explorerOpen && explorerRoot ? (
            <button
              type="button"
              onClick={() => setTreeTick((t) => t + 1)}
              aria-label="Refresh files"
              title="Refresh files"
              className="rounded p-0.5 text-zinc-600 transition hover:bg-white/[0.06] hover:text-zinc-200"
            >
              <RefreshCw size={10} />
            </button>
          ) : null}
        </div>
        {explorerOpen ? (
          <div className="scroll-thin max-h-64 min-h-0 overflow-y-auto px-2 pb-2">
            <FileExplorer
              key={`${explorerRoot}:${treeTick}`}
              root={explorerRoot}
              selectedPath={openFile?.path}
              onOpenFile={(path) => explorerRoot && onOpenFile(explorerRoot, path)}
            />
          </div>
        ) : null}
      </div>

      {/* ── Status footer ────────────────────────────────────────────── */}
      <div className="flex shrink-0 items-center gap-2 border-t border-white/[0.07] px-3 py-2">
        <span
          className={cn('size-1.5 shrink-0 rounded-full', connection === 'connected' ? 'bg-emerald-400' : 'bg-orange-400 animate-pulse')}
          title={connection}
          aria-hidden
        />
        <span className="min-w-0 flex-1 truncate font-mono text-[9.5px] text-zinc-600">
          {rows.length} in {activeMeta?.name ?? 'Inbox'} · {connection}
        </span>
      </div>

      {/* New session layer */}
      {creating ? (
        <NewSessionLayer
          open
          initialProvider={session.agent}
          initialProject={session.project ?? undefined}
          initialStep={2}
          onClose={() => setCreating(false)}
          onCreated={(created) => {
            setCreating(false)
            onSelect(created.id)
          }}
        />
      ) : null}
    </aside>
  )
}
