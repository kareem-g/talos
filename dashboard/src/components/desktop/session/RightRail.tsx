/**
 * RightRail — the browser-style multi-tab Agent Workspace right pane.
 *
 * Structure (top to bottom):
 *   RightRailTabs — the open tabs (Plan / Agents / Git diff / …) with a "＋"
 *                   Open-tab picker.
 *   Content       — the active tab's view. Open tabs stay mounted (hidden when
 *                   inactive) so browser URL and scroll state persist.
 *
 * Everything is daemon-backed via `workspaceData`. Open tabs persist per session
 * in localStorage. Terminal access lives in the center column's Chat|Terminal
 * tabs.
 */

import { forwardRef, useCallback, useEffect, useImperativeHandle, useState } from 'react'
import { Maximize2, RotateCw, X } from 'lucide-react'
import { socket } from '@/lib/socket'
import { useConversation, useStore } from '@/store'
import { cn } from '@/lib/format'
import type { Session } from '@/types/session'
import { TerminalView } from '../../TerminalView'
import { RightRailTabs } from './RightRailTabs'
import {
  AgentsView,
  BrowserView,
  FilesView,
  GitDiffView,
  GitFilesView,
  GoalView,
  PlanView,
  ProjectsView,
  RoomChannelView,
  SideSessionView,
  SubSessionsView,
} from './RightRailViews'
import { DEFAULT_OPEN_TABS, isRightTab, type RightTabType } from './rightTabs'

const WIDE_KEY = 'agentdesk-right-wide'
const TAB_PREFIX = 'agentdeck-right-tabs-'

/* ── Toasts ────────────────────────────────────────────────────────────────── */

interface Toast {
  id: number
  message: string
  tone: 'ok' | 'error'
}

let toastSeq = 1

function useToasts() {
  const [toasts, setToasts] = useState<Toast[]>([])
  const push = useCallback((message: string, tone: Toast['tone'] = 'ok') => {
    const id = toastSeq++
    setToasts((current) => [...current.slice(-3), { id, message, tone }])
    if (tone === 'ok') {
      setTimeout(() => setToasts((current) => current.filter((t) => t.id !== id)), 4000)
    }
  }, [])
  const dismiss = useCallback((id: number) => setToasts((current) => current.filter((t) => t.id !== id)), [])
  return { toasts, push, dismiss }
}

function ToastStack({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: number) => void }) {
  if (toasts.length === 0) return null
  return (
    <div className="pointer-events-none absolute bottom-3 left-1/2 z-50 flex w-[92%] -translate-x-1/2 flex-col gap-1.5">
      {toasts.map((toast) => (
        <div
          key={toast.id}
          role="status"
          className={cn(
            'animate-up pointer-events-auto flex items-center gap-2 rounded-lg border px-3 py-2 text-[11px] leading-snug shadow-lg backdrop-blur',
            toast.tone === 'error' ? 'border-red/30 bg-red-tint text-red-200' : 'border-line/60 bg-surface/90 text-ink-2',
          )}
        >
          <span className="min-w-0 flex-1 break-words">{toast.message}</span>
          <button type="button" onClick={() => onDismiss(toast.id)} aria-label="Dismiss" className="shrink-0 text-current opacity-60 hover:opacity-100">
            <X size={12} />
          </button>
        </div>
      ))}
    </div>
  )
}

/* ── Tab persistence ───────────────────────────────────────────────────────── */

function loadTabs(sessionId: string): RightTabType[] {
  try {
    const raw = localStorage.getItem(TAB_PREFIX + sessionId)
    if (!raw) return DEFAULT_OPEN_TABS
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return DEFAULT_OPEN_TABS
    // Only ids the current registry knows about survive; anything else
    // (removed tab type, older build's stale entry) is dropped here so the
    // strip never renders a tab it cannot describe.
    const valid = parsed.filter(isRightTab) as RightTabType[]
    return valid.length > 0 ? valid : DEFAULT_OPEN_TABS
  } catch {
    return DEFAULT_OPEN_TABS
  }
}

function saveTabs(sessionId: string, tabs: RightTabType[]) {
  try {
    localStorage.setItem(TAB_PREFIX + sessionId, JSON.stringify(tabs))
  } catch {
    /* storage may be unavailable */
  }
}

