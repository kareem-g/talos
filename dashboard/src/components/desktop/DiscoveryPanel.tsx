/**
 * Desktop discovery panel — inline (not a modal) below the filter bar.
 *
 * Lists sessions found in each CLI's own history, grouped by agent, with
 * selective import. Reuses `api.sessions.discover/sync`; mirrors the mobile
 * `SyncLayer` logic without touching the mobile layout.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Chip, Dots } from '../ui'
import { sessionsApi } from '@/lib/api'
import { useStore } from '@/store'
import { relativeTime, cn } from '@/lib/format'
import type { DiscoverResponse, DiscoveredSession } from '@/types/session'

const AGENT_LABELS: Record<string, string> = {
  claude: 'Claude Code',
  codex: 'Codex',
  opencode: 'OpenCode',
}

function agentLabel(agent: string): string {
  return AGENT_LABELS[agent] ?? agent
}

export function DiscoveryPanel({
  open,
  onClose,
}: {
  open: boolean
  onClose: () => void
}) {
  const loadSessions = useStore((s) => s.loadSessions)
  const syncSessions = useStore((s) => s.syncSessions)
  const starred = useStore((s) => s.starred)

  const [discovery, setDiscovery] = useState<DiscoverResponse | null>(null)
  const [loading, setLoading] = useState(false)
  const [importing, setImporting] = useState(false)
  const [checked, setChecked] = useState<Set<string>>(new Set())
  const [failures, setFailures] = useState<Array<{ key: string; title: string; reason: string }>>([])
  const [toast, setToast] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const result = await sessionsApi.discover()
      setDiscovery(result)
      // Pre-check starred discovered sessions so stars persist through import.
      setChecked((prev) => {
        const next = new Set(prev)
        for (const session of result.sessions) {
          if (!session.imported && starred.includes(discoveredKey(session))) next.add(discoveredKey(session))
        }
        return next
      })
    } catch (error) {
      setDiscovery({
        sessions: [],
        errors: [{ agent: 'discovery', message: error instanceof Error ? error.message : 'Discovery failed' }],
        total: 0,
        pending: 0,
      })
    } finally {
      setLoading(false)
    }
  }, [starred])

  useEffect(() => {
    if (open) void refresh()
  }, [open, refresh])

  // Auto-dismiss toast.
  useEffect(() => {
    if (!toast) return
    const timer = window.setTimeout(() => setToast(null), 4000)
    return () => window.clearTimeout(timer)
  }, [toast])

  const pending = useMemo(() => discovery?.sessions.filter((s) => !s.imported) ?? [], [discovery])

  const grouped = useMemo(() => {
    const groups = new Map<string, DiscoveredSession[]>()
    for (const session of discovery?.sessions ?? []) {
      const list = groups.get(session.agent) ?? []
      list.push(session)
      groups.set(session.agent, list)
    }
    return [...groups.entries()]
  }, [discovery])

  const toggleCheck = (key: string) => {
    setChecked((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const importSelected = async () => {
    const selected = [...checked]
      .map((key) => {
        const [agent, ...rest] = key.split(':')
        return { agent, externalId: rest.join(':') }
      })
    if (selected.length === 0 || importing) return
    setImporting(true)
    setFailures([])
    try {
      const result = await syncSessions(selected)
      await loadSessions()
      if (result.failures.length > 0) {
        // Partial failure: keep panel open, show which failed and why.
        setFailures(
          result.failures.map((f) => ({
            key: `${f.agent}:${f.externalId}`,
            title: f.externalId,
            reason: f.message,
          })),
        )
        setToast(`Imported ${result.imported} session${result.imported === 1 ? '' : 's'}, ${result.failures.length} failed`)
      } else {
        setToast(`Imported ${result.imported} session${result.imported === 1 ? '' : 's'}`)
        onClose()
      }
      setChecked(new Set())
    } catch (error) {
      setFailures([
        {
          key: 'all',
          title: 'Import',
          reason: error instanceof Error ? error.message : 'Import failed',
        },
      ])
    } finally {
      setImporting(false)
    }
  }

  const importAll = async () => {
    if (importing || pending.length === 0) return
    setImporting(true)
    setFailures([])
    try {
      const result = await syncSessions()
      await loadSessions()
      if (result.failures.length > 0) {
        setFailures(
          result.failures.map((f) => ({
            key: `${f.agent}:${f.externalId}`,
            title: f.externalId,
            reason: f.message,
          })),
        )
        setToast(`Imported ${result.imported}, ${result.failures.length} failed`)
      } else {
        setToast(`Imported ${result.imported} session${result.imported === 1 ? '' : 's'}`)
        onClose()
      }
      setChecked(new Set())
    } catch (error) {
      setFailures([
        {
          key: 'all',
          title: 'Import all',
          reason: error instanceof Error ? error.message : 'Import failed',
        },
      ])
    } finally {
      setImporting(false)
    }
  }

  if (!open) return null

  return (
    <div className="border-b border-line bg-surface px-6 py-4">
      <div className="mx-auto flex max-w-[900px] flex-col gap-3">
        <div className="flex items-center gap-2">
          <h3 className="text-[13px] font-medium text-ink">Discovered sessions</h3>
          {discovery ? (
            <span className="text-[11.5px] text-ink-3">
              Found {discovery.total} session{discovery.total === 1 ? '' : 's'}, {discovery.total - pending.length} already imported.
            </span>
          ) : null}
          <div className="ml-auto flex items-center gap-2">
            <Button variant="ghost" onClick={() => void refresh()} disabled={loading}>
              Refresh
            </Button>
            <Button variant="ghost" onClick={onClose}>
              Close
            </Button>
          </div>
        </div>

        {toast ? (
          <div className="rounded-control border border-green/30 bg-green-tint px-3 py-2 text-[12px] text-green">{toast}</div>
        ) : null}

        {loading && !discovery ? (
          <div className="flex h-20 items-center justify-center">
            <Dots label="Scanning CLI histories…" />
          </div>
        ) : (
          <>
            {/* Provider-level errors are warnings, not fatal. */}
            {(discovery?.errors ?? []).map((error) => (
              <div key={error.agent} className="rounded-control border border-orange/30 bg-orange-tint px-3 py-2 text-[12px] text-orange">
                <span className="font-medium">{agentLabel(error.agent)}:</span> {error.message}
              </div>
            ))}

            {failures.length > 0 ? (
              <div className="rounded-control border border-red/30 bg-red-tint px-3 py-2 text-[12px] text-red">
                <p className="font-medium">Some imports failed:</p>
                <ul className="mt-1 list-disc pl-4">
                  {failures.map((failure) => (
                    <li key={failure.key}>
                      {failure.title}: {failure.reason}
                    </li>
                  ))}
                </ul>
              </div>
            ) : null}

            {grouped.length === 0 ? (
              <p className="py-4 text-center text-[12px] text-ink-3">No existing sessions found in CLI histories.</p>
            ) : (
              grouped.map(([agent, agentSessions]) => (
                <div key={agent} className="flex flex-col gap-1">
                  <div className="flex items-center gap-2 pt-1">
                    <Chip tone="default">{agentLabel(agent)}</Chip>
                    <span className="text-[11px] text-ink-3">
                      {agentSessions.filter((s) => !s.imported).length} new
                    </span>
                  </div>
                  {agentSessions.map((session) => {
                    const key = discoveredKey(session)
                    return (
                      <label
                        key={key}
                        className={cn(
                          'flex cursor-pointer items-center gap-3 rounded-control px-3 py-2 transition-colors hover:bg-hover-2',
                          session.imported && 'opacity-60',
                        )}
                      >
                        <input
                          type="checkbox"
                          checked={session.imported || checked.has(key)}
                          disabled={session.imported}
                          onChange={() => toggleCheck(key)}
                          className="size-3.5 accent-[var(--accent)]"
                        />
                        <span className="min-w-0 flex-1">
                          <span className="block truncate text-[12.5px] text-ink">{session.title}</span>
                          <span className="block truncate text-[11px] text-ink-3">
                            {session.project ? `${session.project} · ` : ''}
                            {session.updatedAt ? `Updated ${relativeTime(session.updatedAt)}` : ''}
                          </span>
                        </span>
                        {starred.includes(key) ? <span className="text-[11px] text-orange">★</span> : null}
                        {session.imported ? <span className="text-[11px] text-ink-3">Imported</span> : null}
                      </label>
                    )
                  })}
                </div>
              ))
            )}

            <div className="flex items-center gap-2 pt-1">
              <Button variant="primary" onClick={() => void importSelected()} disabled={importing || checked.size === 0}>
                {importing ? 'Importing…' : `Import selected (${checked.size})`}
              </Button>
              <Button variant="ghost" onClick={() => void importAll()} disabled={importing || pending.length === 0}>
                Import all ({pending.length})
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

/** Stable key for a discovered session — matches what sync sends back. */
export function discoveredKey(session: Pick<DiscoveredSession, 'agent' | 'externalId'>): string {
  return `${session.agent}:${session.externalId}`
}
