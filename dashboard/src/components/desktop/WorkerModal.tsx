/**
 * WorkerModal — create a room worker as a popup, not an inline row.
 *
 * One card, three choices: identity (name + gradient tile + optional emoji
 * glyph), then skills (registry skills the harness will prompt the worker
 * in). The live tile preview on the left always shows exactly what the
 * roster will render, so there are no surprises after creating.
 */

import { useEffect, useMemo, useState } from 'react'
import { Check, Loader2, Search, Sparkles, X } from 'lucide-react'
import { skillsApi, type RegistrySkill } from '@/lib/api'
import { cn } from '@/lib/format'
import type { NewWorkerDetails } from '@/lib/rooms'
import { AVATAR_EMOJIS, AVATAR_GRADIENTS, WorkerAvatar } from './RoomAvatars'

const NAME_SUGGESTIONS = ['Scout', 'Maven', 'Sage', 'Forge', 'Pixel', 'Atlas', 'Nova', 'Echo', 'Ledger', 'Pilot']

export function WorkerModal({
  roomName,
  existingNames,
  initial,
  title,
  saveLabel,
  onClose,
  onCreate,
}: {
  roomName: string
  /** Roster names, lowercased comparison for the duplicate guard. */
  existingNames: string[]
  /** Edit mode: prefill from the existing worker (its own name is allowed). */
  initial?: NewWorkerDetails
  title?: string
  saveLabel?: string
  onClose: () => void
  /** Persist the worker (hidden session + roster); rejects on failure. */
  onCreate: (details: NewWorkerDetails) => Promise<void>
}) {
  const [name, setName] = useState(initial?.name ?? '')
  const [gradient, setGradient] = useState(
    () => initial?.avatar?.gradient ?? Math.floor(Math.random() * AVATAR_GRADIENTS.length),
  )
  const [emoji, setEmoji] = useState(initial?.avatar?.emoji ?? '')
  const [skills, setSkills] = useState<string[]>(initial?.skills ?? [])
  const [query, setQuery] = useState('')
  const [catalog, setCatalog] = useState<RegistrySkill[]>([])
  const [loadingSkills, setLoadingSkills] = useState(true)
  const [skillsError, setSkillsError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  useEffect(() => {
    let cancelled = false
    skillsApi
      .available()
      .then((body) => {
        if (!cancelled) setCatalog(body.skills ?? [])
      })
      .catch((cause: unknown) => {
        if (!cancelled) setSkillsError(cause instanceof Error ? cause.message : 'Could not load skills')
      })
      .finally(() => {
        if (!cancelled) setLoadingSkills(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  // Escape closes; the card stops propagation so only the backdrop dismisses.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const taken = useMemo(() => new Set(existingNames.map((n) => n.toLowerCase())), [existingNames])
  const trimmed = name.trim()
  const ownName = (initial?.name ?? '').toLowerCase()
  const duplicate =
    trimmed.length > 0 && trimmed.toLowerCase() !== ownName && taken.has(trimmed.toLowerCase())

  const visibleSkills = useMemo(() => {
    const needle = query.trim().toLowerCase()
    if (!needle) return catalog
    return catalog.filter((skill) =>
      `${skill.name} ${skill.description} ${skill.category ?? ''}`.toLowerCase().includes(needle),
    )
  }, [catalog, query])

  function toggleSkill(id: string) {
    setSkills((current) => (current.includes(id) ? current.filter((s) => s !== id) : [...current, id]))
  }

  async function create() {
    if (!trimmed || duplicate || busy) return
    setBusy(true)
    setError(undefined)
    try {
      await onCreate({
        name: trimmed,
        avatar: { gradient, ...(emoji ? { emoji } : {}) },
        ...(skills.length > 0 ? { skills } : {}),
      })
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not create worker')
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={title ?? 'New worker'}>
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
      <div className="relative flex max-h-[88vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-white/10 bg-[#241f1a] shadow-2xl animate-sheet">
        {/* Header */}
        <div className="flex shrink-0 items-center gap-3 border-b border-white/[0.08] px-5 py-4">
          <WorkerAvatar name={trimmed || '?'} avatar={{ gradient, ...(emoji ? { emoji } : {}) }} size={44} ring />
          <div className="min-w-0 flex-1">
            <h2 className="text-[14px] font-semibold text-white">{title ?? 'New worker'}</h2>
            <p className="truncate font-mono text-[11px] text-zinc-500">in {roomName}</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex size-8 shrink-0 items-center justify-center rounded-lg text-zinc-500 transition hover:bg-white/[0.06] hover:text-zinc-200"
          >
            <X size={15} />
          </button>
        </div>

        {/* Body */}
        <div className="scroll-thin min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
          {/* Name */}
          <section>
            <label htmlFor="worker-name" className="mb-1.5 block font-mono text-[10.5px] font-medium uppercase tracking-[0.1em] text-zinc-400">
              Name
            </label>
            <input
              id="worker-name"
              autoFocus
              value={name}
              onChange={(e) => setName(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  void create()
                }
              }}
              placeholder="e.g. Scout"
              maxLength={24}
              className="h-9 w-full rounded-xl border border-white/10 bg-black/30 px-3 text-[13px] text-white outline-none transition placeholder:text-zinc-600 focus:border-white/25"
            />
            {duplicate ? (
              <p className="mt-1.5 text-[11px] text-red-400">“{trimmed}” is already on this roster.</p>
            ) : (
              <div className="mt-2 flex flex-wrap gap-1.5">
                {NAME_SUGGESTIONS.filter((s) => !taken.has(s.toLowerCase())).slice(0, 6).map((suggestion) => (
                  <button
                    key={suggestion}
                    type="button"
                    onClick={() => setName(suggestion)}
                    className="rounded-full border border-white/10 bg-white/[0.04] px-2.5 py-1 text-[11px] text-zinc-300 transition hover:bg-white/[0.08] hover:text-white"
                  >
                    {suggestion}
                  </button>
                ))}
              </div>
            )}
          </section>

          {/* Tile */}
          <section>
            <span className="mb-1.5 block font-mono text-[10.5px] font-medium uppercase tracking-[0.1em] text-zinc-400">
              Tile
            </span>
            <div className="flex flex-wrap gap-2">
              {AVATAR_GRADIENTS.map((background, index) => (
                <button
                  key={background}
                  type="button"
                  onClick={() => setGradient(index)}
                  aria-label={`Tile color ${index + 1}`}
                  aria-pressed={gradient === index}
                  style={{ background }}
                  className={cn(
                    'flex size-9 items-center justify-center rounded-xl text-[15px] font-bold text-white transition active:scale-95',
                    gradient === index
                      ? 'ring-2 ring-white ring-offset-2 ring-offset-[#241f1a]'
                      : 'opacity-70 hover:opacity-100',
                  )}
                >
                  {emoji || trimmed.slice(0, 1).toUpperCase() || '?'}
                </button>
              ))}
            </div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => setEmoji('')}
                aria-pressed={emoji === ''}
                title="Name initial"
                className={cn(
                  'flex size-8 items-center justify-center rounded-lg border text-[12px] font-bold transition',
                  emoji === '' ? 'border-white bg-white text-black' : 'border-white/10 text-zinc-400 hover:bg-white/[0.06]',
                )}
              >
                Aa
              </button>
              {AVATAR_EMOJIS.map((glyph) => (
                <button
                  key={glyph}
                  type="button"
                  onClick={() => setEmoji(glyph)}
                  aria-pressed={emoji === glyph}
                  className={cn(
                    'flex size-8 items-center justify-center rounded-lg border text-[15px] transition active:scale-95',
                    emoji === glyph ? 'border-white bg-white/[0.12]' : 'border-white/10 hover:bg-white/[0.06]',
                  )}
                >
                  {glyph}
                </button>
              ))}
            </div>
          </section>

          {/* Skills */}
          <section>
            <span className="mb-1.5 flex items-center gap-1.5 font-mono text-[10.5px] font-medium uppercase tracking-[0.1em] text-zinc-400">
              <Sparkles size={11} />
              Skills
              {skills.length > 0 ? (
                <span className="rounded-full bg-accent px-1.5 py-px font-mono text-[9.5px] font-bold text-accent-ink">
                  {skills.length}
                </span>
              ) : null}
            </span>
            <p className="mb-2 text-[11px] leading-relaxed text-zinc-500">
              The harness prompts this worker in its specialty on every dispatch.
            </p>
            <div className="mb-2 flex h-8 items-center gap-1.5 rounded-lg border border-white/[0.08] bg-black/30 px-2">
              <Search size={12} className="shrink-0 text-zinc-600" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search skills…"
                aria-label="Search skills"
                className="min-w-0 flex-1 bg-transparent text-[12px] text-zinc-200 outline-none placeholder:text-zinc-600"
              />
            </div>
            <div className="scroll-thin max-h-44 overflow-y-auto rounded-xl border border-white/[0.07] bg-black/20 p-1">
              {loadingSkills ? (
                <p className="px-2 py-3 text-center font-mono text-[11px] text-zinc-500">Loading skills…</p>
              ) : skillsError ? (
                <p className="px-2 py-3 text-center text-[11px] text-red-400">{skillsError}</p>
              ) : visibleSkills.length === 0 ? (
                <p className="px-2 py-3 text-center text-[11px] text-zinc-500">
                  {catalog.length === 0 ? 'No skills in the registry.' : `No matches for “${query}”.`}
                </p>
              ) : (
                visibleSkills.map((skill) => {
                  const checked = skills.includes(skill.id)
                  return (
                    <label
                      key={skill.id}
                      className={cn(
                        'flex cursor-pointer items-start gap-2.5 rounded-lg px-2 py-2 transition',
                        checked ? 'bg-white/[0.07]' : 'hover:bg-white/[0.04]',
                      )}
                    >
                      <span
                        className={cn(
                          'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded border transition',
                          checked ? 'border-white bg-white text-black' : 'border-white/20 text-transparent',
                        )}
                      >
                        <Check size={11} strokeWidth={3} />
                      </span>
                      <input type="checkbox" checked={checked} onChange={() => toggleSkill(skill.id)} className="sr-only" />
                      <span className="min-w-0 flex-1">
                        <span className="block text-[12px] font-medium text-zinc-200">{skill.name}</span>
                        <span className="mt-0.5 line-clamp-2 block text-[10.5px] leading-snug text-zinc-500">
                          {skill.description}
                        </span>
                      </span>
                      {skill.category ? (
                        <span className="shrink-0 font-mono text-[9px] uppercase tracking-wide text-zinc-600">
                          {skill.category}
                        </span>
                      ) : null}
                    </label>
                  )
                })
              )}
            </div>
          </section>
        </div>

        {/* Footer */}
        <div className="shrink-0 border-t border-white/[0.08] px-5 py-3.5">
          {error ? <p className="mb-2 text-[11.5px] text-red-400">{error}</p> : null}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onClose}
              disabled={busy}
              className="min-h-10 flex-1 rounded-xl border border-white/10 text-[12.5px] font-medium text-zinc-300 transition hover:bg-white/[0.05] disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void create()}
              disabled={!trimmed || duplicate || busy}
              className="flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-xl bg-accent text-[12.5px] font-semibold text-accent-ink transition hover:bg-accent-hover active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40"
            >
              {busy ? (
                <>
                  <Loader2 size={14} className="animate-spin" /> Saving…
                </>
              ) : (
                (saveLabel ?? 'Create worker')
              )}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
