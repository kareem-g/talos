import { useEffect, useMemo, useState, type ComponentType } from 'react'
import {
  Bot,

  ChevronRight,
  Folder,
  AppWindow,
  ListChecks,
  LayoutGrid,
  MessagesSquare,
  PanelLeft,
  Plus,
  Search,
  Settings2,
  RadioTower,
  Sparkles,
  SquareTerminal,
  X,
} from 'lucide-react'
import { useStore, getConversation } from '@/store'
import { cn, relativeTime } from '@/lib/format'
import { sessionUIState } from '@/lib/sessionState'
import type { Session } from '@/types/session'
import {
  WORKSPACE_TABS,
  WorkspacePanel,
  type WorkspaceTab,
} from './WorkspacePanels'

type GroupMode = 'group' | 'project'
type AppSection = 'automations' | 'skills' | 'remote' | 'settings'

const TAB_ICONS: Record<WorkspaceTab, ComponentType<{ size?: number; strokeWidth?: number; className?: string }>> = {
  sessions: MessagesSquare,
  agents: Bot,
  terminals: SquareTerminal,
  browser: AppWindow,
  tasks: ListChecks,
  git: GitBranchIcon,
}

/** Local alias so the rail can keep the classic branch glyph for Git. */
function GitBranchIcon(props: { size?: number; strokeWidth?: number; className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={props.strokeWidth ?? 2} strokeLinecap="round" strokeLinejoin="round" width={props.size ?? 24} height={props.size ?? 24} className={props.className} aria-hidden>
      <line x1="6" x2="6" y1="3" y2="15" />
      <circle cx="18" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M18 9a9 9 0 0 1-9 9" />
    </svg>
  )
}

