/**
 * SessionChat — the unified screen's center pane: one session's conversation.
 *
 * Header  — the session title (inline-editable), Share, the Browser toggle
 *           (shows/hides the tool panel), and an overflow menu (star, export,
 *           delete).
 * Body    — the transcript (Timeline) with the floating contexture HUD.
 * Bottom  — the StateZone composer: the reference's sleek bar with the model
 *           chip docked beside the send button.
 *
 * Everything is wired exactly like the old SessionWorkspace: same send
 * handlers, same config setters, same rooms. Only the scaffold is new.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { Check, Globe, Share2 } from 'lucide-react'
import { cn } from '@/lib/format'
import { useConversation, useStore } from '@/store'
import { useRooms } from '@/lib/rooms'
import { createSessionSendHandlers } from '@/lib/sessionCommands'
import type { Session } from '@/types/session'
import type { RightTabType } from './desktop/session/rightTabs'
import { FloatingHud } from './desktop/session/FloatingHud'
import { RoomAvatarStack } from './desktop/RoomAvatars'
import { StateZone } from './StateZone'
import { Timeline } from './Timeline'

const AGENT_HUES = ['#6396cc', '#a78bfa', '#4fae7c', '#e07a5f', '#d96a8a', '#7fa8d8']

function hueFor(id: string): string {
  let hash = 0
  for (let index = 0; index < id.length; index += 1) {
    hash = (hash * 31 + id.charCodeAt(index)) >>> 0
  }
  return AGENT_HUES[hash % AGENT_HUES.length]
}

export function SessionChat({
  session,
  onOpenSession,
  onExitSession,
  panelOpen,
  onTogglePanel,
  onRevealTab,
}: {
  session: Session
  /** Switch to another session (side sessions, subsessions) in place. */
  onOpenSession?: (sessionId: string) => void
  /** Leave the session back to the dashboard (after delete). */
  onExitSession: () => void
  panelOpen: boolean
  onTogglePanel: () => void
  /** Open a specific tool-panel tab (revealing the panel if collapsed). */
  onRevealTab: (tab: RightTabType) => void
}) {
  const rooms = useRooms()
  const conversation = useConversation(session.id)
  const config = useStore((s) => s.configs[session.id])
  const notice = useStore((s) => s.notices[session.id])
  const connection = useStore((s) => s.connection)
  const providers = useStore((s) => s.providers)
  const openSession = useStore((s) => s.openSession)
  const setConfig = useStore((s) => s.setConfig)
  const dismissNotice = useStore((s) => s.dismissNotice)
  const deleteSession = useStore((s) => s.deleteSession)
  const toggleStar = useStore((s) => s.toggleStar)
  const starred = useStore((s) => s.isStarred(session.id))

  const roomOfSession = rooms.find((room) => room.sessionId === session.id) ?? null
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState(session.name)
  const titleInputRef = useRef<HTMLInputElement>(null)
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const [restartingForConfig, setRestartingForConfig] = useState(false)
  const [shared, setShared] = useState(false)

  // Same send wiring as every other shell: /orchestrator, #room, @worker,
  // /side, /btw run through the shared handlers.
  const { send: handleSend, queue: handleQueue } = createSessionSendHandlers(session, {
    openSessionView: (id) => onOpenSession?.(id),
    revealSideSession: () => {
      if (!panelOpen) onTogglePanel()
      onRevealTab('side')
    },
  })

  useEffect(() => {
    void openSession(session.id)
  }, [session.id, openSession])

  useEffect(() => {
    if (editingTitle) titleInputRef.current?.focus()
  }, [editingTitle])

  // Click-outside closes the overflow menu.
  useEffect(() => {
    if (!menuOpen) return
    function onPointerDown(event: PointerEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false)
      }
    }
    document.addEventListener('pointerdown', onPointerDown)
    return () => document.removeEventListener('pointerdown', onPointerDown)
  }, [menuOpen])

  const provider = useMemo(() => providers.find((p) => p.id === session.agent), [providers, session.agent])

  async function restartForConfig() {
    setRestartingForConfig(true)
    try {
      await useStore.getState().resumeSession(session.id)
      dismissNotice(session.id)
    } finally {
      setRestartingForConfig(false)
    }
  }

  function revealTab(tab: RightTabType) {
    if (!panelOpen) onTogglePanel()
    onRevealTab(tab)
  }

  return (
    <div className="flex h-full min-w-0 flex-1 flex-col bg-canvas text-ink">
      {/* ── Notice banner ─────────────────────────────────────────────────── */}
      {notice ? (
        <div role="alert" className="flex shrink-0 items-start gap-2 border-b border-orange/20 bg-orange/[0.04] px-3.5 py-2 text-[11.5px] leading-[1.6] text-ink">
          <span className="mt-px flex size-3.5 shrink-0 items-center justify-center rounded-full bg-orange-tint text-orange" aria-hidden>
            !
          </span>
          <span className="min-w-0 flex-1">{notice}</span>
          {/applies the next|next time this session|next run/i.test(notice) ? (
            <button
              type="button"
              onClick={() => void restartForConfig()}
              disabled={restartingForConfig}
              className="-m-1 shrink-0 rounded-md bg-ink px-2 py-0.5 text-[11px] font-medium text-canvas transition-opacity hover:opacity-85 disabled:opacity-50"
            >
              {restartingForConfig ? 'Restarting…' : 'Restart now'}
            </button>
          ) : null}
          <button type="button" onClick={() => dismissNotice(session.id)} aria-label="Dismiss" className="-m-1 shrink-0 p-1 text-ink-3 transition-colors hover:text-ink">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d="M18 6L6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
      ) : null}

      {/* ── Header: title + session actions ──────────────────────────────── */}
      <header className="flex h-12 shrink-0 items-center gap-2 border-b border-line/50 bg-inset px-3">
        <span
          className="size-2 shrink-0 rounded-full"
          style={{ backgroundColor: hueFor(session.agent) }}
          title={provider?.name ?? session.agent}
          aria-hidden
        />
        <div className="min-w-0 flex-1">
          {editingTitle ? (
            <input
              ref={titleInputRef}
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={() => setEditingTitle(false)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') setEditingTitle(false)
                if (e.key === 'Escape') {
                  setTitleDraft(session.name)
                  setEditingTitle(false)
                }
              }}
              className="w-full max-w-[320px] rounded-control border border-line bg-field px-2 py-0.5 text-[12.5px] font-medium outline-none focus:border-line-strong"
              aria-label="Session name"
            />
          ) : (
            <button
              type="button"
              onClick={() => setEditingTitle(true)}
              title="Rename session"
              className="block w-full truncate text-left text-[13px] font-semibold tracking-[-0.01em] hover:underline"
            >
              {session.name}
            </button>
          )}
        </div>

        {roomOfSession ? (
          <span
            title={`${roomOfSession.name} — ${roomOfSession.workers.length} worker${roomOfSession.workers.length === 1 ? '' : 's'}, channel chat`}
            className="mr-1 flex shrink-0 items-center gap-1.5 rounded-full border border-line/50 bg-surface py-0.5 pl-0.5 pr-2"
          >
            <RoomAvatarStack names={roomOfSession.workers.map((w) => w.name)} size={16} max={3} />
            <span className="font-mono text-[9px] uppercase tracking-wide text-ink-2">{roomOfSession.name}</span>
          </span>
        ) : null}

        {/* Share — copy this session's link. */}
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard?.writeText(window.location.href).then(() => {
              setShared(true)
              setTimeout(() => setShared(false), 1600)
            })
          }}
          title="Copy link to this session"
          aria-label="Share session link"
          className="flex size-7 shrink-0 items-center justify-center rounded-lg text-ink-3 transition-colors hover:bg-hover-2 hover:text-ink"
        >
          {shared ? <Check size={13} className="text-green" /> : <Share2 size={13} />}
        </button>

        {/* Browser — toggle the tool panel, like the reference's top-right. */}
        <button
          type="button"
          onClick={onTogglePanel}
          title={panelOpen ? 'Hide workspace panel' : 'Show workspace panel'}
          aria-label={panelOpen ? 'Hide workspace panel' : 'Show workspace panel'}
          aria-pressed={panelOpen}
          className={cn(
            'flex h-7 shrink-0 items-center gap-1.5 rounded-lg border px-2.5 text-[11px] font-medium transition-colors',
            panelOpen
              ? 'border-line-strong bg-surface text-ink'
              : 'border-line/60 bg-transparent text-ink-2 hover:bg-hover-2 hover:text-ink',
          )}
        >
          <Globe size={12} />
          Browser
        </button>

        {/* Overflow: star, export, delete. */}
        <div ref={menuRef} className="relative">
          <button
            type="button"
            onClick={() => setMenuOpen((v) => !v)}
            title="More actions"
            aria-label="More actions"
            className={cn('flex size-7 items-center justify-center rounded-lg transition-colors', menuOpen ? 'bg-hover-2 text-ink' : 'text-ink-3 hover:bg-hover-2 hover:text-ink')}
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor" aria-hidden>
              <circle cx="5" cy="12" r="1.8" />
              <circle cx="12" cy="12" r="1.8" />
              <circle cx="19" cy="12" r="1.8" />
            </svg>
          </button>
          {menuOpen ? (
            <div role="menu" className="animate-up absolute right-0 top-9 z-40 w-44 overflow-hidden rounded-card border border-line bg-surface shadow-overlay">
              <MenuButton
                label={starred ? 'Unstar session' : 'Star session'}
                onClick={() => {
                  setMenuOpen(false)
                  toggleStar(session.id)
                }}
              />
              <MenuButton
                label="Copy link"
                onClick={() => {
                  setMenuOpen(false)
                  void navigator.clipboard?.writeText(window.location.href)
                }}
              />
              <MenuButton
                label="Export JSON"
                onClick={() => {
                  setMenuOpen(false)
                  const blob = new Blob([JSON.stringify(session, null, 2)], { type: 'application/json' })
                  const url = URL.createObjectURL(blob)
                  const a = document.createElement('a')
                  a.href = url
                  a.download = `${session.name}.json`
                  a.click()
                  URL.revokeObjectURL(url)
                }}
              />
              <div className="border-t border-line" aria-hidden />
              <MenuButton
                label="Delete session"
                destructive
                onClick={async () => {
                  setMenuOpen(false)
                  if (confirm(`Delete "${session.name}"?`)) {
                    try {
                      await deleteSession(session.id)
                      onExitSession()
                    } catch {
                      /* notice already set by the store — stay put */
                    }
                  }
                }}
              />
            </div>
          ) : null}
        </div>
      </header>

      {/* ── Transcript ────────────────────────────────────────────────────── */}
      <div className="relative flex min-h-0 flex-1 flex-col">
        <Timeline
          conversation={conversation}
          onRespond={(id, d, m) => useStore.getState().respondToApproval(session.id, id, d, m)}
          project={session.project ?? undefined}
          sessionId={session.id}
          onViewPlan={() => revealTab('plan')}
        />
        <FloatingHud session={session} onSelectTab={revealTab} />
      </div>

      {/* ── Composer ──────────────────────────────────────────────────────── */}
      <StateZone
        session={session}
        conversation={conversation}
        connection={connection}
        config={config}
        provider={provider}
        onSend={handleSend}
        onQueue={handleQueue}
        onSetConfig={(id, v) => void setConfig(session.id, id, v)}
        rooms={rooms.map((r) => r.name)}
        workers={roomOfSession?.workers.map((w) => w.name)}
      />
    </div>
  )
}

function MenuButton({ label, onClick, destructive }: { label: string; onClick: () => void; destructive?: boolean }) {
  return (
    <button
      type="button"
      role="menuitem"
      onClick={onClick}
      className={cn(
        'flex w-full items-center px-3 py-2 text-left text-[12px] transition-colors',
        destructive ? 'text-red hover:bg-red-tint' : 'text-ink-2 hover:bg-hover-2 hover:text-ink',
      )}
    >
      {label}
    </button>
  )
}
