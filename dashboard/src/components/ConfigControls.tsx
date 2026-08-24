/**
 * Config controls — the model picker and every dimension like it.
 *
 * Contains **no model names, no provider names, and no notion of what "mode" or
 * "effort" mean.** It renders `ConfigOption[]` from the backend. Adding a
 * provider, a model, or a whole new dimension needs no change here — already
 * demonstrated in practice: opencode reports an `effort` dimension nothing in
 * this codebase was written for, and it renders.
 *
 * Three honesty rules, all visible:
 *
 * - A `start_only`/`next_run` dimension says so, so nobody believes a live
 *   switch happened.
 * - Values come from the provider's reported state, so a declined change simply
 *   isn't reflected (and the store surfaces the provider's reason).
 * - `allowsCustomValue` renders a free-text field, keeping a model the backend
 *   never discovered selectable.
 */

import { useMemo, useState } from 'react'
import { Button, Chip, ChevronDown, Layer, Row, SectionLabel, Search, TextField } from './ui'
import { cn } from '@/lib/format'
import type { ConfigOption } from '@/types/provider'

/** Human phrasing for value provenance. Shown only where it aids judgement. */
const SOURCE_NOTES: Record<string, string> = {
  cli_help: 'Parsed from the CLI help text, so this list may be incomplete.',
  catalog: 'A built-in default list, which may be out of date.',
}

function currentLabel(option: ConfigOption): string {
  const current = option.currentValue
  if (!current) {
    // Flag-driven providers (claude/codex) never report a live currentValue,
    // so "Not set" looks broken when a model *is* running. Fall back to the
    // provider's single model or the first choice as an implicit default,
    // keeping the honest "Not set" only when there is truly nothing to show.
    if (option.id === 'model' || option.category === 'model') {
      if (option.choices.length === 1) return option.choices[0].name
      // If the backend sent choices but no current, treat the first choice as
      // the provider's default rather than showing a dead "Not set".
      if (option.choices.length > 0) return option.choices[0].name
    }
    return 'Not set'
  }
  return option.choices.find((choice) => choice.value === current)?.name ?? current
}

/**
 * Group choices by their leading path segment.
 *
 * This is a *display* grouping only. The value is never rebuilt from the parts —
 * ids like `localllm/downloaded:Jackrong/MLX-Qwen3.5-4B-…` would not survive a
 * split-and-rejoin, and the id is what gets sent back to the provider.
 */
function groupChoices(option: ConfigOption) {
  const groups = new Map<string, ConfigOption['choices']>()
  const UNGROUPED = '\u0000'
  for (const choice of option.choices) {
    const slash = choice.value.indexOf('/')
    const key = slash > 0 ? choice.value.slice(0, slash) : UNGROUPED
    const existing = groups.get(key)
    if (existing) existing.push(choice)
    else groups.set(key, [choice])
  }
  return [...groups.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([key, choices]) => ({
      label: key === UNGROUPED ? undefined : key,
      choices,
    }))
}

/** The compact trigger: dimension name plus its current value. */
export function ConfigControl({
  option,
  onChange,
  disabled,
  source,
}: {
  option: ConfigOption
  onChange: (value: string) => void
  disabled?: boolean
  source?: string
}) {
  const [open, setOpen] = useState(false)

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        disabled={disabled}
        aria-label={`${option.name}: ${currentLabel(option)}`}
        className={cn(
          'inline-flex min-h-8 max-w-full items-center gap-1.5 rounded-lg border border-line/50 bg-surface/80 px-2.5',
          'text-[11.5px] transition-all duration-150',
          'enabled:hover:bg-hover enabled:hover:border-line-strong disabled:opacity-40',
        )}
      >
        <span className="shrink-0 text-ink-3">{option.name}</span>
        <span className="min-w-0 max-w-44 truncate font-medium text-ink">
          {currentLabel(option)}
        </span>
        <ChevronDown size={11} className="shrink-0 text-ink-3" />
      </button>

      {open ? (
        <ConfigLayer
          option={option}
          source={source}
          onClose={() => setOpen(false)}
          onChange={(value) => {
            setOpen(false)
            onChange(value)
          }}
        />
      ) : null}
    </>
  )
}

