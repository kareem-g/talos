/**
 * Sync — adopting sessions that already exist in each CLI's own history.
 *
 * Agent CLIs keep their own transcripts (`~/.codex/sessions`,
 * `~/.claude/projects`, opencode's store), and that history is real, resumable
 * work. This is how it becomes visible here.
 *
 * Discovery is read-only, so opening this sheet writes nothing. Importing is a
 * separate, explicit action — and idempotent, so a user can press Sync as often
 * as they like without accumulating duplicates.
 */

import { useCallback, useEffect, useMemo, useState } from 'react'
import { Button, Check, Dots, Layer, Row, SectionLabel, Chip } from './ui'
import { useStore } from '@/store'
import { basename, relativeTime } from '@/lib/format'
import type { DiscoveredSession } from '@/types/session'

/** Group by provider, newest first within each. */
function groupByAgent(sessions: DiscoveredSession[]) {
  const groups = new Map<string, DiscoveredSession[]>()
  for (const session of sessions) {
    const existing = groups.get(session.agent)
    if (existing) existing.push(session)
    else groups.set(session.agent, [session])
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))
}

export function SyncLayer({ open, onClose }: { open: boolean; onClose: () => void }) {
  const discoverSessions = useStore((state) => state.discoverSessions)
  const syncSessions = useStore((state) => state.syncSessions)
  const providers = useStore((state) => state.providers)

  const [discovered, setDiscovered] = useState<DiscoveredSession[]>()
  const [errors, setErrors] = useState<Array<{ agent: string; message: string }>>([])
  const [loading, setLoading] = useState(false)
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState<string>()
  const [result, setResult] = useState<{ imported: number; skipped: number }>()
  /** Explicit selection. Undefined means "everything importable". */
  const [selected, setSelected] = useState<Set<string>>()

  const load = useCallback(async () => {
    setLoading(true)
    setFailure(undefined)
    try {
      const response = await discoverSessions()
      setDiscovered(response.sessions)
      setErrors(response.errors)
    } catch (cause) {
      setFailure(cause instanceof Error ? cause.message : 'Could not read CLI history')
    } finally {
      setLoading(false)
    }
  }, [discoverSessions])

  useEffect(() => {
    if (open) void load()
  }, [open, load])

  const importable = useMemo(
    () => (discovered ?? []).filter((session) => !session.imported),
    [discovered],
  )
  const groups = useMemo(() => groupByAgent(discovered ?? []), [discovered])

  function providerName(agentId: string): string {
    return providers.find((provider) => provider.id === agentId)?.name ?? agentId
  }

  function key(session: DiscoveredSession): string {
    return `${session.agent}\u0000${session.externalId}`
  }

  /**
   * The current selection.
   *
   * `undefined` means "everything importable" — the useful default, since the
   * common case is importing all of it. Any explicit action materializes the set
   * so partial selections are representable.
   */
  const chosen = useMemo(
    () => selected ?? new Set(importable.map(key)),
    [selected, importable],
  )
  const chosenCount = importable.filter((session) => chosen.has(key(session))).length
  const allChosen = chosenCount === importable.length && importable.length > 0

  function toggle(session: DiscoveredSession) {
    const next = new Set(chosen)
    const id = key(session)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    setSelected(next)
  }

  /** Select or clear everything importable. */
  function toggleAll() {
    setSelected(allChosen ? new Set() : new Set(importable.map(key)))
  }

  /** Select or clear one provider's importable sessions, leaving others alone. */
  function toggleGroup(agent: string) {
    const groupKeys = importable
      .filter((session) => session.agent === agent)
      .map(key)
    const allInGroupChosen = groupKeys.every((id) => chosen.has(id))
    const next = new Set(chosen)
    for (const id of groupKeys) {
      if (allInGroupChosen) next.delete(id)
      else next.add(id)
    }
    setSelected(next)
  }

  async function runSync() {
    setBusy(true)
    setFailure(undefined)
    setResult(undefined)
    try {
      const targets = importable
        .filter((session) => chosen.has(key(session)))
        .map((session) => ({ agent: session.agent, externalId: session.externalId }))

      // An empty selection must not fall through to "import everything", which
      // is exactly what a deselect-all followed by a click would otherwise do.
      if (targets.length === 0) {
        setBusy(false)
        return
      }

      const response = await syncSessions(targets)
      setResult({ imported: response.imported, skipped: response.skipped })

      if (response.failures.length > 0) {
        // Report what could not be saved rather than showing a clean success.
        setFailure(
          `${response.failures.length} session${response.failures.length === 1 ? '' : 's'} could not be imported: ${response.failures[0].message}`,
        )
      }
      // Mark only what was actually requested, so a deselected session is not
      // shown as imported.
      const requested = new Set(targets.map((target) => `${target.agent}\u0000${target.externalId}`))
      setDiscovered((previous) =>
        previous?.map((session) =>
          requested.has(key(session)) ? { ...session, imported: true } : session,
        ),
      )
      setSelected(undefined)
    } catch (cause) {
      setFailure(cause instanceof Error ? cause.message : 'Sync failed')
    } finally {
      setBusy(false)
    }
  }

  if (!open) return null

  return (
    <Layer
      open
      onClose={onClose}
      title="Sync sessions from your CLIs"
      size="lg"
      footer={
        <div className="flex flex-col gap-2">
          {failure ? <p className="text-[11.5px] leading-[1.6] text-red">{failure}</p> : null}
          {result ? (
            <p className="text-[11.5px] text-ink-2">
              Imported {result.imported}
              {result.skipped > 0 ? ` · ${result.skipped} already present` : ''}
            </p>
          ) : null}
          <Button
            variant="primary"
            onClick={() => void runSync()}
            disabled={busy || loading || chosenCount === 0}
            className="min-h-10 w-full"
          >
            {busy
              ? 'Importing…'
              : chosenCount === 0
                ? 'Nothing new to import'
                : `Import ${chosenCount} session${chosenCount === 1 ? '' : 's'}`}
          </Button>
        </div>
      }
    >
      <div className="flex items-center justify-between gap-2 px-2.5 pb-1 pt-1">
        <p className="min-w-0 flex-1 text-[11.5px] leading-[1.6] text-ink-3">
          These sessions live in your CLIs' own history. Importing makes them visible here so you
          can resume them.
        </p>
        {importable.length > 0 ? (
          <button
            type="button"
            onClick={toggleAll}
            className="shrink-0 rounded-[6px] px-1.5 py-1 text-[11px] text-ink-2 transition-colors hover:bg-hover-2 hover:text-ink"
          >
            {allChosen ? 'Deselect all' : 'Select all'}
          </button>
        ) : null}
      </div>

      {loading && !discovered ? (
        <div className="px-2.5 py-6">
          <Dots label="Reading CLI history…" />
        </div>
      ) : null}

      {errors.map((error) => (
        <p key={error.agent} className="px-2.5 py-1 text-[11.5px] leading-[1.6] text-orange">
          {providerName(error.agent)}: {error.message}
        </p>
      ))}

      {discovered && discovered.length === 0 && !loading ? (
        <p className="px-2.5 py-6 text-center text-[12px] leading-[1.6] text-ink-3">
          No sessions found in any CLI's history.
        </p>
      ) : null}

      {groups.map(([agent, sessions]) => {
        const pending = sessions.filter((session) => !session.imported).length
        const groupKeys = importable
          .filter((session) => session.agent === agent)
          .map(key)
        const allInGroupChosen = groupKeys.length > 0 && groupKeys.every((id) => chosen.has(id))
        return (
          <section key={agent}>
            <div className="flex items-center gap-2 px-2.5 pb-1 pt-2.5">
              <h3 className="text-[10.5px] font-medium uppercase tracking-[0.06em] text-ink-3">
                {providerName(agent)}
              </h3>
              <Chip>{pending > 0 ? `${pending} new` : 'all imported'}</Chip>
              {pending > 0 ? (
                <button
                  type="button"
                  onClick={() => toggleGroup(agent)}
                  className="ml-auto rounded-[6px] px-1.5 py-0.5 text-[11px] text-ink-3 transition-colors hover:bg-hover-2 hover:text-ink"
                >
                  {allInGroupChosen ? 'Deselect' : 'Select'}
                </button>
              ) : null}
            </div>
            {sessions.map((session) => (
              <Row
                key={key(session)}
                selected={!session.imported && chosen.has(key(session))}
                onSelect={session.imported ? undefined : () => toggle(session)}
                disabled={session.imported}
                primary={session.title}
                secondary={[
                  session.project ? basename(session.project) : undefined,
                  session.updatedAt ? relativeTime(session.updatedAt) : undefined,
                ]
                  .filter(Boolean)
                  .join(' · ')}
                trailing={
                  session.imported ? (
                    <span className="flex items-center gap-1 text-[11px] text-ink-3">
                      <Check size={11} className="text-green" />
                      here
                    </span>
                  ) : undefined
                }
              />
            ))}
          </section>
        )
      })}

      {discovered && discovered.length > 0 ? (
        <div className="flex items-center justify-between px-2.5 pb-1 pt-3">
          <SectionLabel>{discovered.length} found</SectionLabel>
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="rounded-[6px] px-1.5 py-1 text-[11px] text-ink-3 transition-colors hover:bg-hover-2 hover:text-ink disabled:opacity-40"
          >
            {loading ? 'Rescanning…' : 'Rescan'}
          </button>
        </div>
      ) : null}
    </Layer>
  )
}

/** Header affordance that opens the sync sheet. */
export function SyncIcon({ size = 14 }: { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M21 12a9 9 0 0 1-9 9 9 9 0 0 1-7.7-4.4" />
      <path d="M3 12a9 9 0 0 1 9-9 9 9 0 0 1 7.7 4.4" />
      <path d="M21 3v5h-5M3 21v-5h5" />
    </svg>
  )
}
