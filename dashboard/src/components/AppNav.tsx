/**
 * AppNav — the workspace's left rail, in the reference picture's idiom:
 * grouped destinations under uppercase micro-labels, a History list of
 * sessions, a Quick Access footer, and the device profile card.
 *
 * One component serves both shapes: the persistent desktop rail and the
 * mobile drawer (the shell wraps it in an overlay there).
 */

import { useState, type ReactNode } from 'react'
import {
  BarChart3,
  BookOpen,
  Bot,
  ChevronRight,
  Globe,
  History as HistoryIcon,
  Home,
  KeyRound,
  Plus,
  SlidersHorizontal,
  Wrench,
} from 'lucide-react'
import { cn } from '@/lib/format'
import { isPaired } from '@/lib/pairing'
import { isInternalSession } from '@/lib/sessionState'
import { useStore } from '@/store'
import type { ConnectionState } from '@/types/protocol'
import type { Session } from '@/types/session'

export type NavPage = 'home' | 'agents' | 'browsers' | 'history' | 'usage' | 'config'

/** What the center pane is showing: a nav page, or a session (rail History
 *  highlights instead of a page item). */
export type NavSelection = NavPage | 'session'

const DOCS_URL = 'https://github.com/kareem-g/agentdeck-linux'

function BrandMark() {
  return (
    <span className="flex items-center gap-2 px-1">
      <span className="flex size-7 shrink-0 items-center justify-center rounded-lg bg-accent/15">
        <span className="font-mono text-[12px] font-bold text-accent-ink">A</span>
      </span>
      <span className="text-[13px] font-semibold tracking-[-0.01em] text-ink">Plumb</span>
    </span>
  )
}

/** Uppercase micro-label — the rail's section headers. */
function NavLabel({ children }: { children: string }) {
  return (
    <p className="px-3 pb-1.5 pt-5 font-mono text-[9px] font-medium uppercase tracking-[0.18em] text-ink-3/80">
      {children}
    </p>
  )
}

interface NavItemProps {
  icon: ReactNode
  label: string
  active?: boolean
  chevron?: boolean
  onClick: () => void
}

function NavItem({ icon, label, active, chevron, onClick }: NavItemProps) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'group flex w-full items-center gap-2.5 rounded-lg px-3 py-[7px] text-left text-[12.5px] transition-colors duration-100',
        active
          ? 'bg-accent-tint text-ink ring-1 ring-inset ring-accent/25'
          : 'text-ink-2 hover:bg-hover-2 hover:text-ink',
      )}
    >
      <span className={cn('shrink-0', active ? 'text-accent' : 'text-ink-3 group-hover:text-ink-2')} aria-hidden>
        {icon}
      </span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {chevron ? <ChevronRight size={12} className="shrink-0 text-ink-3/70" aria-hidden /> : null}
    </button>
  )
}

