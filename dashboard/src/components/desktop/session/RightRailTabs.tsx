/**
 * RightRailTabs — the browser-style tab strip for the right panel.
 *
 * Renders the open tabs (icon + label + close ×, active underlined) as a
 * horizontal strip, plus a "＋" Open-tab button whose dropdown lists every tab
 * type not yet open. Tabs are opened/closed/selected by the parent.
 */

import { useRef, useState } from 'react'
import { Plus, X } from 'lucide-react'
import { DropdownList } from '@/components/ui'
import { cn } from '@/lib/format'
import { RIGHT_TABS, RIGHT_TAB_BY_ID, type RightTabType } from './rightTabs'

export function RightRailTabs({
  tabs,
  active,
  onSelect,
  onClose,
  onAdd,
}: {
  tabs: RightTabType[]
  active: RightTabType
  onSelect: (id: RightTabType) => void
  onClose: (id: RightTabType) => void
  onAdd: (id: RightTabType) => void
}) {
  const [pickerOpen, setPickerOpen] = useState(false)
  const pickerRef = useRef<HTMLButtonElement>(null)
  const available = RIGHT_TABS.filter((tab) => !tabs.includes(tab.id))

  return (
    <div className="flex shrink-0 items-stretch gap-0.5 border-b border-line/40 bg-inset px-2 pt-1.5">
      <div className="scroll-thin flex min-w-0 flex-1 items-stretch gap-0.5 overflow-x-auto">
        {tabs.map((id) => {
          const meta = RIGHT_TAB_BY_ID[id]
          // Persisted tab lists can reference ids the current registry no
          // longer has (older build, HMR race) — skip them instead of
          // crashing the whole workspace on startup.
          if (!meta) return null
          const Icon = meta.icon
          const isActive = id === active
          return (
            <div
              key={id}
              className={cn(
                'group relative flex shrink-0 items-center rounded-t-lg',
                isActive ? 'bg-canvas' : 'text-ink-3 hover:bg-hover-2',
              )}
            >
              <button
                type="button"
                onClick={() => onSelect(id)}
                aria-selected={isActive}
                role="tab"
                title={meta.label}
                className={cn(
                  'flex items-center gap-1 rounded-t-lg px-2 py-1.5 text-[10.5px] transition-colors',
                  isActive ? 'text-ink' : 'text-ink-3 hover:text-ink-2',
                )}
              >
                <Icon size={12} />
                <span className="max-w-[96px] truncate">{meta.label}</span>
              </button>
              {(tabs.length > 1 || !isActive) ? (
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation()
                    onClose(id)
                  }}
                  aria-label={`Close ${meta.label}`}
                  title={`Close ${meta.label}`}
                  className="mr-1 flex size-4 shrink-0 items-center justify-center rounded text-ink-3 transition hover:bg-hover-2 hover:text-ink"
                >
                  <X size={10} />
                </button>
              ) : null}
              {isActive ? (
                <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-accent-2" aria-hidden />
              ) : null}
            </div>
          )
        })}
      </div>

      {/* Open-tab add */}
      <div className="flex shrink-0 items-center pb-1">
        <button
          ref={pickerRef}
          type="button"
          onClick={() => setPickerOpen((v) => !v)}
          aria-label="Open a tab"
          title="Open a tab"
          className="flex size-6 shrink-0 items-center justify-center rounded-md text-ink-3 transition-colors hover:bg-hover-2 hover:text-ink"
        >
          <Plus size={14} />
        </button>
        {pickerOpen ? (
          <DropdownList anchorRef={pickerRef} onClose={() => setPickerOpen(false)} width={240}>
            <div className="py-1">
              {available.length === 0 ? (
                <p className="px-3 py-2 text-[11px] text-ink-3">All tabs are already open.</p>
              ) : (
                available.map((tab) => (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => {
                      onAdd(tab.id)
                      setPickerOpen(false)
                    }}
                    className="flex w-full items-center gap-2.5 px-3 py-1.5 text-left transition-colors hover:bg-hover-2"
                  >
                    <tab.icon size={13} className="shrink-0 text-ink-3" />
                    <span className="min-w-0 flex-1">
                      <span className="block truncate text-[11.5px] text-ink">{tab.label}</span>
                      <span className="block truncate text-[9.5px] text-ink-3">{tab.description}</span>
                    </span>
                  </button>
                ))
              )}
            </div>
          </DropdownList>
        ) : null}
      </div>
    </div>
  )
}
