/**
 * HistoryPage — the Manage › History destination.
 *
 * Every non-archived session, newest first, grouped by day. Tapping a row
 * opens that session in the center pane.
 */

import { History } from 'lucide-react'
import { cn, relativeTime } from '@/lib/format'
import { isInternalSession } from '@/lib/sessionState'
import { useStore } from '@/store'
import type { Session } from '@/types/session'

export function HistoryPage({ onOpenSession }: { onOpenSession: (sessionId: string) => void }) {
  const sessions = useStore((state) => state.sessions)
  const connection = useStore((state) => state.connection)

  const history = sessions
    .filter((session) => session.status !== 'archived' && !isInternalSession(session))
    .slice()
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at))

  const groups = new Map<string, Session[]>()
  for (const session of history) {
    const key = dayLabel(session.updated_at)
    const list = groups.get(key) ?? []
    list.push(session)
    groups.set(key, list)
  }

  return (
    <div className="mx-auto w-full max-w-[720px] px-4 py-6 sm:px-6">
      <header className="mb-5 flex items-center gap-2">
        <span className="flex size-7 items-center justify-center rounded-lg bg-accent-tint">
          <History size={14} className="text-accent" />
        </span>
        <h1 className="text-[18px] font-semibold tracking-[-0.01em] text-ink">History</h1>
        <span className="ml-auto rounded-full bg-surface px-2 py-0.5 font-mono text-[10px] text-ink-3">
          {history.length} session{history.length === 1 ? '' : 's'}
        </span>
      </header>

      {history.length === 0 ? (
        <p className="rounded-card border border-dashed border-line p-6 text-center text-[12px] text-ink-3">
          No sessions yet. Create a task from Home to get started.
        </p>
      ) : (
        [...groups.entries()].map(([label, list]) => (
          <section key={label} className="mb-5">
            <h2 className="mb-2 font-mono text-[10px] font-medium uppercase tracking-[0.16em] text-ink-3">
              {label}
            </h2>
            <ul className="overflow-hidden rounded-card border border-line bg-surface shadow-hairline">
              {list.map((session, index) => (
                <li key={session.id} className={cn(index > 0 && 'border-t border-line/50')}>
                  <button
                    type="button"
                    onClick={() => onOpenSession(session.id)}
                    disabled={connection !== 'connected'}
                    className="flex w-full items-center gap-3 px-4 py-3 text-left transition-colors hover:bg-hover-2 disabled:opacity-50"
                  >
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[13px] font-medium text-ink">
                        {session.name}
                      </span>
                      <span className="block truncate font-mono text-[10.5px] text-ink-3">
                        {session.project ?? 'inbox'} · {session.agent}
                      </span>
                    </span>
                    <span className="shrink-0 font-mono text-[10px] text-ink-3">
                      {relativeTime(session.updated_at)}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          </section>
        ))
      )}
    </div>
  )
}

/** Day bucket label: Today / Yesterday / weekday / date. */
function dayLabel(iso: string): string {
  const date = new Date(iso)
  const now = new Date()
  const startOfDay = (value: Date) => new Date(value.getFullYear(), value.getMonth(), value.getDate()).getTime()
  const days = Math.round((startOfDay(now) - startOfDay(date)) / 86_400_000)
  if (days <= 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 7) return date.toLocaleDateString([], { weekday: 'long' })
  return date.toLocaleDateString([], { month: 'short', day: 'numeric', year: 'numeric' })
}