export function AppNav({
  selection,
  onNavigate,
  onOpenSession,
  onNewTask,
  activeSessionId,
}: {
  selection: NavSelection
  onNavigate: (page: NavPage) => void
  onOpenSession: (sessionId: string) => void
  /** Start a new session and open it. */
  onNewTask: () => void
  /** Session open in the center pane — the History row highlights instead. */
  activeSessionId?: string
}) {
  const sessions = useStore((state) => state.sessions)
  const connection = useStore((state) => state.connection)
  const [copied, setCopied] = useState(false)

  const history = sessions
    .filter((session) => session.status !== 'archived' && !isInternalSession(session))
    .slice()
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))

  async function copyDeviceToken() {
    try {
      const { getPairingToken } = await import('@/lib/pairing')
      const token = getPairingToken()
      if (token) await navigator.clipboard.writeText(token)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      /* clipboard unavailable */
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      {/* Brand */}
      <div className="flex h-14 shrink-0 items-center border-b border-line/50 px-3">
        <BrandMark />
      </div>

      {/* New task — the rail's primary action, always one tap away. */}
      <div className="shrink-0 px-3 pt-3">
        <button
          type="button"
          onClick={onNewTask}
          className="flex h-9 w-full items-center justify-center gap-1.5 rounded-lg border border-line/60 bg-surface text-[12.5px] font-medium text-ink shadow-hairline transition-colors hover:bg-hover-2"
        >
          <Plus size={14} strokeWidth={2.2} />
          New task
        </button>
      </div>

      {/* Destinations */}
      <nav aria-label="Workspace" className="min-h-0 flex-1 overflow-y-auto scroll-thin pb-3">
        <NavLabel>Get started</NavLabel>
        <div className="space-y-px px-1.5">
          <NavItem
            icon={<Home size={14} strokeWidth={1.8} />}
            label="Home"
            active={selection === 'home'}
            onClick={() => onNavigate('home')}
          />
        </div>

        <NavLabel>Products</NavLabel>
        <div className="space-y-px px-1.5">
          <NavItem
            icon={<Bot size={14} strokeWidth={1.8} />}
            label="Agents"
            active={selection === 'agents'}
            onClick={() => onNavigate('agents')}
          />
          <NavItem
            icon={<Globe size={14} strokeWidth={1.8} />}
            label="Browsers"
            active={selection === 'browsers'}
            onClick={() => onNavigate('browsers')}
          />
        </div>

        <NavLabel>Manage</NavLabel>
        <div className="space-y-px px-1.5">
          <NavItem
            icon={<HistoryIcon size={14} strokeWidth={1.8} />}
            label="History"
            active={selection === 'history'}
            onClick={() => onNavigate('history')}
          />
          <NavItem
            icon={<BarChart3 size={14} strokeWidth={1.8} />}
            label="Usage"
            active={selection === 'usage'}
            onClick={() => onNavigate('usage')}
          />
          <NavItem
            icon={<SlidersHorizontal size={14} strokeWidth={1.8} />}
            label="Configuration"
            chevron
            active={selection === 'config'}
            onClick={() => onNavigate('config')}
          />
        </div>

        {/* History — the session list, newest first. */}
        <NavLabel>History</NavLabel>
        <div className="space-y-px px-1.5">
          {history.length === 0 ? (
            <p className="px-3 py-2 text-[11px] leading-relaxed text-ink-3/70">
              No sessions yet. Create a task from Home.
            </p>
          ) : (
            history.slice(0, 30).map((session: Session) => {
              const active = session.id === activeSessionId
              return (
                <button
                  key={session.id}
                  type="button"
                  onClick={() => onOpenSession(session.id)}
                  title={session.name}
                  className={cn(
                    'flex w-full items-center gap-2 rounded-lg px-3 py-[7px] text-left transition-colors duration-100',
                    active
                      ? 'bg-hover text-ink ring-1 ring-inset ring-line-strong/60'
                      : 'text-ink-2 hover:bg-hover-2 hover:text-ink',
                  )}
                >
                  <span className="min-w-0 flex-1 truncate text-[12px]">{session.name}</span>
                  <span className="shrink-0 font-mono text-[9px] text-ink-3/70">
                    {relativeDay(session.updated_at)}
                  </span>
                </button>
              )
            })
          )}
        </div>
      </nav>

      {/* Quick Access + profile, pinned to the rail's bottom. */}
      <div className="shrink-0 border-t border-line/50">
        <NavLabel>Quick Access</NavLabel>
        <div className="space-y-px px-1.5">
          <NavItem
            icon={<KeyRound size={14} strokeWidth={1.8} />}
            label={copied ? 'Copied' : 'API Key'}
            onClick={() => void copyDeviceToken()}
          />
          <NavItem
            icon={<Wrench size={14} strokeWidth={1.8} />}
            label="Agent Setup"
            onClick={() => onNavigate('agents')}
          />
          <NavItem
            icon={<BookOpen size={14} strokeWidth={1.8} />}
            label="Documentation"
            onClick={() => {
              window.open(DOCS_URL, '_blank', 'noopener')
            }}
          />
        </div>

        {/* Device profile — this app is local-first; the card names the machine,
            not an account. The connection state lives here too: it is the
            device's link to the daemon, so it belongs on the device. */}
        <div className="px-3 py-3">
          <div className="rounded-control border border-line/60 bg-surface px-2.5 py-2 shadow-hairline">
            <div className="flex items-center gap-2.5">
              <span
                className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent/15 font-mono text-[11px] font-semibold text-accent"
                aria-hidden
              >
                A
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12px] font-medium text-ink">Local device</span>
                <span className="block truncate text-[10px] text-ink-3">
                  {isPaired() ? 'Paired · this machine' : 'Not paired'}
                </span>
              </span>
            </div>
            <div className="mt-2 flex items-center gap-1.5 border-t border-line/50 pt-2">
              <span className={cn('size-1.5 shrink-0 rounded-full', connectionDot(connection))} aria-hidden />
              <span className="min-w-0 flex-1 truncate text-[10.5px] text-ink-3">
                {connectionLabel(connection)}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

/** Connection tone: green when live, orange while connecting, red otherwise. */
function connectionDot(state: ConnectionState): string {
  if (state === 'connected') return 'bg-green'
  if (state === 'connecting' || state === 'reconnecting') return 'bg-orange breathe'
  return 'bg-red/70'
}

function connectionLabel(state: ConnectionState): string {
  switch (state) {
    case 'connected':
      return 'Connected to daemon'
    case 'connecting':
      return 'Connecting…'
    case 'reconnecting':
      return 'Reconnecting…'
    case 'unauthorized':
      return 'Not paired'
    case 'error':
      return 'Connection error'
    default:
      return 'Offline'
  }
}

/** Compact day label for the rail's History rows: Today / Yesterday / date. */
function relativeDay(iso: string): string {
  const date = new Date(iso)
  const now = new Date()
  const startOfDay = (value: Date) => new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime()
  const days = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000)
  if (days <= 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days}d`
  return date.toLocaleDateString([], { month: 'short', day: 'numeric' })
}
