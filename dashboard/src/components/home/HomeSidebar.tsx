import { useMemo, useState } from 'react'
import { useStore } from '@/store'
import { cn, relativeTime } from '@/lib/format'
import { sessionUIState, uiStateRank } from '@/lib/sessionState'
import { getConversation } from '@/store'
import type { Session } from '@/types/session'

type GroupMode = 'group' | 'project'

export function HomeSidebar({
  onNewTask,
  onSearch,
  onSelectSession,
  selectedId,
  searchQuery,
}: {
  onNewTask: () => void
  onSearch: () => void
  onSelectSession: (id: string) => void
  selectedId?: string
  searchQuery: string
}) {
  const sessions = useStore((s) => s.sessions)
  const connection = useStore((s) => s.connection)
  const [groupMode, setGroupMode] = useState<GroupMode>('project')
  const [showAutomations, setShowAutomations] = useState(false)
  const [showSkills, setShowSkills] = useState(false)
  const [expanded, setExpanded] = useState<Record<string, boolean>>({})
  const [showAll, setShowAll] = useState<Record<string, boolean>>({})

  const needle = searchQuery.trim().toLowerCase()

  // Derive workspaces grouping
  const workspaces = useMemo(() => {
    const filtered = sessions.filter((s) => s.status !== 'archived')
    const byProject = new Map<string, Session[]>()
    for (const s of filtered) {
      const key = s.project ?? '__inbox__'
      const list = byProject.get(key) ?? []
      list.push(s)
      byProject.set(key, list)
    }
    // Filter by search
    const entries = [...byProject.entries()].map(([project, list]) => {
      let filteredList = list
      if (needle) {
        filteredList = list.filter(
          (s) =>
            s.name.toLowerCase().includes(needle) ||
            s.agent.toLowerCase().includes(needle) ||
            (s.project ?? '').toLowerCase().includes(needle),
        )
      }
      // Sort inside workspace
      const withStates = filteredList
        .map((s) => ({ s, ui: sessionUIState(s, getConversation(s.id), connection) }))
        .sort((a, b) => uiStateRank(a.ui) - uiStateRank(b.ui) || b.s.updated_at.localeCompare(a.s.updated_at))
      return {
        project,
        name: project === '__inbox__' ? 'Inbox' : project.split('/').pop() ?? project,
        sessions: withStates.map((x) => x.s),
        rawCount: list.length,
        filteredCount: withStates.length,
      }
    }).filter((e) => e.filteredCount > 0)
    // Sort workspaces by most recent
    entries.sort((a, b) => {
      const aLatest = a.sessions[0]?.updated_at ?? ''
      const bLatest = b.sessions[0]?.updated_at ?? ''
      return bLatest.localeCompare(aLatest)
    })
    return entries
  }, [sessions, needle, connection])

  const toggle = (project: string) => setExpanded((prev) => ({ ...prev, [project]: !prev[project] }))
  const isExpanded = (project: string) => expanded[project] ?? true
  const toggleShowAll = (project: string) => setShowAll((prev) => ({ ...prev, [project]: !prev[project] }))

  return (
    <aside className="flex w-[280px] shrink-0 flex-col bg-[#0a0a0c] text-zinc-100">
      {/* Top actions */}
      <div className="flex flex-col gap-1 px-3 py-3">
        <button
          type="button"
          onClick={onNewTask}
          className="flex items-center justify-between rounded-lg px-2 py-1.5 text-[13px] font-medium text-zinc-200 transition hover:bg-white/[0.06] active:bg-white/[0.08]"
        >
          <span className="flex items-center gap-2">
            <span className="flex size-5 items-center justify-center rounded-md bg-white text-black">＋</span>
            New task
          </span>
          <span className="font-mono text-[11px] text-zinc-500">Ctrl+N</span>
        </button>
        <button
          type="button"
          onClick={onSearch}
          className="flex items-center justify-between rounded-lg px-2 py-1.5 text-[13px] font-medium text-zinc-200 transition hover:bg-white/[0.06]"
        >
          <span className="flex items-center gap-2">
            <span className="text-zinc-500">⌕</span> Search
          </span>
          <span className="font-mono text-[11px] text-zinc-500">Ctrl+K</span>
        </button>
        <button
          type="button"
          onClick={() => setShowAutomations((v) => !v)}
          className={cn('flex items-center gap-2 rounded-lg px-2 py-1.5 text-[13px] font-medium transition', showAutomations ? 'bg-white/[0.08] text-white' : 'text-zinc-200 hover:bg-white/[0.06]')}
        >
          <span className="text-zinc-500">◈</span> Automations
        </button>
        {showAutomations ? (
          <div className="ml-6 animate-fade rounded-lg border border-white/10 bg-white/[0.03] p-2">
            <p className="font-mono text-[11px] text-zinc-400">No automations yet.</p>
            <p className="mt-1 font-mono text-[10px] text-zinc-500">Create one via <code className="rounded bg-white/10 px-1">agentdeck automations</code></p>
          </div>
        ) : null}
        <button
          type="button"
          onClick={() => setShowSkills((v) => !v)}
          className={cn('flex items-center gap-2 rounded-lg px-2 py-1.5 text-[13px] font-medium transition', showSkills ? 'bg-white/[0.08] text-white' : 'text-zinc-200 hover:bg-white/[0.06]')}
        >
          <span className="text-zinc-500">⚡</span> Skills
        </button>
        {showSkills ? (
          <div className="ml-6 animate-fade space-y-1 rounded-lg border border-white/10 bg-white/[0.03] p-2">
            <p className="font-mono text-[11px] font-medium text-zinc-300">Available skills</p>
            {['frontend-design', 'code-review', 'tdd', 'diagnosing-bugs'].map((s) => (
              <div key={s} className="flex items-center gap-1.5 font-mono text-[11px] text-zinc-400">
                <span className="size-1 rounded-full bg-white/30" /> {s}
              </div>
            ))}
          </div>
        ) : null}

        <div className="mt-2 flex items-center gap-1 rounded-full bg-white/[0.06] p-1">
          <button
            type="button"
            onClick={() => setGroupMode('group')}
            className={cn('flex-1 rounded-full px-2 py-1 text-[11px] font-medium transition', groupMode === 'group' ? 'bg-white text-black' : 'text-zinc-400 hover:text-zinc-200')}
          >
            # Group
          </button>
          <button
            type="button"
            onClick={() => setGroupMode('project')}
            className={cn('flex-1 rounded-full px-2 py-1 text-[11px] font-medium transition', groupMode === 'project' ? 'bg-white text-black' : 'text-zinc-400 hover:text-zinc-200')}
          >
            Project
          </button>
          <span className="flex items-center gap-1 pl-1 pr-1">
            <button type="button" aria-label="Expand all" onClick={() => setExpanded({})} className="rounded p-1 text-zinc-500 hover:bg-white/10 hover:text-zinc-300">
              <span className="text-[11px]">⤢</span>
            </button>
            <button type="button" aria-label="Clear" className="rounded p-1 text-zinc-500 hover:bg-white/10 hover:text-zinc-300">
              <span className="text-[11px]">🗑</span>
            </button>
          </span>
        </div>
      </div>

      {/* Projects */}
      <div className="scroll-thin flex-1 overflow-y-auto px-2 pb-2">
        <div className="px-2 pb-1 pt-2 font-mono text-[10px] uppercase tracking-[0.12em] text-zinc-500">Projects</div>
        {workspaces.length === 0 ? (
          <p className="px-2 py-4 font-mono text-[11px] text-zinc-500">No projects — create a task to start.</p>
        ) : (
          workspaces.map((ws) => {
            const expanded = isExpanded(ws.project)
            const showAllFlag = !!showAll[ws.project]
            const visible = showAllFlag ? ws.sessions : ws.sessions.slice(0, 5)
            return (
              <div key={ws.project} className="mb-2">
                <button
                  type="button"
                  onClick={() => toggle(ws.project)}
                  className="flex w-full items-center gap-1.5 rounded-lg px-2 py-1.5 text-left transition hover:bg-white/[0.04]"
                >
                  <span className={cn('text-zinc-500 transition-transform', expanded ? 'rotate-90' : '')}>▸</span>
                  <span className="text-zinc-500">◧</span>
                  <span className="flex-1 truncate text-[12.5px] font-medium text-zinc-200">{ws.name}</span>
                  {groupMode === 'project' ? <span className="font-mono text-[10px] text-zinc-500">{ws.rawCount}</span> : null}
                </button>
                {expanded ? (
                  <div className="ml-2 border-l border-white/5 pl-2">
                    {visible.map((s) => {
                      const uiState = sessionUIState(s, getConversation(s.id), 'connected')
                      const isActive = s.id === selectedId
                      return (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => onSelectSession(s.id)}
                          className={cn(
                            'flex w-full items-center gap-2 rounded-lg px-2 py-1.5 text-left transition',
                            isActive ? 'bg-white text-black' : 'hover:bg-white/[0.06] text-zinc-300',
                          )}
                        >
                          <span className="min-w-0 flex-1 truncate text-[12px] leading-tight">{s.name === 'New Session' ? previewText(s.id) ?? s.name : s.name}</span>
                          <span className={cn('shrink-0 font-mono text-[11px]', isActive ? 'text-black/60' : 'text-zinc-500')}>{relativeTime(s.updated_at).replace(' ago','')}</span>
                          {uiState === 'approval' || uiState === 'failed' ? <span className="size-1.5 shrink-0 rounded-full bg-amber-500" /> : null}
                        </button>
                      )
                    })}
                    {ws.sessions.length > 5 ? (
                      <button type="button" onClick={() => toggleShowAll(ws.project)} className="w-full rounded-lg px-2 py-1 text-left font-mono text-[11px] text-zinc-500 hover:bg-white/[0.04] hover:text-zinc-300">
                        {showAllFlag ? 'Show less' : 'Show more'}
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            )
          })
        )}
      </div>

      {/* Bottom connect */}
      <div className="border-t border-white/10 p-2">
        <button type="button" className="flex w-full items-center gap-2 rounded-xl bg-white/[0.06] px-2.5 py-2 text-left transition hover:bg-white/[0.08]">
          <span className="flex size-7 items-center justify-center rounded-full bg-white text-black">◐</span>
          <span className="flex-1 text-[13px] font-medium text-white">Connect</span>
          <span className="flex items-center gap-1">
            <span className="rounded p-1 text-zinc-400 hover:bg-white/10">◫</span>
            <span className="rounded p-1 text-zinc-400 hover:bg-white/10">⚙</span>
          </span>
        </button>
      </div>
    </aside>
  )
}

function previewText(sessionId: string): string | undefined {
  const conv = getConversation(sessionId)
  for (let i = conv.messages.length - 1; i >= 0; i--) {
    for (const part of conv.messages[i].parts) {
      if (part.kind === 'text' && part.text.trim()) return part.text.trim().slice(0, 28)
    }
  }
  return undefined
}
