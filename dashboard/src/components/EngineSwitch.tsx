/**
 * EngineSwitch — pick a different CLI / ACP / API engine for an OPEN session.
 *
 * Choosing an engine here stops the current agent and relaunches the SAME
 * session row under the new provider, keeping the transcript and seeding the
 * new engine with a digest of the prior conversation (backend
 * `POST /api/sessions/{id}/engine`). Model-only changes inside the same engine
 * stay in the composer chips — this surface is for changing the engine itself,
 * optionally pinning the model the new engine should start with.
 */

import { useEffect, useMemo, useState } from 'react'
import { Button, Layer } from './ui'
import { useStore } from '@/store'
import { cn } from '@/lib/format'
import type { Session } from '@/types/session'
import type { Provider } from '@/types/provider'

function transportLabel(provider: Provider): string {
  switch (provider.transport) {
    case 'api':
      return 'API'
    case 'acp':
      return 'ACP'
    default:
      return 'CLI'
  }
}

export function EngineSwitch({
  session,
  onClose,
}: {
  session: Session
  onClose: () => void
}) {
  const providers = useStore((s) => s.providers)
  const liveConfig = useStore((s) => s.configs[session.id])
  const switchSessionEngine = useStore((s) => s.switchSessionEngine)
  const setConfig = useStore((s) => s.setConfig)
  const [busy, setBusy] = useState(false)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [selectedModel, setSelectedModel] = useState<string | undefined>(undefined)

  // Ready providers — the switch only targets engines that can actually run.
  const ready = useMemo(
    () => providers.filter((provider) => provider.state === 'ready'),
    [providers],
  )
  const selected = ready.find((provider) => provider.id === selectedId) ?? null
  const sameEngine = selected?.id === session.agent

  /** Model option for a provider: live session config for the current engine,
   *  the provider's own reported option otherwise. */
  function modelOptionOf(provider: Provider | null) {
    if (!provider) return undefined
    if (provider.id === session.agent) {
      const live = liveConfig?.options?.find((option) => option.id === 'model' || option.category === 'model')
      if (live) return live
    }
    return provider.configOptions?.find((option) => option.id === 'model' || option.category === 'model')
  }

  const modelOption = modelOptionOf(selected)
  const modelChoices = modelOption?.choices ?? []
  // Different engine: model optional (engine default). Same engine: a model
  // selection is required for the change to mean anything.
  const canApply = !!selected && !busy && (sameEngine ? !!selectedModel : true)

  function pickProvider(provider: Provider) {
    setSelectedId(provider.id)
    const option = modelOptionOf(provider)
    setSelectedModel(
      option?.currentValue && option.currentValue !== 'Not set'
        ? option.currentValue
        : option?.choices?.[0]?.value,
    )
  }

  async function confirm() {
    if (!selected || !canApply) return
    setBusy(true)
    try {
      if (sameEngine) {
        if (!selectedModel) return
        const applied = await setConfig(session.id, 'model', selectedModel)
        if (applied.applied === 'unsupported') return // notice already shown — stay open
      } else {
        const ok = await switchSessionEngine(session.id, selected.id, selectedModel)
        if (!ok) return
      }
      onClose()
    } finally {
      setBusy(false)
    }
  }

  // Start with nothing chosen — the current engine is marked, not preselected,
  // so the confirm action can never be a silent no-op.
  useEffect(() => {
    setSelectedId(null)
    setSelectedModel(undefined)
    setBusy(false)
  }, [session.id])

  return (
    <Layer open onClose={onClose} title="Engine & model" side="bottom" size="lg">
      <div className="flex flex-col gap-3 px-1 pb-2 pt-1">
        <p className="text-[12px] leading-[1.6] text-ink-3">
          Pick another engine to continue this session with it (same conversation, seeded with a
          digest of what happened). Pick the current engine to change just its model.
        </p>

        {/* Engine list */}
        <div className="scroll-thin max-h-64 min-h-0 space-y-1 overflow-y-auto overscroll-contain rounded-control border border-line/70 bg-inset p-1">
          {ready.length === 0 ? (
            <p className="px-3 py-4 text-center text-[12px] text-ink-3">
              No ready agents — install or authenticate a CLI, or add an API provider in Settings.
            </p>
          ) : (
            ready.map((provider) => {
              const isCurrent = provider.id === session.agent
              const active = selectedId === provider.id
              const option = modelOptionOf(provider)
              const modelLabel = option?.currentValue && option.currentValue !== 'Not set'
                ? (option.choices.find((choice) => choice.value === option.currentValue)?.name ?? option.currentValue)
                : undefined
              return (
                <button
                  key={provider.id}
                  type="button"
                  onClick={() => pickProvider(provider)}
                  aria-pressed={active}
                  className={cn(
                    'flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors',
                    active ? 'bg-accent-tint' : 'hover:bg-hover-2',
                  )}
                >
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate text-[12.5px] font-medium text-ink">{provider.name}</span>
                      {isCurrent ? (
                        <span className="shrink-0 rounded-[4px] bg-accent/15 px-1.5 py-px font-mono text-[9px] font-medium uppercase tracking-wide text-accent-ink">
                          current
                        </span>
                      ) : null}
                    </span>
                    <span className="mt-0.5 block truncate font-mono text-[10.5px] text-ink-3">
                      {provider.id}
                      {modelLabel ? ` · ${modelLabel}` : ''}
                    </span>
                  </span>
                  <span className="shrink-0 rounded-[4px] border border-line/70 bg-surface px-1.5 py-px font-mono text-[9px] uppercase tracking-wide text-ink-3">
                    {transportLabel(provider)}
                  </span>
                </button>
              )
            })
          )}
        </div>

        {/* Model picker for the chosen engine */}
        {selected ? (
          <div className="rounded-control border border-line/70 bg-inset p-2">
            <p className="px-1 pb-1 font-mono text-[9.5px] uppercase tracking-[0.14em] text-ink-3">
              {sameEngine ? `Model · ${selected.name} (current engine)` : `Start model · ${selected.name}`}
            </p>
            {modelChoices.length === 0 ? (
              <p className="px-1 py-1 text-[11.5px] text-ink-3">
                {sameEngine
                  ? 'This engine reports no model list — switch via its own config instead.'
                  : `${selected.name} reports no model list — it will use its default.`}
              </p>
            ) : (
              <div className="scroll-thin max-h-44 space-y-0.5 overflow-y-auto overscroll-contain">
                {modelChoices.map((choice) => (
                  <button
                    key={choice.value}
                    type="button"
                    onClick={() => setSelectedModel(choice.value)}
                    aria-pressed={selectedModel === choice.value}
                    className={cn(
                      'flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left transition-colors',
                      selectedModel === choice.value ? 'bg-accent-tint' : 'hover:bg-hover-2',
                    )}
                  >
                    <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-ink-2">
                      {choice.name}
                    </span>
                    {selectedModel === choice.value ? (
                      <span className="shrink-0 text-[10px] font-semibold text-accent-ink">✓</span>
                    ) : null}
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : null}

        {/* Confirm */}
        <div className="flex items-center gap-2 border-t border-line/50 pt-2.5">
          <Button variant="ghost" onClick={onClose} disabled={busy} className="flex-1">
            Cancel
          </Button>
          <Button variant="primary" onClick={() => void confirm()} disabled={!canApply} className="flex-1">
            {busy
              ? 'Applying…'
              : !selected
                ? 'Select an engine'
                : sameEngine
                  ? selectedModel
                    ? 'Change model'
                    : 'Pick a model'
                  : `Switch to ${selected.name}`}
          </Button>
        </div>
      </div>
    </Layer>
  )
}