function ConfigLayer({
  option,
  onClose,
  onChange,
  source,
}: {
  option: ConfigOption
  onClose: () => void
  onChange: (value: string) => void
  source?: string
}) {
  const [filter, setFilter] = useState('')
  const [custom, setCustom] = useState('')

  const filtered = useMemo(() => {
    const needle = filter.trim().toLowerCase()
    if (!needle) return option.choices
    return option.choices.filter(
      (choice) =>
        choice.value.toLowerCase().includes(needle) || choice.name.toLowerCase().includes(needle),
    )
  }, [filter, option.choices])

  // Group only when there is enough to warrant it; short lists read better flat.
  const grouped = useMemo(
    () => (option.choices.length > 8 ? groupChoices({ ...option, choices: filtered }) : null),
    [option, filtered],
  )

  const note = source ? SOURCE_NOTES[source] : undefined
  const appliesLater = option.mutability !== 'live'

  return (
    <Layer open onClose={onClose} title={option.name} size="md">
      {appliesLater || note ? (
        <div className="mb-1 flex flex-col gap-1 px-2.5 pt-1">
          {appliesLater ? (
            <p className="text-[11.5px] leading-[1.6] text-orange">
              This provider fixes {option.name.toLowerCase()} when the agent starts, so a change
              applies to the next run.
            </p>
          ) : null}
          {note ? <p className="text-[11.5px] leading-[1.6] text-ink-3">{note}</p> : null}
        </div>
      ) : null}

      {option.choices.length > 8 ? (
        <div className="px-1 pb-1.5">
          <TextField
            type="search"
            value={filter}
            onChange={(changeEvent) => setFilter(changeEvent.target.value)}
            placeholder={`Filter ${option.choices.length} options`}
            aria-label={`Filter ${option.name}`}
            leading={<Search />}
          />
        </div>
      ) : null}

      {grouped
        ? grouped.map((group) => (
            <section key={group.label ?? 'ungrouped'}>
              {group.label ? <SectionLabel>{group.label}</SectionLabel> : null}
              {group.choices.map((choice) => (
                <Row
                  key={choice.value}
                  selected={choice.value === option.currentValue}
                  onSelect={() => onChange(choice.value)}
                  primary={choice.name}
                  // Show the raw id when it differs from the label: it is what
                  // actually gets sent, and users of self-hosted models
                  // recognize their own ids.
                  secondary={choice.name === choice.value ? undefined : choice.value}
                />
              ))}
            </section>
          ))
        : filtered.map((choice) => (
            <Row
              key={choice.value}
              selected={choice.value === option.currentValue}
              onSelect={() => onChange(choice.value)}
              primary={choice.name}
              secondary={choice.description ?? (choice.name === choice.value ? undefined : choice.value)}
            />
          ))}

      {filtered.length === 0 ? (
        <p className="px-2.5 py-8 text-center text-[12px] text-ink-3">
          {option.choices.length === 0
            ? 'This provider reported no options.'
            : 'No matches.'}
        </p>
      ) : null}

      {option.allowsCustomValue ? (
        <form
          className="mt-1.5 border-t border-line px-2.5 pt-2.5"
          onSubmit={(submitEvent) => {
            submitEvent.preventDefault()
            const value = custom.trim()
            if (value) onChange(value)
          }}
        >
          <label className="block pb-1.5 text-[11.5px] text-ink-3" htmlFor={`custom-${option.id}`}>
            Or enter any value this provider accepts
          </label>
          <div className="flex gap-1.5">
            <TextField
              id={`custom-${option.id}`}
              value={custom}
              onChange={(changeEvent) => setCustom(changeEvent.target.value)}
              placeholder="Not listed above"
              className="min-w-0 flex-1"
            />
            <Button type="submit" variant="primary" disabled={!custom.trim()}>
              Use
            </Button>
          </div>
        </form>
      ) : null}
    </Layer>
  )
}

/**
 * A session's dimensions, in a row.
 *
 * Model comes first when present; everything else keeps the provider's own
 * order, since it knows its priorities better than we do.
 */
export function ConfigBar({
  options,
  onChange,
  disabled,
  live,
  modelsSource,
}: {
  options: ConfigOption[]
  onChange: (configId: string, value: string) => void
  disabled?: boolean
  live?: boolean
  modelsSource?: string
}) {
  const ordered = useMemo(() => {
    const isModel = (option: ConfigOption) =>
      option.category === 'model' || option.id === 'model'
    return [...options.filter(isModel), ...options.filter((option) => !isModel(option))]
  }, [options])

  if (ordered.length === 0) return null

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {ordered.map((option) => (
        <ConfigControl
          key={option.id}
          option={option}
          disabled={disabled}
          source={option.id === 'model' ? modelsSource : undefined}
          onChange={(value) => onChange(option.id, value)}
        />
      ))}
      {live === false ? (
        <Chip tone="orange">
          <span title="The agent is not running — changes apply on the next turn.">applies next turn</span>
        </Chip>
      ) : null}
    </div>
  )
}
