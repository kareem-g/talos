/**
 * EngineModelMenu — in-composer engine/model switcher as an anchored dropdown,
 * not a modal. Opening shows every ready provider; clicking a provider swaps
 * the menu content to that provider's models (with a back row). Picking a model
 * applies: model change for the current engine, engine switch otherwise.
 */

import { useRef, useState } from 'react'
import { ArrowLeft, Bot, Check, ChevronDown } from 'lucide-react'
import { useStore } from '@/store'
import { DropdownList } from './ui'
import { cn } from '@/lib/format'
import type { Session } from '@/types/session'
import type { Provider } from '@/types/provider'

function transportBadge(provider: Provider): string {
  switch (provider.transport) {
    case 'api':
      return 'API'
    case 'acp':
      return 'ACP'
    default:
      return 'CLI'
  }
}

export function EngineModelMenu({
  session,
  compact,
}: {
  session: Session
  compact?: boolean
}) {
  const providers = useStore((s) => s.providers)
  const liveConfig = useStore((s) => s.configs[session.id])
  const switchSessionEngine = useStore((s) => s.switchSessionEngine)
  const setConfig = useStore((s) => s.setConfig)

  const [open, setOpen] = useState(false)
  const [view, setView] = useState<'providers' | 'models'>('providers')
  const [agent, setAgent] = useState<string | null>(null)
  const [model, setModel] = useState<string | undefined>(undefined)
  const [busy, setBusy] = useState(false)
  const chipRef = useRef<HTMLButtonElement>(null)

  const ready = providers.filter((provider) => provider.state === 'ready')
  const current = ready.find((provider) => provider.id === session.agent)
  const picked = ready.find((provider) => provider.id === agent) ?? current ?? null

  function modelOptionOf(provider: Provider | null) {
    if (!provider) return undefined
    if (provider.id === session.agent) {
      const live = liveConfig?.options?.find((option) => option.id === 'model' || option.category === 'model')
      if (live) return live
    }
    return provider.configOptions?.find((option) => option.id === 'model' || option.category === 'model')
  }

  const modelOption = modelOptionOf(picked)
  const currentLabel = modelOption?.currentValue && modelOption.currentValue !== 'Not set'
    ? (modelOption.choices.find((choice) => choice.value === modelOption.currentValue)?.name ?? modelOption.currentValue)
    : undefined
  const label = currentLabel ?? current?.name ?? session.agent

  function chooseProvider(provider: Provider) {
    setAgent(provider.id)
    const option = modelOptionOf(provider)
    setModel(option?.currentValue && option.currentValue !== 'Not set'
      ? option.currentValue
      : option?.choices?.[0]?.value)
    setView('models')
  }

  async function chooseModel(value: string) {
    if (!picked || busy) return
    setBusy(true)
    try {
      if (picked.id === session.agent) {
        const applied = await setConfig(session.id, 'model', value)
        if (applied.applied === 'unsupported') return
      } else {
        const ok = await switchSessionEngine(session.id, picked.id, value)
        if (!ok) return
      }
      setOpen(false)
    } finally {
      setBusy(false)
    }
  }

  function reset() {
    setView('providers')
    setAgent(null)
    setModel(undefined)
  }

  return (
    <div className="relative shrink-0">
      <button
        ref={chipRef}
        type="button"
        onClick={() => {
          reset()
          setOpen((value) => !value)
        }}
        aria-expanded={open}
        aria-haspopup="menu"
        title={`Switch engine or model · currently ${label}`}
        className={cn(
          'inline-flex min-h-8 max-w-full shrink-0 items-center gap-1.5 rounded-lg border border-line/50 bg-surface/80 px-2.5',
          'text-[11.5px] transition-all duration-150 hover:bg-hover hover:border-line-strong',
          open && 'border-line-strong bg-hover',
          compact && 'px-1.5 py-0.5 font-mono text-[10px]',
        )}
      >
        <Bot size={compact ? 11 : 13} className="shrink-0 opacity-70" />
        <span className={cn('min-w-0 truncate font-medium', compact ? 'max-w-24' : 'max-w-40')}>{label}</span>
        <ChevronDown size={11} className={cn('shrink-0 opacity-60 transition-transform', open && 'rotate-180')} />
      </button>

      {open ? (
        <DropdownList anchorRef={chipRef} onClose={() => setOpen(false)} width={300}>
          {view === 'providers' ? (
            <div role="menu" className="py-1">
              <p className="px-3 pb-1 pt-0.5 font-mono text-[9.5px] uppercase tracking-[0.12em] text-ink-3">
                Switch engine · then pick a model
              </p>
              <div className="scroll-thin max-h-72 min-h-0 space-y-0.5 overflow-y-auto overscroll-contain px-1">
                {ready.length === 0 ? (
                  <p className="px-3 py-4 text-center text-[12px] text-ink-3">
                    No ready agents — install/authenticate a CLI or add an API provider in Settings.
                  </p>
                ) : (
                  ready.map((provider) => {
                    const isCurrent = provider.id === session.agent
                    const option = modelOptionOf(provider)
                    const modelName = option?.currentValue && option.currentValue !== 'Not set'
                      ? (option.choices.find((choice) => choice.value === option.currentValue)?.name ?? option.currentValue)
                      : undefined
                    return (
                      <button
                        key={provider.id}
                        type="button"
                        role="menuitem"
                        onClick={() => chooseProvider(provider)}
                        className="flex w-full items-center gap-2.5 rounded-md px-2 py-2 text-left transition-colors hover:bg-hover-2"
                      >
                        <span className="min-w-0 flex-1">
                          <span className="flex items-center gap-1.5">
                            <span className="truncate text-[12px] font-medium text-ink">{provider.name}</span>
                            {isCurrent ? (
                              <span className="shrink-0 rounded-[4px] bg-accent/15 px-1 py-px font-mono text-[9px] uppercase text-accent-ink">
                                current
                              </span>
                            ) : null}
                          </span>
                          <span className="mt-0.5 block truncate font-mono text-[10px] text-ink-3">
                            {modelName ?? provider.id}
                          </span>
                        </span>
                        <span className="shrink-0 rounded-[4px] border border-line/70 bg-surface px-1 py-px font-mono text-[9px] uppercase text-ink-3">
                          {transportBadge(provider)}
                        </span>
                      </button>
                    )
                  })
                )}
              </div>
            </div>
          ) : (
            <div role="menu" className="py-1">
              <button
                type="button"
                onClick={() => setView('providers')}
                className="flex w-full items-center gap-1.5 border-b border-line/50 px-2.5 py-1.5 text-left text-[11px] text-ink-2 transition-colors hover:bg-hover-2"
              >
                <ArrowLeft size={12} />
                <span className="truncate">{picked?.name ?? 'Providers'}</span>
                {model ? <span className="ml-auto truncate font-mono text-ink-3">{model}</span> : null}
              </button>
              <div className="scroll-thin max-h-72 min-h-0 space-y-0.5 overflow-y-auto overscroll-contain p-1">
                {(modelOption?.choices ?? []).map((choice) => (
                  <button
                    key={choice.value}
                    type="button"
                    role="menuitemradio"
                    aria-checked={model === choice.value}
                    disabled={busy}
                    onClick={() => void chooseModel(choice.value)}
                    className={cn(
                      'flex w-full items-center justify-between gap-2 rounded-md px-2 py-1.5 text-left transition-colors hover:bg-hover-2 disabled:opacity-50',
                      model === choice.value && 'bg-accent-tint',
                    )}
                  >
                    <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-ink-2">{choice.name}</span>
                    {model === choice.value ? <Check size={13} className="shrink-0 text-accent-ink" /> : null}
                  </button>
                ))}
                {(modelOption?.choices ?? []).length === 0 ? (
                  <p className="px-3 py-4 text-center text-[11.5px] text-ink-3">
                    No model list — {picked?.id === session.agent ? 'change the model through its own config' : `${picked?.name} will use its default`}.
                  </p>
                ) : null}
              </div>
            </div>
          )}
        </DropdownList>
      ) : null}
    </div>
  )
}
