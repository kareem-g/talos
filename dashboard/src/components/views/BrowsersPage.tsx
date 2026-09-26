/**
 * BrowsersPage — the Products › Browsers destination.
 *
 * The daemon's built-in CDP browser engine: which sessions have a live
 * engine, and start/stop control. The per-session browser itself renders in
 * the tool panel's Browser tab; this page is the fleet view.
 */

import { useEffect, useState } from 'react'
import { Globe } from 'lucide-react'
import { browserApi, type BrowserInstance } from '@/lib/api'
import { useStore } from '@/store'

export function BrowsersPage() {
  const sessions = useStore((s) => s.sessions)
  const [instances, setInstances] = useState<BrowserInstance[] | null>(null)
  const [busy, setBusy] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    browserApi
      .status()
      .then((data) => {
        if (!cancelled) setInstances(data.sessions ?? [])
      })
      .catch(() => {
        if (!cancelled) setInstances([])
      })
    return () => {
      cancelled = true
    }
  }, [])

  async function toggle(sessionId: string) {
    setBusy(sessionId)
    try {
      const running = (instances ?? []).some((instance) => instance.session_id === sessionId)
      if (running) await browserApi.stop(sessionId)
      else await browserApi.start(sessionId)
      const data = await browserApi.status()
      setInstances(data.sessions ?? [])
    } catch {
      /* status refresh below still runs */
    } finally {
      setBusy(null)
    }
  }

  const withProject = sessions.filter((session) => session.project && session.status !== 'archived')
  const runningIds = new Set((instances ?? []).map((instance) => instance.session_id))

  return (
    <div className="mx-auto w-full max-w-[720px] px-4 py-6 sm:px-6">
      <header className="mb-5 flex items-center gap-2">
        <span className="flex size-7 items-center justify-center rounded-lg bg-accent-tint">
          <Globe size={14} className="text-accent" />
        </span>
        <h1 className="text-[18px] font-semibold tracking-[-0.01em] text-ink">Browsers</h1>
      </header>

      <p className="mb-4 text-[12.5px] leading-relaxed text-ink-3">
        Sessions with a workspace project can run the built-in browser engine — the agent drives
        it through the same tools, and the page renders live in the tool panel.
      </p>

      {instances === null ? (
        <p className="py-8 text-center text-[12px] text-ink-3">Checking browser engines…</p>
      ) : withProject.length === 0 ? (
        <p className="rounded-card border border-dashed border-line p-6 text-center text-[12px] text-ink-3">
          No workspace sessions yet. Open a project to give the agent a browser.
        </p>
      ) : (
        <ul className="overflow-hidden rounded-card border border-line bg-surface shadow-hairline">
          {withProject.map((session, index) => {
            const running = runningIds.has(session.id)
            const instance = (instances ?? []).find((candidate) => candidate.session_id === session.id)
            return (
              <li
                key={session.id}
                className="flex items-center gap-3 px-4 py-3"
                style={index > 0 ? { borderTop: '1px solid var(--line)' } : undefined}
              >
                <span
                  className={cn_dot(running)}
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <span className="block truncate text-[13px] font-medium text-ink">{session.name}</span>
                  <span className="block truncate font-mono text-[10.5px] text-ink-3">
                    {running && instance?.http_port
                      ? `http://127.0.0.1:${instance.http_port}`
                      : session.project}
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => void toggle(session.id)}
                  disabled={busy === session.id}
                  className={cn_toggle(running)}
                >
                  {busy === session.id ? 'Working…' : running ? 'Stop' : 'Start'}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

function cn_dot(running: boolean) {
  return `size-2 shrink-0 rounded-full ${running ? 'bg-green' : 'bg-ink-3/40'}`
}

function cn_toggle(running: boolean) {
  return `shrink-0 rounded-full border px-3 py-1 text-[11px] font-medium transition-colors disabled:opacity-50 ${
    running
      ? 'border-red/30 bg-red-tint text-red hover:bg-red-tint'
      : 'border-line bg-canvas text-ink hover:bg-hover'
  }`
}
