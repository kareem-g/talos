import { useMemo, useState } from 'react'
import {
  Archive,
  ChevronRight,
  Folder,
  AppWindow,
  LayoutGrid,
  Plus,
  RadioTower,
  Search,
  Settings2,
  Sparkles,
  X,
} from 'lucide-react'
import { useStore, getConversation } from '@/store'
import { cn, relativeTime } from '@/lib/format'
import { sessionUIState, isInternalSession } from '@/lib/sessionState'
import type { Session } from '@/types/session'

type GroupMode = 'group' | 'project'
type AppSection = 'automations' | 'skills' | 'remote' | 'settings'

/**
 * Home sidebar — sessions/workspaces first. The workspace tool mini-panels
 * (Agents, Terminals, Browser, Tasks, Git) were removed from here: that
 * activity lives in the session workspace's own panel, and the home is a
 * control station, not a second workbench.
 */
export function HomeSidebar({
  onNewTask,
  onSearch,
  onSelectSession,
  onNavigate,
  selectedId,
  searchQuery,
}: {
  onNewTask: () => void
  onSearch: () => void
  onSelectSession: (id: string) => void
  onNavigate: (section: AppSection) => void
  selectedId?: string
  searchQuery: string
}) {
  const sessions = useStore((state) => state.sessions)
  const connection = useStore((state) => state.connection)
  const archiveSession = useStore((state) => state.archiveSession)
  const [groupMode, setGroupMode] = useState<GroupMode>('project')
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [showAll, setShowAll] = useState<Record<string, boolean>>({})
  const [mobileOpen, setMobileOpen] = useState(false)
  const needle = searchQuery.trim().toLowerCase()

  const workspaces = useMemo(() => {
    const grouped = new Map<string, Session[]>()
    for (const session of sessions) {
      if (session.status === 'archived') continue
      if (needle && ![session.name, session.agent, session.project ?? ''].some((value) => value.toLowerCase().includes(needle))) continue
      const key = session.project ?? '__inbox__'
      grouped.set(key, [...(grouped.get(key) ?? []), session])
    }
    return [...grouped.entries()]
      .map(([project, items]) => ({
        project,
        name: project === '__inbox__' ? 'Inbox' : project.split('/').pop() ?? project,
        sessions: items.sort((a, b) => b.updated_at.localeCompare(a.updated_at)),
      }))
      .sort((a, b) => b.sessions[0].updated_at.localeCompare(a.sessions[0].updated_at))
  }, [sessions, needle])

  function renderSessionsPanel() {
    return (
      <div className="flex min-h-0 flex-1 flex-col animate-fade">
        <div className="flex items-center gap-1 border-b border-white/[0.07] px-2 py-2">
          <button type="button" onClick={() => setGroupMode('group')} className={cn('flex-1 rounded-full px-2 py-1 text-[10px] font-medium transition', groupMode === 'group' ? 'bg-accent text-accent-ink' : 'text-zinc-500 hover:bg-white/5 hover:text-zinc-200')}>Group</button>
          <button type="button" onClick={() => setGroupMode('project')} className={cn('flex-1 rounded-full px-2 py-1 text-[10px] font-medium transition', groupMode === 'project' ? 'bg-accent text-accent-ink' : 'text-zinc-500 hover:bg-white/5 hover:text-zinc-200')}>Project</button>
          <button type="button" onClick={() => setExpanded({})} className="rounded-lg p-1.5 text-zinc-500 hover:bg-white/5 hover:text-zinc-200" title="Expand all"><LayoutGrid size={13} /></button>
        </div>
        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          <div className="flex items-center justify-between px-2 pb-1 pt-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-zinc-600">Workspaces</span>
            <span className="font-mono text-[10px] text-zinc-600">{sessions.filter((session) => session.status !== 'archived' && !isInternalSession(session)).length}</span>
          </div>
          {workspaces.length === 0 ? (
            <p className="px-2 py-5 text-[11px] leading-[1.5] text-zinc-500">No sessions yet. Create a task to start a workspace.</p>
          ) : workspaces.map((workspace) => {
            const isExpanded = expanded[workspace.project] ?? true
            const visible = showAll[workspace.project] ? workspace.sessions : workspace.sessions.slice(0, 5)
            return (
              <div key={workspace.project} className="mb-1">
                <button type="button" onClick={() => setExpanded((current) => ({ ...current, [workspace.project]: !isExpanded }))} className="flex w-full items-center gap-1.5 rounded-lg px-2 py-2 text-left transition hover:bg-white/[0.05]">
                  <ChevronRight size={13} className={cn('shrink-0 text-zinc-600 transition-transform', isExpanded && 'rotate-90')} />
                  <Folder size={13} className="shrink-0 text-zinc-500" />
                  <span className="min-w-0 flex-1 truncate text-[11.5px] font-medium text-zinc-200">{workspace.name}</span>
                  <span className="font-mono text-[10px] text-zinc-600">{workspace.sessions.length}</span>
                </button>
                {isExpanded ? <div className="ml-3 border-l border-white/[0.07] pl-2">
                  {visible.map((session) => {
                    const uiState = sessionUIState(session, getConversation(session.id), connection)
                    const active = selectedId === session.id
                    return (
                      <div key={session.id} className="group relative flex items-center">
                        <button type="button" onClick={() => { onSelectSession(session.id); setMobileOpen(false) }} className={cn('flex min-w-0 flex-1 items-center gap-2 rounded-lg px-2 py-2 pr-7 text-left transition', active ? 'bg-accent-tint text-ink ring-1 ring-inset ring-accent/25' : 'text-zinc-400 hover:bg-white/[0.05] hover:text-zinc-100')}>
                          <span className={cn('size-1.5 shrink-0 rounded-full', uiState === 'working' || uiState === 'starting' || uiState === 'resuming' ? 'bg-emerald-400' : uiState === 'approval' || uiState === 'input' || uiState === 'paused' ? 'bg-orange-400' : uiState === 'failed' ? 'bg-red-400' : active ? 'bg-accent' : 'bg-zinc-600')} />
                          <span className="min-w-0 flex-1 truncate text-[11px]">{session.name === 'New Session' ? previewText(session.id) ?? session.name : session.name}</span>
                          <span className={cn('shrink-0 font-mono text-[9px]', active ? 'text-ink-3' : 'text-zinc-600')}>{relativeTime(session.updated_at).replace(' ago', '')}</span>
                        </button>
                        {!active ? (
                          <button
                            type="button"
                            onClick={() => void archiveSession(session.id).catch(() => {})}
                            title={`Archive ${session.name}`}
                            aria-label={`Archive ${session.name}`}
                            className="absolute right-1 hidden rounded p-1 text-zinc-600 hover:bg-white/[0.06] hover:text-zinc-200 group-hover:block"
                          >
                            <Archive size={11} />
                          </button>
                        ) : null}
                      </div>
                    )
                  })}
                  {workspace.sessions.length > 5 ? <button type="button" onClick={() => setShowAll((current) => ({ ...current, [workspace.project]: !current[workspace.project] }))} className="w-full rounded-lg px-2 py-1.5 text-left font-mono text-[10px] text-zinc-600 hover:bg-white/[0.04] hover:text-zinc-300">{showAll[workspace.project] ? 'Show less' : `Show ${workspace.sessions.length - 5} more`}</button> : null}
                </div> : null}
              </div>
            )
          })}
        </div>
      </div>
    )
  }

  return (
    <>
      <aside className="hidden w-[324px] shrink-0 border-r border-white/[0.08] bg-[#191613] text-zinc-100 lg:flex">
        <div className="flex w-[68px] shrink-0 flex-col items-center border-r border-white/[0.07] py-3">
          <button type="button" aria-label="Plumb" title="Plumb" className="mb-4 flex size-10 items-center justify-center rounded-xl bg-accent text-[15px] font-bold tracking-[-0.05em] text-accent-ink shadow-lg shadow-black/20">A</button>
          <div className="flex flex-1 flex-col items-center justify-start gap-2" />
          <div className="flex flex-col items-center gap-2">
            <button type="button" onClick={() => onNavigate('automations')} aria-label="Automations" title="Automations" className="flex size-12 items-center justify-center rounded-2xl text-zinc-500 transition hover:bg-white/[0.06] hover:text-zinc-200"><RadioTower size={26} strokeWidth={1.7} /></button>
            <button type="button" onClick={() => onNavigate('skills')} aria-label="Skills" title="Skills" className="flex size-12 items-center justify-center rounded-2xl text-zinc-500 transition hover:bg-white/[0.06] hover:text-zinc-200"><Sparkles size={26} strokeWidth={1.7} /></button>
            <button type="button" onClick={() => onNavigate('remote')} aria-label="Remote" title="Remote" className="flex size-12 items-center justify-center rounded-2xl text-zinc-500 transition hover:bg-white/[0.06] hover:text-zinc-200"><AppWindow size={26} strokeWidth={1.7} /></button>
            <button type="button" onClick={() => onNavigate('settings')} aria-label="Settings" title="Settings" className="flex size-12 items-center justify-center rounded-2xl text-zinc-500 transition hover:bg-white/[0.06] hover:text-zinc-200"><Settings2 size={26} strokeWidth={1.7} /></button>
          </div>
          <span className={cn('mt-3 size-2 rounded-full', connection === 'connected' ? 'bg-green' : connection === 'connecting' || connection === 'reconnecting' ? 'bg-orange-400 breathe' : 'bg-red-400')} title={connection} />
        </div>

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="border-b border-white/[0.07] px-3 pb-3 pt-3">
            <div className="mb-2 flex items-center gap-2 px-1">
              <div className="min-w-0 flex-1"><p className="font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-600">Plumb</p><p className="truncate text-[12px] font-medium text-zinc-300">Control center</p></div>
              <button type="button" onClick={onNewTask} className="flex size-8 items-center justify-center rounded-lg bg-accent text-accent-ink transition hover:bg-accent-hover" aria-label="New task"><Plus size={16} /></button>
            </div>
            <button type="button" onClick={onNewTask} className="flex w-full items-center justify-between rounded-lg px-2 py-2 text-[12px] font-medium text-zinc-200 transition hover:bg-white/[0.06]"><span className="flex items-center gap-2"><Plus size={14} className="text-zinc-500" /> New task</span><kbd className="font-mono text-[9px] text-zinc-600">Ctrl+N</kbd></button>
            <button type="button" onClick={onSearch} className="flex w-full items-center justify-between rounded-lg px-2 py-2 text-[12px] font-medium text-zinc-200 transition hover:bg-white/[0.06]"><span className="flex items-center gap-2"><Search size={14} className="text-zinc-500" /> Search</span><kbd className="font-mono text-[9px] text-zinc-600">Ctrl+K</kbd></button>
          </div>
          <div className="flex min-h-0 flex-1 flex-col">
            {renderSessionsPanel()}
          </div>
          <div className="border-t border-white/[0.08] p-2">
            <div className="flex items-center gap-2 rounded-xl bg-white/[0.045] px-2.5 py-2">
              <span className={cn('size-2 rounded-full', connection === 'connected' ? 'bg-green' : 'bg-zinc-600')} />
              <div className="min-w-0 flex-1"><p className="text-[11px] font-medium text-zinc-200">{connection === 'connected' ? 'Station connected' : 'Station offline'}</p><p className="truncate font-mono text-[9px] text-zinc-600">localhost · {connection}</p></div>
              <button type="button" onClick={() => onNavigate('remote')} className="rounded-md p-1 text-zinc-600 hover:bg-white/[0.08] hover:text-zinc-200" aria-label="Open remote control"><AppWindow size={13} /></button>
            </div>
          </div>
        </div>
      </aside>

      <div className="lg:hidden">
        <button type="button" onClick={() => setMobileOpen((value) => !value)} className="fixed bottom-[4.5rem] right-4 z-30 flex size-12 items-center justify-center rounded-full bg-accent text-accent-ink shadow-xl" aria-label={mobileOpen ? 'Close command center' : 'Open command center'}>{mobileOpen ? <X size={19} /> : <LayoutGrid size={19} />}</button>
        {mobileOpen ? <div className="fixed inset-0 z-40"><button type="button" className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setMobileOpen(false)} aria-label="Close command center" /><section className="absolute inset-x-0 bottom-0 flex max-h-[82dvh] min-h-[58dvh] flex-col rounded-t-2xl border border-white/10 bg-[#191613] shadow-2xl animate-sheet" aria-label="Command center">
          <div className="shrink-0 border-b border-white/[0.07] px-4 pb-3 pt-2"><div className="mx-auto mb-3 h-1 w-10 rounded-full bg-white/20" /><div className="flex items-center gap-2"><div className="flex-1"><p className="font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-600">Command center</p><p className="text-[13px] font-semibold text-white">Workspaces</p></div><button type="button" onClick={() => { onNewTask(); setMobileOpen(false) }} className="rounded-lg bg-accent px-2.5 py-1.5 text-[11px] font-semibold text-accent-ink">New task</button></div></div>
          <div className="flex min-h-0 flex-1 flex-col">{renderSessionsPanel()}</div>
          <div className="shrink-0 border-t border-white/[0.08] p-3"><div className="flex items-center gap-2 text-[11px] text-zinc-500"><span className={cn('size-2 rounded-full', connection === 'connected' ? 'bg-green' : 'bg-zinc-600')} /> {connection === 'connected' ? 'Station connected' : 'Station offline'}<button type="button" onClick={() => onNavigate('automations')} className="ml-auto text-zinc-300">Automations</button><button type="button" onClick={() => onNavigate('skills')} className="text-zinc-300">Skills</button></div></div>
        </section></div> : null}
      </div>
    </>
  )
}

function previewText(sessionId: string): string | undefined {
  const conversation = getConversation(sessionId)
  for (let index = conversation.messages.length - 1; index >= 0; index -= 1) {
    for (const part of conversation.messages[index].parts) {
      if (part.kind === 'text' && part.text.trim()) return part.text.trim().slice(0, 30)
    }
  }
  return undefined
}
