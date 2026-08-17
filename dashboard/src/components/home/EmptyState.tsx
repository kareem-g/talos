import { useEffect, useState } from 'react'
import { Bot, Code2, Bug, BookOpen, FileSearch, Loader2, Plus, Sparkles } from 'lucide-react'
import { useWebSocketState } from '../../hooks/useWebSocket'
import { createSessionWithDefaultAgent } from '../../lib/sessions'

interface SessionSummary {
  id: string
  name: string
  agent: string
  status: string
}

const STATUS_DOT: Record<string, string> = {
  running: 'bg-green',
  starting: 'bg-accent',
  waiting_for_input: 'bg-orange',
  waiting_for_approval: 'bg-orange',
  needs_resume: 'bg-orange',
  idle: 'bg-ink-3',
  error: 'bg-red',
  exited: 'bg-ink-3',
  archived: 'bg-ink-3',
}

const PROMPTS: Array<{ label: string; detail: string; prompt: string; icon: typeof Bot }> = [
  {
    label: 'Explain something',
    detail: 'Break down a concept or a part of the codebase',
    prompt: 'Explain the architecture of this project and how the main components fit together.',
    icon: BookOpen,
  },
  {
    label: 'Write code',
    detail: 'Implement a feature or a function',
    prompt: 'Help me write a new feature. Suggest the best approach and implement it.',
    icon: Code2,
  },
  {
    label: 'Debug an issue',
    detail: 'Find the root cause and fix it',
    prompt: 'Help me debug the issue I am seeing. Walk through the likely causes and fix the root one.',
    icon: Bug,
  },
  {
    label: 'Analyze a file',
    detail: 'Read and explain a file in the workspace',
    prompt: 'Analyze the most recently changed files in this workspace and summarize what they do.',
    icon: FileSearch,
  },
]

/**
 * Root empty state — the polished landing screen shown when no session is open.
 * Suggested prompts create real sessions (the agent actually starts), recent
 * sessions jump straight back into a conversation. No reloads, no fakes.
 */
export function EmptyState({ project, onOpenSession }: { project?: string; onOpenSession: (id: string) => void }) {
  const [creating, setCreating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sessions, setSessions] = useState<SessionSummary[]>([])
  const stateVersion = useWebSocketState()

  useEffect(() => {
    let cancelled = false
    fetch('/api/sessions')
      .then((res) => res.json())
      .then((data) => {
        if (cancelled) return
        setSessions((data.sessions || []).map((session: Record<string, unknown>) => ({
          id: String(session.id || ''),
          name: String(session.name || 'Untitled'),
          agent: String(session.agent || ''),
          status: String(session.status || 'idle'),
        })))
      })
      .catch(() => { /* non-fatal: empty state still renders */ })
    return () => { cancelled = true }
  }, [stateVersion])

  const createSession = async (prompt: string) => {
    if (creating) return
    setCreating(true)
    setError(null)
    try {
      const id = await createSessionWithDefaultAgent(prompt, project)
      onOpenSession(id)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create the session.')
    } finally {
      setCreating(false)
    }
  }

  const recent = sessions.slice(0, 5)

  return (
    <div className="ai-scroll-thin min-h-0 flex-1 overflow-y-auto">
      <div className="mx-auto flex min-h-full w-full max-w-xl flex-col items-center justify-center px-6 py-14">
        {/* Subtle branding */}
        <div className="flex size-12 items-center justify-center rounded-control bg-accent-tint">
          <Bot className="h-6 w-6 text-accent" />
        </div>
        <h1 className="mt-5 text-[26px] font-semibold tracking-tight text-ink">How can I help?</h1>
        <p className="mt-1.5 text-[13px] text-ink-2">
          Start a conversation with your agent — or pick a suggestion.
        </p>

        {error && (
          <p className="mt-4 flex items-center gap-2 rounded-chip border border-red/25 bg-red-tint px-3 py-1.5 text-[11.5px] text-red">
            {error}
          </p>
        )}

        {/* Suggested prompts */}
        <div className="mt-7 grid w-full grid-cols-1 gap-2 sm:grid-cols-2">
          {PROMPTS.map((suggestion) => {
            const Icon = suggestion.icon
            return (
              <button
                key={suggestion.label}
                type="button"
                disabled={creating}
                onClick={() => void createSession(suggestion.prompt)}
                className="group flex items-start gap-3 rounded-card border border-line bg-surface p-3.5 text-left shadow-card transition-colors hover:border-line-strong hover:bg-hover disabled:opacity-60"
              >
                <span className="mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-control bg-accent-tint text-accent transition-transform group-hover:scale-105">
                  <Icon className="h-4 w-4" />
                </span>
                <span className="min-w-0">
                  <span className="flex items-center gap-1.5 text-[13px] font-medium text-ink">
                    {suggestion.label}
                    <Sparkles className="h-3 w-3 text-ink-3" />
                  </span>
                  <span className="mt-0.5 block text-[11.5px] leading-5 text-ink-3">{suggestion.detail}</span>
                </span>
              </button>
            )
          })}
        </div>

        {/* New session button */}
        <button
          type="button"
          disabled={creating}
          onClick={() => void createSession('')}
          className="mt-6 flex h-10 items-center justify-center gap-2 rounded-control bg-ink px-5 text-[13px] font-medium transition-transform enabled:active:scale-[0.98] disabled:opacity-60"
          style={{ color: 'hsl(var(--surface))' }}
        >
          {creating ? <Loader2 className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />}
          {creating ? 'Starting agent…' : 'Start a new session'}
        </button>

        {/* Recent sessions */}
        {recent.length > 0 && (
          <div className="mt-10 w-full">
            <div className="mb-2 flex items-center justify-between">
              <span className="text-[10.5px] font-medium uppercase tracking-[0.14em] text-ink-3">Recent sessions</span>
              <span className="text-[10.5px] tabular-nums text-ink-3">{sessions.length} total</span>
            </div>
            <div className="flex flex-col gap-1">
              {recent.map((session) => (
                <button
                  key={session.id}
                  onClick={() => onOpenSession(session.id)}
                  className="flex items-center gap-2.5 rounded-control px-2.5 py-2 text-left transition-colors hover:bg-hover"
                >
                  <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${STATUS_DOT[session.status] || 'bg-ink-3'} ${session.status === 'running' || session.status === 'starting' ? 'animate-pulse' : ''}`} />
                  <span className="min-w-0 flex-1 truncate text-[12.5px] text-ink-2">{session.name}</span>
                  <span className="shrink-0 text-[10.5px] capitalize text-ink-3">{session.agent || 'agent'}</span>
                </button>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
