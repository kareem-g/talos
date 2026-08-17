import { useCallback, useEffect, useMemo, useState } from 'react'
import { ArrowLeft, FolderGit2, Plus, RefreshCw } from 'lucide-react'
import { useNavigate, useParams } from 'react-router-dom'
import { workspaceKey, decodeWorkspaceRoute } from '../../lib/workspaces'

interface WorkspaceSession {
  id: string
  name: string
  agent: string
  status: string
  project?: string
  updated_at?: string
}

function statusLabel(status: string) {
  return status.replace(/_/g, ' ')
}

export function WorkspaceView() {
  const { project } = useParams<{ project: string }>()
  const navigate = useNavigate()
  const projectPath = decodeWorkspaceRoute(project)
  const [sessions, setSessions] = useState<WorkspaceSession[]>([])
  const [includeArchived, setIncludeArchived] = useState(false)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const response = await fetch(`/api/sessions${includeArchived ? '?include_archived=true' : ''}`)
      if (!response.ok) throw new Error('Could not load workspace sessions.')
      const data = await response.json() as { sessions?: WorkspaceSession[] }
      setSessions((data.sessions || []).filter((session) => workspaceKey(session.project) === projectPath))
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Could not load workspace sessions.')
    } finally {
      setLoading(false)
    }
  }, [includeArchived, projectPath])

  useEffect(() => { void load() }, [load])

  const active = useMemo(() => sessions.filter((session) => session.status !== 'archived'), [sessions])
  const archived = useMemo(() => sessions.filter((session) => session.status === 'archived'), [sessions])

  return (
    <main className="mobile-app min-h-screen bg-canvas px-4 py-5 text-ink sm:px-8 sm:py-8">
      <div className="mx-auto w-full max-w-3xl">
        <header className="flex items-start gap-3 border-b border-line pb-5">
          <button type="button" onClick={() => navigate('/')} className="flex size-11 shrink-0 items-center justify-center rounded-control text-ink-2 hover:bg-hover" aria-label="Back home">
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div className="min-w-0 flex-1">
            <div className="flex items-center gap-2">
              <FolderGit2 className="h-4 w-4 shrink-0 text-accent" />
              <h1 className="truncate text-lg font-semibold">{projectPath === '/' ? 'Desktop workspace' : projectPath.split('/').filter(Boolean).pop()}</h1>
            </div>
            <p className="mt-1 break-all font-mono text-xs text-ink-3">{projectPath}</p>
          </div>
          <button type="button" onClick={() => void load()} disabled={loading} className="flex size-11 items-center justify-center rounded-control border border-line text-ink-2 hover:bg-hover disabled:opacity-50" aria-label="Refresh workspace">
            <RefreshCw className={loading ? 'h-4 w-4 animate-spin' : 'h-4 w-4'} />
          </button>
        </header>

        <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-medium uppercase tracking-[0.14em] text-ink-3">Workspace sessions</p>
            <p className="mt-1 text-sm text-ink-2">{active.length} active · {archived.length} archived</p>
          </div>
          <div className="flex items-center gap-2">
            <button type="button" onClick={() => setIncludeArchived((value) => !value)} className={`min-h-11 rounded-control border px-3 text-xs font-medium ${includeArchived ? 'border-ink bg-ink text-canvas' : 'border-line text-ink-2 hover:bg-hover'}`}>
              {includeArchived ? 'Hide archived' : 'Show archived'}
            </button>
            <button type="button" onClick={() => navigate(`/?project=${encodeURIComponent(projectPath)}`)} className="flex min-h-11 items-center gap-1.5 rounded-control bg-ink px-3 text-xs font-medium text-canvas">
              <Plus className="h-3.5 w-3.5" /> New session
            </button>
          </div>
        </div>

        {error && <p className="mt-5 rounded-card border border-red/25 bg-red-tint px-4 py-3 text-sm text-red">{error}</p>}
        {!loading && sessions.length === 0 && <p className="mt-8 rounded-card border border-dashed border-line px-5 py-12 text-center text-sm text-ink-3">No sessions in this workspace.</p>}
        <div className="mt-5 flex flex-col gap-2">
          {sessions.map((session) => (
            <button key={session.id} type="button" onClick={() => navigate(`/task/${encodeURIComponent(session.id)}`)} className="flex min-h-16 items-center gap-3 rounded-card border border-line bg-surface px-4 py-3 text-left shadow-card hover:bg-hover">
              <span className={`size-2 shrink-0 rounded-full ${session.status === 'running' || session.status === 'starting' ? 'bg-green animate-pulse' : session.status === 'error' ? 'bg-red' : session.status === 'archived' ? 'bg-ink-3' : 'bg-orange'}`} />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-sm font-medium">{session.name}</span>
                <span className="mt-1 block text-xs capitalize text-ink-3">{session.agent} · {statusLabel(session.status)}</span>
              </span>
              <span className="text-xs text-ink-3">Open</span>
            </button>
          ))}
        </div>
      </div>
    </main>
  )
}