/* ── Main RightRail ────────────────────────────────────────────────────────── */

export interface RightRailHandle {
  /** Open (adding if needed) and focus a tab — used by the subagent strip. */
  openTab: (id: RightTabType) => void
}

export const RightRail = forwardRef<RightRailHandle, {
  session: Session
  /** Switch to another session without leaving the workspace. */
  onOpenSession?: (sessionId: string) => void
  /** Surface operation results; errors bubble up as session notices. */
  notify?: (message: string, tone?: 'ok' | 'error') => void
  /** Fit the panel to its container instead of a fixed 380/680px width.
   * Used when the rail is embedded in a constrained surface ( the mobile
   * side sheet), where a fixed width would overflow and the widen control
   * would make no sense. */
  fill?: boolean
  /** Drop the rail's own canvas background — the host surface already
   * paints one (the unified shell's card wrapper). */
  bare?: boolean
}>(function RightRail({ session, onOpenSession, notify, fill, bare }, ref) {
  const connection = useStore((s) => s.connection)
  const config = useStore((s) => s.configs[session.id])
  const conversation = useConversation(session.id)

  /* ── Width preference ─────────────────────────────────────────────────── */
  const [wide, setWide] = useState(() => {
    try { return localStorage.getItem(WIDE_KEY) === '1' } catch { return false }
  })
  const toggleWide = useCallback(() => {
    setWide((v) => {
      const next = !v
      try { localStorage.setItem(WIDE_KEY, next ? '1' : '0') } catch { /* noop */ }
      return next
    })
  }, [])

  /* ── Workspace refresh ────────────────────────────────────────────────── */
  const [refreshKey, setRefreshKey] = useState(0)
  const refresh = useCallback(() => setRefreshKey((k) => k + 1), [])

  /* ── Toasts ───────────────────────────────────────────────────────────── */
  const { toasts, push, dismiss } = useToasts()
  const railNotify = useCallback(
    (message: string, tone: 'ok' | 'error' = 'ok') => {
      push(message, tone)
      if (tone === 'error') notify?.(message, tone)
    },
    [push, notify],
  )

  /* ── Open tabs + active tab (persisted per session) ───────────────────── */
  const [tabs, setTabs] = useState<RightTabType[]>(() => loadTabs(session.id))
  const [tab, setTab] = useState<RightTabType>(() => loadTabs(session.id)[0] ?? 'plan')

  // Reset to the session's saved tab set whenever the session changes.
  useEffect(() => {
    const saved = loadTabs(session.id)
    setTabs(saved)
    setTab(saved[0] ?? 'plan')
  }, [session.id])

  const addTab = useCallback((id: RightTabType) => {
    setTabs((current) => (current.includes(id) ? current : [...current, id]))
    setTab(id)
  }, [])
  const closeTab = useCallback(
    (id: RightTabType) => {
      setTabs((current) => {
        const next = current.filter((t) => t !== id)
        setTab((active) => (active === id ? next[Math.max(0, current.indexOf(id) - 1)] ?? 'plan' : active))
        return next
      })
    },
    [],
  )

  // Imperatively open/focus a tab (the subagent strip opens the Agents tab).
  useImperativeHandle(ref, () => ({ openTab: addTab }), [addTab])

  // Auto-open the Browser tab the moment the agent's CDP engine goes live.
  // This must live HERE, not inside BrowserView — BrowserView only mounts once
  // its tab is already open, so it can never surface itself.
  useEffect(() => {
    if (!session.project) return
    let stopped = false
    let notified = false
    const poll = async () => {
      try {
        const { browserApi } = await import('@/lib/api')
        const data = await browserApi.state(session.id)
        if (stopped) return
        const engineActive = Boolean(data.ok && data.tabs && data.tabs.length > 0)
        if (engineActive && !notified) {
          notified = true
          addTab('browser')
        } else if (!engineActive) {
          notified = false
        }
      } catch {
        // Transient error — keep polling, don't flap.
      }
    }
    void poll()
    const interval = setInterval(poll, 2000)
    return () => {
      stopped = true
      clearInterval(interval)
    }
  }, [session.id, session.project, addTab])

  useEffect(() => {
    saveTabs(session.id, tabs)
    if (tabs.length > 0 && !tabs.includes(tab)) setTab(tabs[0])
  }, [session.id, tabs, tab])

  const renderView = (id: RightTabType) => {
    switch (id) {
      case 'plan':
        return <PlanView session={session} />
      case 'agents':
        return <AgentsView session={session} />
      case 'git-diff':
        return <GitDiffView session={session} notify={railNotify} refreshKey={refreshKey} />
      case 'git-files':
        return <GitFilesView session={session} notify={railNotify} refreshKey={refreshKey} />
      case 'browser':
        // Auto-open + focus when the agent's CDP engine goes live, so an
        // agent driving the browser surfaces itself instead of hiding behind
        // the tab picker.
        return <BrowserView session={session} onEngineActive={() => addTab('browser')} />
      case 'goal':
        return <GoalView session={session} />
      case 'subsessions':
        return <SubSessionsView session={session} onOpenSession={onOpenSession} />
      case 'side':
        return <SideSessionView session={session} />
      case 'rooms':
        return <RoomChannelView session={session} />
      case 'terminal':
        return (
          <TerminalView
            output={conversation.terminal}
            interactive={config?.interactiveTerminal === true}
            transport={config?.transport}
            connectionState={connection}
            fontSize={13}
            onInput={(d) => socket.sendTerminalInput(session.id, d)}
            onResize={(c, r) => socket.resizeTerminal(session.id, c, r)}
          />
        )
      case 'files':
        return <FilesView session={session} />
      case 'projects':
        return <ProjectsView session={session} onOpenSession={onOpenSession} />
      default:
        return null
    }
  }

  /* ── Render ───────────────────────────────────────────────────────────── */
  return (
    <div
      className={cn(
        'flex h-full flex-col transition-[width] duration-200',
        // Desktop: fixed-width panel next to the fluid chat column. Sheet:
        // fill whatever width the host surface gives us.
        !bare && 'bg-canvas',
        fill ? 'w-full min-w-0' : 'shrink-0',
        !fill && wide ? 'w-[680px]' : '',
        !fill && !wide ? 'w-[380px]' : '',
      )}
    >
      {/* 1. Tab strip + open-tab picker */}
      <RightRailTabs tabs={tabs} active={tab} onSelect={setTab} onClose={closeTab} onAdd={addTab} compact={fill} />

      {/* 1b. Slim toolbar — refresh + widen */}
      <div className="flex shrink-0 items-center gap-1 border-b border-line/40 bg-inset px-2 py-1">
        <span className="min-w-0 flex-1 truncate font-mono text-[10px] text-ink-3">{session.project ?? 'workspace'}</span>
        <button
          type="button"
          onClick={refresh}
          aria-label="Refresh"
          title="Refresh"
          className="flex size-6 shrink-0 items-center justify-center rounded-md text-ink-3 transition-colors hover:bg-hover-2 hover:text-ink"
        >
          <RotateCw size={12} />
        </button>
        {fill ? null : (
          <button
            type="button"
            onClick={toggleWide}
            aria-label={wide ? 'Normal width' : 'Wider panel'}
            title={wide ? 'Normal width' : 'Wider panel'}
            className="flex size-6 shrink-0 items-center justify-center rounded-md text-ink-3 transition-colors hover:bg-hover-2 hover:text-ink"
          >
            {wide ? <X size={12} /> : <Maximize2 size={12} />}
          </button>
        )}
      </div>

      {/* 2. Content — keep open tabs mounted so state survives switching.
          overflow-hidden contains each view's own scroll region so a wide
          child can never push a scrollbar onto a host surface (e.g. the
          mobile sheet) around this panel. */}
      <div className="relative flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
          {tabs.map((id) => (
            <div key={id} className={cn('min-h-0 min-w-0 flex-1 flex-col', tab === id ? 'flex' : 'hidden')}>
              {renderView(id)}
            </div>
          ))}
        </div>

        {/* Connection dot */}
        <span
          className="absolute bottom-2 right-2 z-10 size-2 rounded-full"
          aria-hidden
          title={connection}
          style={{
            backgroundColor:
              connection === 'connected'
                ? 'var(--green)'
                : connection === 'connecting' || connection === 'reconnecting'
                  ? 'var(--orange)'
                  : 'var(--red)',
          }}
        />

        {/* Toasts */}
        <ToastStack toasts={toasts} onDismiss={dismiss} />
      </div>
    </div>
  )
})