const STORAGE_KEY = 'agentdeck-sidebar-tab'

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
  const [activeTab, setActiveTab] = useState<WorkspaceTab>(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY) as WorkspaceTab | null
      return stored && WORKSPACE_TABS.some((tab) => tab.id === stored) ? stored : 'sessions'
    } catch {
      return 'sessions'
    }
  })
  const [groupMode, setGroupMode] = useState<GroupMode>('project')
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [showAll, setShowAll] = useState<Record<string, boolean>>({})
  const [mobileOpen, setMobileOpen] = useState(false)
  const needle = searchQuery.trim().toLowerCase()

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, activeTab)
  }, [activeTab])

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (!event.ctrlKey || !event.shiftKey || !/^[1-6]$/.test(event.key)) return
      event.preventDefault()
      setActiveTab(WORKSPACE_TABS[Number(event.key) - 1].id)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

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
          <button type="button" onClick={() => setGroupMode('group')} className={cn('flex-1 rounded-full px-2 py-1 text-[10px] font-medium transition', groupMode === 'group' ? 'bg-white text-black' : 'text-zinc-500 hover:bg-white/5 hover:text-zinc-200')}>Group</button>
          <button type="button" onClick={() => setGroupMode('project')} className={cn('flex-1 rounded-full px-2 py-1 text-[10px] font-medium transition', groupMode === 'project' ? 'bg-white text-black' : 'text-zinc-500 hover:bg-white/5 hover:text-zinc-200')}>Project</button>
          <button type="button" onClick={() => setExpanded({})} className="rounded-lg p-1.5 text-zinc-500 hover:bg-white/5 hover:text-zinc-200" title="Expand all"><PanelLeft size={13} /></button>
        </div>
        <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-2 pb-2">
          <div className="flex items-center justify-between px-2 pb-1 pt-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-zinc-600">Workspaces</span>
            <span className="font-mono text-[10px] text-zinc-600">{sessions.filter((session) => session.status !== 'archived').length}</span>
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
                    return <button key={session.id} type="button" onClick={() => { onSelectSession(session.id); setMobileOpen(false) }} className={cn('group flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left transition', active ? 'bg-white text-black' : 'text-zinc-400 hover:bg-white/[0.05] hover:text-zinc-100')}>
                      <span className={cn('size-1.5 shrink-0 rounded-full', uiState === 'working' || uiState === 'starting' || uiState === 'resuming' ? 'bg-emerald-400' : uiState === 'approval' || uiState === 'input' || uiState === 'paused' ? 'bg-orange-400' : uiState === 'failed' ? 'bg-red-400' : active ? 'bg-black/40' : 'bg-zinc-600')} />
                      <span className="min-w-0 flex-1 truncate text-[11px]">{session.name === 'New Session' ? previewText(session.id) ?? session.name : session.name}</span>
                      <span className={cn('shrink-0 font-mono text-[9px]', active ? 'text-black/55' : 'text-zinc-600')}>{relativeTime(session.updated_at).replace(' ago', '')}</span>
                    </button>
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

  const actions = { onOpenSession: onSelectSession, onNewSession: onNewTask }

  return (
    <>
      <aside className="hidden w-[324px] shrink-0 border-r border-white/[0.08] bg-[#0a0a0c] text-zinc-100 lg:flex">
        <div className="flex w-[68px] shrink-0 flex-col items-center border-r border-white/[0.07] py-3">
          <button type="button" onClick={() => setActiveTab('sessions')} aria-label="Sessions" className="mb-4 flex size-10 items-center justify-center rounded-xl bg-white text-[15px] font-bold tracking-[-0.05em] text-black shadow-lg shadow-black/20">A</button>
          <div className="flex flex-1 flex-col items-center gap-2">
            {WORKSPACE_TABS.map((tab) => {
              const Icon = TAB_ICONS[tab.id]
              const active = activeTab === tab.id
              return <button key={tab.id} type="button" onClick={() => setActiveTab(tab.id)} aria-label={tab.label} aria-current={active ? 'page' : undefined} title={`${tab.label} · Ctrl+Shift+${tab.key}`} className={cn('flex size-12 items-center justify-center rounded-2xl transition', active ? 'bg-white/10 text-white shadow-[inset_0_0_0_1px_rgba(255,255,255,.08)]' : 'text-zinc-500 hover:bg-white/[0.06] hover:text-zinc-200')}><Icon size={26} strokeWidth={1.7} /></button>
            })}
          </div>
          <div className="my-3 h-px w-8 bg-white/[0.08]" />
          <div className="flex flex-col items-center gap-2">
            <button type="button" onClick={() => onNavigate('automations')} aria-label="Automations" title="Automations" className="flex size-12 items-center justify-center rounded-2xl text-zinc-500 transition hover:bg-white/[0.06] hover:text-zinc-200"><RadioTower size={26} strokeWidth={1.7} /></button>
            <button type="button" onClick={() => onNavigate('skills')} aria-label="Skills" title="Skills" className="flex size-12 items-center justify-center rounded-2xl text-zinc-500 transition hover:bg-white/[0.06] hover:text-zinc-200"><Sparkles size={26} strokeWidth={1.7} /></button>
            <button type="button" onClick={() => onNavigate('remote')} aria-label="Remote" title="Remote" className="flex size-12 items-center justify-center rounded-2xl text-zinc-500 transition hover:bg-white/[0.06] hover:text-zinc-200"><AppWindow size={26} strokeWidth={1.7} /></button>
            <button type="button" onClick={() => onNavigate('settings')} aria-label="Settings" title="Settings" className="flex size-12 items-center justify-center rounded-2xl text-zinc-500 transition hover:bg-white/[0.06] hover:text-zinc-200"><Settings2 size={26} strokeWidth={1.7} /></button>
          </div>
          <span className={cn('mt-3 size-2 rounded-full', connection === 'connected' ? 'bg-emerald-400' : connection === 'connecting' || connection === 'reconnecting' ? 'bg-orange-400 breathe' : 'bg-red-400')} title={connection} />
        </div>

        <div className="flex min-w-0 flex-1 flex-col">
          <div className="border-b border-white/[0.07] px-3 pb-3 pt-3">
            <div className="mb-2 flex items-center gap-2 px-1">
              <div className="min-w-0 flex-1"><p className="font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-600">AgentDeck</p><p className="truncate text-[12px] font-medium text-zinc-300">Control center</p></div>
              <button type="button" onClick={onNewTask} className="flex size-8 items-center justify-center rounded-lg bg-white text-black transition hover:bg-zinc-200" aria-label="New task"><Plus size={16} /></button>
            </div>
            <button type="button" onClick={onNewTask} className="flex w-full items-center justify-between rounded-lg px-2 py-2 text-[12px] font-medium text-zinc-200 transition hover:bg-white/[0.06]"><span className="flex items-center gap-2"><Plus size={14} className="text-zinc-500" /> New task</span><kbd className="font-mono text-[9px] text-zinc-600">Ctrl+N</kbd></button>
            <button type="button" onClick={onSearch} className="flex w-full items-center justify-between rounded-lg px-2 py-2 text-[12px] font-medium text-zinc-200 transition hover:bg-white/[0.06]"><span className="flex items-center gap-2"><Search size={14} className="text-zinc-500" /> Search</span><kbd className="font-mono text-[9px] text-zinc-600">Ctrl+K</kbd></button>
          </div>
          <div className="flex min-h-0 flex-1 flex-col">
            {activeTab === 'sessions' ? renderSessionsPanel() : <WorkspacePanel tab={activeTab} actions={actions} />}
          </div>
          <div className="border-t border-white/[0.08] p-2">
            <div className="flex items-center gap-2 rounded-xl bg-white/[0.045] px-2.5 py-2">
              <span className={cn('size-2 rounded-full', connection === 'connected' ? 'bg-emerald-400' : 'bg-zinc-600')} />
              <div className="min-w-0 flex-1"><p className="text-[11px] font-medium text-zinc-200">{connection === 'connected' ? 'Station connected' : 'Station offline'}</p><p className="truncate font-mono text-[9px] text-zinc-600">localhost · {connection}</p></div>
              <button type="button" onClick={() => onNavigate('remote')} className="rounded-md p-1 text-zinc-600 hover:bg-white/[0.08] hover:text-zinc-200" aria-label="Open remote control"><AppWindow size={13} /></button>
            </div>
          </div>
        </div>
      </aside>

      <div className="lg:hidden">
        <button type="button" onClick={() => setMobileOpen((value) => !value)} className="fixed bottom-[4.5rem] right-4 z-30 flex size-12 items-center justify-center rounded-full bg-white text-black shadow-xl" aria-label={mobileOpen ? 'Close command center' : 'Open command center'}>{mobileOpen ? <X size={19} /> : <LayoutGrid size={19} />}</button>
        {mobileOpen ? <div className="fixed inset-0 z-40"><button type="button" className="absolute inset-0 bg-black/70 backdrop-blur-sm" onClick={() => setMobileOpen(false)} aria-label="Close command center" /><section className="absolute inset-x-0 bottom-0 flex max-h-[82dvh] min-h-[58dvh] flex-col rounded-t-2xl border border-white/10 bg-[#0a0a0c] shadow-2xl animate-sheet" aria-label="Command center">
          <div className="shrink-0 border-b border-white/[0.07] px-4 pb-3 pt-2"><div className="mx-auto mb-3 h-1 w-10 rounded-full bg-white/20" /><div className="flex items-center gap-2"><div className="flex-1"><p className="font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-600">Command center</p><p className="text-[13px] font-semibold text-white">Agent fleet</p></div><button type="button" onClick={() => { onNewTask(); setMobileOpen(false) }} className="rounded-lg bg-white px-2.5 py-1.5 text-[11px] font-semibold text-black">New task</button></div></div>
          <div className="scroll-thin flex shrink-0 gap-1 overflow-x-auto border-b border-white/[0.07] px-3 py-2">{WORKSPACE_TABS.map((tab) => { const Icon = TAB_ICONS[tab.id]; return <button key={tab.id} type="button" onClick={() => setActiveTab(tab.id)} className={cn('flex min-w-[56px] shrink-0 flex-col items-center gap-1 rounded-lg px-2 py-2 text-[9px]', activeTab === tab.id ? 'bg-white/10 text-white' : 'text-zinc-600')}><Icon size={19} /><span>{tab.label}</span></button> })}</div>
          <div className="flex min-h-0 flex-1 flex-col">{activeTab === 'sessions' ? renderSessionsPanel() : <WorkspacePanel tab={activeTab} actions={actions} />}</div>
          <div className="shrink-0 border-t border-white/[0.08] p-3"><div className="flex items-center gap-2 text-[11px] text-zinc-500"><span className={cn('size-2 rounded-full', connection === 'connected' ? 'bg-emerald-400' : 'bg-zinc-600')} /> {connection === 'connected' ? 'Station connected' : 'Station offline'}<button type="button" onClick={() => onNavigate('automations')} className="ml-auto text-zinc-300">Automations</button><button type="button" onClick={() => onNavigate('skills')} className="text-zinc-300">Skills</button></div></div>
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
