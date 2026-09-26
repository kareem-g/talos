/**
 * RunTaskModal — dispatch a task to a room as a popup with real options.
 *
 * Task text, target workers (multi-select, defaults to the whole roster),
 * and whether the run merges into one answer. Submitting fans out one child
 * per selected worker; the caller opens the channel to watch it land.
 */

import { useEffect, useMemo, useState } from 'react'
import { Check, X, Zap } from 'lucide-react'
import { cn } from '@/lib/format'
import type { Room } from '@/lib/rooms'
import { WorkerAvatar } from './RoomAvatars'

export function RunTaskModal({
  room,
  onClose,
  onRun,
}: {
  room: Room
  onClose: () => void
  /** Run the task; resolves when the dispatch is handed off. */
  onRun: (task: string, workers: string[], merge: boolean) => void
}) {
  const [task, setTask] = useState('')
  const [selected, setSelected] = useState<string[]>(() => room.workers.map((w) => w.name))
  const [merge, setMerge] = useState(true)

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [onClose])

  const trimmed = task.trim()
  const canRun = trimmed.length > 0 && selected.length > 0

  const toggle = (name: string) =>
    setSelected((current) =>
      current.includes(name) ? current.filter((n) => n !== name) : [...current, name],
    )

  const skillOf = useMemo(() => {
    const map = new Map(room.workers.map((w) => [w.name, w.skills ?? []] as const))
    return (name: string) => map.get(name) ?? []
  }, [room.workers])

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" role="dialog" aria-modal="true" aria-label={`Run task in ${room.name}`}>
      <button type="button" aria-label="Close" onClick={onClose} className="absolute inset-0 bg-black/70 backdrop-blur-sm" />
      <div className="relative flex max-h-[88vh] w-full max-w-md flex-col overflow-hidden rounded-2xl border border-line/60 bg-surface shadow-overlay animate-sheet">
        <div className="flex shrink-0 items-center gap-2 border-b border-white/[0.08] px-5 py-4">
          <div className="min-w-0 flex-1">
            <h2 className="flex items-center gap-1.5 text-[14px] font-semibold text-white">
              <Zap size={13} className="text-accent-ink" /> Run task
            </h2>
            <p className="truncate font-mono text-[11px] text-zinc-500">in {room.name}</p>
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

        <div className="scroll-thin min-h-0 flex-1 space-y-5 overflow-y-auto p-5">
          <section>
            <label htmlFor="run-task-text" className="mb-1.5 block font-mono text-[10.5px] font-medium uppercase tracking-[0.1em] text-zinc-400">
              Task
            </label>
            <textarea
              id="run-task-text"
              autoFocus
              value={task}
              onChange={(e) => setTask(e.target.value)}
              rows={4}
              placeholder={`What should ${room.name} do?`}
              className="min-h-[96px] w-full resize-none rounded-xl border border-white/10 bg-black/30 px-3 py-2.5 text-[13px] leading-[1.6] text-zinc-200 outline-none transition placeholder:text-zinc-600 focus:border-white/25"
            />
          </section>

          <section>
            <div className="mb-1.5 flex items-center justify-between">
              <span className="font-mono text-[10.5px] font-medium uppercase tracking-[0.1em] text-zinc-400">
                Workers · {selected.length}/{room.workers.length}
              </span>
              <span className="flex gap-1">
                <button
                  type="button"
                  onClick={() => setSelected(room.workers.map((w) => w.name))}
                  className="rounded-full px-2 py-0.5 font-mono text-[10px] text-zinc-500 transition hover:bg-white/[0.06] hover:text-zinc-200"
                >
                  All
                </button>
                <button
                  type="button"
                  onClick={() => setSelected([])}
                  className="rounded-full px-2 py-0.5 font-mono text-[10px] text-zinc-500 transition hover:bg-white/[0.06] hover:text-zinc-200"
                >
                  None
                </button>
              </span>
            </div>
            {room.workers.length === 0 ? (
              <p className="rounded-xl border border-dashed border-white/10 px-3 py-4 text-center text-[11px] text-zinc-500">
                No workers yet — add some to the roster first.
              </p>
            ) : (
              <div className="scroll-thin max-h-48 space-y-0.5 overflow-y-auto rounded-xl border border-white/[0.07] bg-black/20 p-1">
                {room.workers.map((worker) => {
                  const checked = selected.includes(worker.name)
                  const skills = skillOf(worker.name)
                  return (
                    <label
                      key={worker.name}
                      className={cn(
                        'flex cursor-pointer items-center gap-2.5 rounded-lg px-2 py-2 transition',
                        checked ? 'bg-white/[0.07]' : 'hover:bg-white/[0.04]',
                      )}
                    >
                      <span
                        className={cn(
                          'flex size-4 shrink-0 items-center justify-center rounded border transition',
                          checked ? 'border-white bg-white text-black' : 'border-white/20 text-transparent',
                        )}
                      >
                        <Check size={11} strokeWidth={3} />
                      </span>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => toggle(worker.name)}
                        className="sr-only"
                      />
                      <WorkerAvatar name={worker.name} avatar={worker.avatar} size={24} />
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[12.5px] font-medium text-zinc-200">
                          {worker.name}
                        </span>
                        {skills.length > 0 ? (
                          <span className="block truncate font-mono text-[10px] text-zinc-500">
                            {skills.join(', ')}
                          </span>
                        ) : null}
                      </span>
                      {room.chief === worker.name ? (
                        <span className="shrink-0 rounded-full bg-accent/10 px-1.5 py-px font-mono text-[9px] text-accent/90">
                          chief
                        </span>
                      ) : null}
                    </label>
                  )
                })}
              </div>
            )}
          </section>

          <section>
            <button
              type="button"
              role="switch"
              aria-checked={merge}
              aria-label="Merge answers into one reply"
              onClick={() => setMerge((v) => !v)}
              className="flex w-full items-center gap-2.5 rounded-xl border border-white/[0.07] bg-black/20 px-3 py-2.5 text-left transition hover:bg-white/[0.04]"
            >
              <span
                aria-hidden
                className={cn(
                  'relative h-4 w-7 shrink-0 rounded-full transition-colors duration-150',
                  merge ? 'bg-accent' : 'bg-zinc-700',
                )}
              >
                <span
                  className={cn(
                    'absolute top-0.5 size-3 rounded-full bg-white transition-all duration-150',
                    merge ? 'left-3.5' : 'left-0.5',
                  )}
                />
              </span>
              <span className="min-w-0 flex-1">
                <span className="block text-[12px] font-medium text-zinc-200">Merge into one answer</span>
                <span className="block text-[10.5px] leading-snug text-zinc-500">
                  {merge ? 'The chief synthesizes every answer.' : 'Raw per-worker results, no synthesis.'}
                </span>
              </span>
            </button>
          </section>
        </div>

        <div className="flex shrink-0 gap-2 border-t border-white/[0.08] px-5 py-3.5">
          <button
            type="button"
            onClick={onClose}
            className="min-h-10 flex-1 rounded-xl border border-white/10 text-[12.5px] font-medium text-zinc-300 transition hover:bg-white/[0.05]"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={!canRun}
            onClick={() => {
              if (!canRun) return
              onRun(trimmed, selected, merge)
              onClose()
            }}
            className="flex min-h-10 flex-1 items-center justify-center gap-1.5 rounded-xl bg-accent text-[12.5px] font-semibold text-accent-ink transition hover:bg-accent-hover active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Zap size={13} /> Dispatch{selected.length > 0 ? ` · ${selected.length}` : ''}
          </button>
        </div>
      </div>
    </div>
  )
}
