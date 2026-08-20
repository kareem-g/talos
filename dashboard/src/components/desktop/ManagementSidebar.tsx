import { cn } from '@/lib/format'

type NavId = 'sessions' | 'settings' | 'help'

export function ManagementSidebar({
  active,
  onNavigate,
  onPair,
}: {
  active: NavId
  onNavigate: (id: NavId) => void
  onPair?: () => void
}) {
  return (
    <aside className="flex w-[260px] shrink-0 flex-col border-r border-line bg-canvas">
      <div className="flex h-14 items-center gap-2 border-b border-line px-4">
        <span className="flex size-7 shrink-0 items-center justify-center rounded-[8px] bg-accent-tint">
          <span className="font-mono text-[12px] font-medium text-accent-ink">A</span>
        </span>
        <span className="text-[13px] font-medium tracking-[-0.01em] text-ink">AgentDeck</span>
        <span className="ml-auto rounded-full border border-line bg-inset px-1.5 py-0.5 text-[10px] font-medium text-ink-3">v0.1</span>
      </div>

      <nav className="flex flex-1 flex-col gap-1 px-3 py-4">
        <SidebarItem label="Sessions" icon={<SessionsIcon />} active={active === 'sessions'} onClick={() => onNavigate('sessions')} />
        <SidebarItem label="Settings" icon={<SettingsIcon />} active={active === 'settings'} onClick={() => onNavigate('settings')} />
        <SidebarItem label="Help" icon={<HelpIcon />} active={active === 'help'} onClick={() => onNavigate('help')} />
        {onPair ? (
          <button
            type="button"
            onClick={onPair}
            className="mt-2 flex items-center gap-2 rounded-control px-2.5 py-2 text-left text-[12.5px] text-ink-3 transition-colors hover:bg-hover-2 hover:text-ink"
          >
            <span className="flex size-5 items-center justify-center rounded-[6px] border border-line bg-surface">
              <QrIcon />
            </span>
            Pair phone
          </button>
        ) : null}
      </nav>

      <div className="border-t border-line p-3">
        <div className="flex items-center gap-2.5 rounded-control bg-surface px-2.5 py-2 shadow-hairline">
          <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-accent text-[11px] font-medium text-canvas">D</span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[12.5px] font-medium text-ink">Developer</span>
            <span className="block truncate text-[11px] text-ink-3">Local workspace</span>
          </span>
          <button
            type="button"
            title="Logout (local only)"
            className="shrink-0 rounded-[6px] p-1 text-ink-3 hover:bg-hover-2 hover:text-ink"
          >
            <LogoutIcon />
          </button>
        </div>
      </div>
    </aside>
  )
}

function SidebarItem({
  label,
  icon,
  active,
  onClick,
}: {
  label: string
  icon: React.ReactNode
  active?: boolean
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex w-full items-center gap-2 rounded-control px-2.5 py-2 text-left text-[13px] transition-colors',
        active ? 'bg-accent-tint text-ink' : 'text-ink-2 hover:bg-hover-2 hover:text-ink',
      )}
    >
      <span className={cn('flex size-5 items-center justify-center', active ? 'text-accent-ink' : 'text-ink-3')}>{icon}</span>
      {label}
    </button>
  )
}

function SessionsIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="3" width="7" height="7" rx="1.5" />
      <rect x="14" y="14" width="7" height="7" rx="1.5" />
      <rect x="3" y="14" width="7" height="7" rx="1.5" />
    </svg>
  )
}
function SettingsIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .34 1.87l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06A1.7 1.7 0 0 0 15 19.4a1.7 1.7 0 0 0-1 1.45V21a2 2 0 0 1-4 0v-.15A1.7 1.7 0 0 0 9 19.4a1.7 1.7 0 0 0-1.87-.34l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06A1.7 1.7 0 0 0 4.6 15a1.7 1.7 0 0 0-1.45-1V12a2 2 0 0 1 2-2h.15A1.7 1.7 0 0 0 4.6 9a1.7 1.7 0 0 0 .34-1.87l-.06-.06A2 2 0 0 1 7.71 4.24l.06.06A1.7 1.7 0 0 0 9.64 4.6 1.7 1.7 0 0 0 11 3.15V3a2 2 0 0 1 4 0v.15a1.7 1.7 0 0 0 1 1.45 1.7 1.7 0 0 0 1.87.34l.06-.06A2 2 0 0 1 20.76 7.71l-.06.06A1.7 1.7 0 0 0 19.4 9a1.7 1.7 0 0 0-1.45 1V11a2 2 0 0 1-2 2h-.15A1.7 1.7 0 0 0 19.4 15Z" />
    </svg>
  )
}
function HelpIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="10" />
      <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
      <path d="M12 17h.01" />
    </svg>
  )
}
function QrIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" rx="1" />
      <rect x="14" y="3" width="7" height="7" rx="1" />
      <rect x="3" y="14" width="7" height="7" rx="1" />
      <path d="M14 14h3v3h-3zM20 14v.01M20 20v.01M17 20v.01" />
    </svg>
  )
}
function LogoutIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" />
      <path d="M16 17l5-5-5-5" />
      <path d="M21 12H9" />
    </svg>
  )
}
