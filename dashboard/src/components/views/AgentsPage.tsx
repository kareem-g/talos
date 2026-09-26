/**
 * AgentsPage — the Products › Agents destination.
 *
 * Lists every known provider exactly as `/api/providers` reports it: ready
 * ones first, unavailable ones with their remedy (what the user can do
 * about it). No silent vanishes — a CLI the user believes is installed says
 * "not installed" with the fix.
 */

import { Bot } from 'lucide-react'
import { cn } from '@/lib/format'
import { providerExplanation } from '@/types/provider'
import { useStore } from '@/store'

const STATE_LABELS: Record<string, string> = {
  ready: 'Ready',
  not_installed: 'Not installed',
  auth_required: 'Auth required',
  config_required: 'Config required',
  error: 'Error',
}

export function AgentsPage() {
  const providers = useStore((s) => s.providers)
  const loadProviders = useStore((s) => s.loadProviders)

  return (
    <div className="mx-auto w-full max-w-[720px] px-4 py-6 sm:px-6">
      <header className="mb-5 flex items-center gap-2">
        <span className="flex size-7 items-center justify-center rounded-lg bg-accent-tint">
          <Bot size={14} className="text-accent" />
        </span>
        <h1 className="text-[18px] font-semibold tracking-[-0.01em] text-ink">Agents</h1>
        <button
          type="button"
          onClick={() => void loadProviders(true)}
          className="ml-auto rounded-lg border border-line/60 bg-surface px-2.5 py-1.5 text-[11px] font-medium text-ink-2 transition-colors hover:bg-hover-2 hover:text-ink"
        >
          Re-scan
        </button>
      </header>

      <p className="mb-4 text-[12.5px] leading-relaxed text-ink-3">
        Providers report themselves — a ready agent can take tasks right now. Entries that are
        not ready say what is missing and how to fix it.
      </p>

      <ul className="overflow-hidden rounded-card border border-line bg-surface shadow-hairline">
        {providers.length === 0 ? (
          <li className="p-6 text-center text-[12px] text-ink-3">
            No providers yet — re-scan to detect installed CLIs.
          </li>
        ) : (
          providers.map((provider, index) => {
            const ready = provider.state === 'ready'
            const explanation = providerExplanation(provider)
            return (
              <li
                key={provider.id}
                className={cn('flex items-center gap-3 px-4 py-3', index > 0 && 'border-t border-line/50')}
              >
                <span
                  className={cn('size-2 shrink-0 rounded-full', ready ? 'bg-green' : 'bg-orange')}
                  aria-hidden
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="text-[13px] font-medium text-ink">{provider.name}</span>
                    <span className="font-mono text-[10px] uppercase tracking-wide text-ink-3">
                      {provider.transport === 'api' ? 'API' : 'CLI'}
                    </span>
                  </div>
                  <p className={cn('mt-0.5 text-[11.5px] leading-snug', ready ? 'text-ink-3' : 'text-orange')}>
                    {ready ? 'Ready' : explanation ?? STATE_LABELS[provider.state] ?? provider.state}
                  </p>
                </div>
                <span
                  className={cn(
                    'shrink-0 rounded-full px-2 py-0.5 font-mono text-[10px] font-medium',
                    ready ? 'bg-green-tint text-green' : 'bg-orange-tint text-orange',
                  )}
                >
                  {STATE_LABELS[provider.state] ?? provider.state}
                </span>
              </li>
            )
          })
        )}
      </ul>
    </div>
  )
}
