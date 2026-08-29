/**
 * SettingsScreen — the small print: how the station works, what it can do,
 * and where the levers live. Deliberately short; configuration that matters
 * day-to-day (models, modes) lives in the session workspace instead.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Check, ChevronDown, Chip, Dots, DropdownList, Search, SectionLabel, TextField } from '../ui'
import { apiProvidersApi, type ApiProviderConfig } from '@/lib/api'
import { useStore } from '@/store'
import { cn } from '@/lib/format'

function FancySelect({
  value,
  onChange,
  options,
  placeholder,
  disabled,
}: {
  value: string
  onChange: (v: string) => void
  options: Array<{ value: string; label: string }>
  placeholder?: string
  disabled?: boolean
}) {
  const [open, setOpen] = useState(false)
  const anchorRef = useRef<HTMLButtonElement>(null)
  const selected = options.find((o) => o.value === value)
  return (
    <>
      <button
        ref={anchorRef}
        type="button"
        onClick={() => !disabled && setOpen((v) => !v)}
        disabled={disabled}
        className="flex h-9 w-full items-center justify-between gap-2 rounded-xl border border-white/10 bg-black/30 px-3 text-left text-[13px] text-white outline-none transition-colors hover:border-white/15 focus:border-white/20 focus:bg-black/40 disabled:opacity-50"
      >
        <span className={cn('truncate', !selected && 'text-zinc-500')}>{selected?.label ?? placeholder ?? 'Select…'}</span>
        <ChevronDown size={14} className={cn('shrink-0 text-zinc-500 transition-transform duration-150', open && 'rotate-180')} />
      </button>
      {open ? (
        <DropdownList anchorRef={anchorRef} onClose={() => setOpen(false)} width={anchorRef.current?.offsetWidth ?? 320}>
          <div className="scroll-thin max-h-60 overflow-y-auto overscroll-contain p-1">
            {options.map((opt) => (
              <button
                key={opt.value}
                type="button"
                onClick={() => {
                  onChange(opt.value)
                  setOpen(false)
                }}
                className={cn(
                  'flex w-full items-center justify-between gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors',
                  value === opt.value ? 'bg-white text-black' : 'text-zinc-300 hover:bg-white/5 hover:text-white',
                )}
              >
                <span className="min-w-0 truncate">{opt.label}</span>
                {value === opt.value ? <Check size={12} className="shrink-0 text-black" /> : null}
              </button>
            ))}
          </div>
        </DropdownList>
      ) : null}
    </>
  )
}

interface SettingsInfo {
  config_path?: string
}

function useSettings(): SettingsInfo | undefined {
  const [info, setInfo] = useState<SettingsInfo>()
  useEffect(() => {
    let cancelled = false
    fetch('/api/settings')
      .then((response) => response.json())
      .then((body: { settings?: unknown; config_path?: string }) => {
        if (!cancelled) setInfo({ config_path: body.config_path })
      })
      .catch(() => undefined)
    return () => {
      cancelled = true
    }
  }, [])
  return info
}

const SHORTCUTS: Array<[string, string]> = [
  ['⌘/Ctrl + N', 'New session'],
  ['⌘/Ctrl + K', 'Focus search'],
  ['Esc', 'Close panel / back'],
]

export function SettingsScreen() {
  const info = useSettings()

  return (
    <div className="scroll-thin min-h-0 flex-1 overflow-y-auto overscroll-contain">
      <div className="mx-auto flex w-full max-w-3xl flex-col gap-4 px-4 pb-24 pt-5 sm:px-6 lg:pb-6">
        <div>
          <h1 className="text-[16px] font-semibold tracking-[-0.01em] text-ink">Settings</h1>
          <p className="mt-0.5 text-[12px] leading-[1.6] text-ink-3">
            AgentDeck runs coding agents on this machine and lets you drive them from anywhere.
          </p>
        </div>

        <SectionLabel>How it works</SectionLabel>
        <section className="rounded-card border border-line bg-surface p-3.5 shadow-card">
          <ol className="flex flex-col gap-2 text-[12px] leading-[1.6] text-ink-2">
            <li className="flex gap-2">
              <span className="font-mono text-[11px] text-accent-ink">01</span>
              Install an agent CLI (Claude Code, Codex, OpenCode, Grok Build…) — AgentDeck detects
              it automatically.
            </li>
            <li className="flex gap-2">
              <span className="font-mono text-[11px] text-accent-ink">02</span>
              Start sessions here at the desk; watch tool calls, diffs, and approvals stream live.
            </li>
            <li className="flex gap-2">
              <span className="font-mono text-[11px] text-accent-ink">03</span>
              Scan the pairing QR from Remote — your phone becomes a remote control over Tailnet,
              Cloudflare, or LAN. Leave the machine running.
            </li>
          </ol>
        </section>

        <ApiProvidersSection />

        <SectionLabel>Keyboard</SectionLabel>
        <section className="flex flex-col rounded-card border border-line bg-surface shadow-card">
          {SHORTCUTS.map(([keys, action]) => (
            <div key={keys} className="flex items-center justify-between border-b border-line px-3.5 py-2 last:border-b-0">
              <span className="text-[12px] text-ink-2">{action}</span>
              <Chip mono>{keys}</Chip>
            </div>
          ))}
        </section>

        <SectionLabel>Machine</SectionLabel>
        <section className="rounded-card border border-line bg-surface p-3.5 shadow-card">
          {info === undefined ? (
            <Dots />
          ) : (
            <div className="flex items-center justify-between gap-2">
              <span className="text-[12px] text-ink-2">Config file</span>
              <code className="min-w-0 truncate font-mono text-[11px] text-ink-3">
                {info.config_path ?? '~/.config/agentdeck/config.toml'}
              </code>
            </div>
          )}
          <p className="mt-2 text-[11px] leading-[1.6] text-ink-3">
            Tunnels, MCP servers, worktrees, and notification channels are configured in the TOML
            file — see docs/TUNNELS.md and docs/MCP.md in the repository.
          </p>
        </section>
      </div>
    </div>
  )
}

function ApiProvidersSection() {
  const [providers, setProviders] = useState<ApiProviderConfig[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string>()
  const [showForm, setShowForm] = useState(false)
  const [formError, setFormError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [testResult, setTestResult] = useState<string>()
  const [discovered, setDiscovered] = useState<string[] | null>(null)
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [query, setQuery] = useState('')
  const [editingId, setEditingId] = useState<string | null>(null)
  const filtered = useMemo(() => {
    if (discovered === null) return null
    const q = query.trim().toLowerCase()
    if (!q) return discovered
    return discovered.filter((m) => m.toLowerCase().includes(q))
  }, [discovered, query])
  const loadProviders = useStore((s) => s.loadProviders)
  const [form, setForm] = useState({
    id: '',
    name: '',
    api_url: '',
    api_key: '',
    transport: 'openai_compatible' as 'openai_compatible' | 'anthropic_compatible',
    models: '',
    default_model: '',
  })

  async function refresh() {
    setLoading(true)
    setError(undefined)
    try {
      const list = await apiProvidersApi.list()
      setProviders(list)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not load API providers')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void refresh()
  }, [])

  async function handleTest() {
    setFormError(undefined)
    setTestResult(undefined)
    setQuery('')
    if (!form.api_url.trim()) {
      setFormError('API URL is required to test')
      return
    }
    setBusy(true)
    try {
      const result = await apiProvidersApi.test({
        id: form.id.trim() || 'test',
        name: form.name.trim() || 'Test',
        api_url: form.api_url.trim(),
        api_key: form.api_key || undefined,
        transport: form.transport,
      })
      if (result.ok) {
        const models = result.models ?? []
        if (models.length === 0) {
          setDiscovered([])
          setSelected(new Set())
          setTestResult('No models reported — you can still type any model id below.')
        } else {
          setDiscovered(models)
          // Default to 1 selected (first model) so the user chooses what to expose.
          const initial = new Set<string>([models[0]!])
          setSelected(initial)
          setForm((f) => ({
            ...f,
            models: [...initial].join(', '),
            default_model: f.default_model.trim() ? f.default_model : (models[0] ?? ''),
          }))
          setTestResult(`Found ${models.length} models — 1 selected by default. Check the ones you want to expose.`)
        }
      } else {
        setDiscovered(null)
        setFormError(result.error ?? 'Test failed')
      }
    } catch (e) {
      setDiscovered(null)
      setFormError(e instanceof Error ? e.message : 'Test failed')
    } finally {
      setBusy(false)
    }
  }

  function toggleModel(id: string) {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      // keep form.models in sync so Save uses the chooser
      setForm((f) => ({ ...f, models: [...next].join(', ') }))
      // if default was deselected, clear it
      setForm((f) => (next.has(f.default_model) || !f.default_model ? f : { ...f, default_model: [...next][0] ?? '' }))
      return next
    })
  }

  async function handleCreate() {
    setFormError(undefined)
    if (!form.id.trim() || !form.name.trim() || !form.api_url.trim()) {
      setFormError('ID, name and API URL are required')
      return
    }
    if (discovered !== null && selected.size === 0) {
      setFormError('Select at least one model or switch to Manual and leave models empty to allow any model id.')
      return
    }
    setBusy(true)
    try {
      const models = discovered !== null ? [...selected] : form.models.split(',').map((m) => m.trim()).filter(Boolean)
      await apiProvidersApi.create({
        id: form.id.trim(),
        name: form.name.trim(),
        api_url: form.api_url.trim(),
        api_key: form.api_key || undefined,
        transport: form.transport,
        models,
        default_model: form.default_model.trim() || undefined,
      })
      setForm({ id: '', name: '', api_url: '', api_key: '', transport: 'openai_compatible', models: '', default_model: '' })
      setDiscovered(null)
      setSelected(new Set())
      setQuery('')
      setTestResult(undefined)
      setEditingId(null)
      setShowForm(false)
      await refresh()
      await loadProviders(true)
    } catch (e) {
      setFormError(e instanceof Error ? e.message : 'Could not save provider')
    } finally {
      setBusy(false)
    }
  }

  async function handleDelete(id: string) {
    if (!confirm(`Remove API provider "${id}"?`)) return
    try {
      await apiProvidersApi.remove(id)
      await refresh()
      await loadProviders(true)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not delete')
    }
  }

  function handleEdit(p: ApiProviderConfig) {
    setEditingId(p.id)
    setForm({
      id: p.id,
      name: p.name,
      api_url: p.api_url,
      api_key: '',
      transport: p.transport,
      models: p.models.join(', '),
      default_model: p.default_model ?? '',
    })
    if (p.models.length > 0) {
      setDiscovered(p.models)
      setSelected(new Set(p.models))
    } else {
      setDiscovered(null)
      setSelected(new Set())
    }
    setQuery('')
    setFormError(undefined)
    setTestResult(undefined)
    setShowForm(true)
  }

  return (
    <>
      <SectionLabel>Custom API providers</SectionLabel>
      <section className="rounded-card border border-line bg-surface p-3.5 shadow-card">
        <p className="text-[11px] leading-[1.6] text-ink-3">
          Connect any OpenAI-compatible (OpenRouter, Together, Groq, self-hosted) or Anthropic-compatible endpoint. They appear alongside CLI agents in the new-session picker.
        </p>
        {loading ? (
          <div className="mt-3">
            <Dots />
          </div>
        ) : error ? (
          <p className="mt-3 rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 text-[11.5px] text-red-400">{error}</p>
        ) : providers.length === 0 ? (
          <p className="mt-3 rounded-xl border border-white/5 bg-black/20 px-3 py-2.5 text-[11.5px] leading-[1.6] text-zinc-500">
            No custom API providers yet. Add one below — model discovery runs automatically and you can still type any model id.
          </p>
        ) : (
          <div className="mt-3 flex flex-col gap-2">
            {providers.map((p) => (
              <div key={p.id} className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2.5">
                <span className="flex size-7 items-center justify-center rounded-lg bg-white text-[10px] font-bold text-black">{p.name[0]?.toUpperCase()}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[12.5px] font-medium text-white">{p.name}</span>
                  <span className="block truncate font-mono text-[11px] text-zinc-500">
                    {p.id} · {p.transport === 'anthropic_compatible' ? 'Anthropic' : 'OpenAI'} · {p.api_url}
                    {p.has_key ? ' · key set' : ''}
                    {p.models.length ? ` · ${p.models.length} models` : ''}
                  </span>
                </span>
                <span className="flex shrink-0 gap-1.5">
                  <button
                    type="button"
                    onClick={() => handleEdit(p)}
                    className="rounded-full border border-white/15 bg-white/5 px-3 py-1 text-[11px] font-medium text-zinc-300 hover:bg-white/10 hover:text-white"
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    onClick={() => void handleDelete(p.id)}
                    className="rounded-full border border-white/10 px-2.5 py-1 text-[11px] text-zinc-400 hover:bg-white/10 hover:text-white"
                  >
                    Remove
                  </button>
                </span>
              </div>
            ))}
          </div>
        )}

        {!showForm ? (
          <Button variant="surface" onClick={() => { setFormError(undefined); setTestResult(undefined); setDiscovered(null); setSelected(new Set()); setQuery(''); setEditingId(null); setShowForm(true) }} className="mt-3 w-full">
            Add API provider
          </Button>
        ) : (
          <div className="mt-3 rounded-xl border border-white/10 bg-black/20 p-3">
            <form autoComplete="off" data-form-type="other" data-lpignore="true" data-1p-ignore="true" onSubmit={(e) => e.preventDefault()} className="grid gap-3">
              {editingId ? (
                <div className="flex items-center justify-between rounded-lg border border-white/10 bg-white/5 px-3 py-2">
                  <span className="font-mono text-[11px] text-zinc-300">Editing <span className="font-bold text-white">{editingId}</span></span>
                  <span className="font-mono text-[10px] text-zinc-500">ID cannot be changed</span>
                </div>
              ) : null}
              <div className="grid grid-cols-2 gap-3">
                <label className="space-y-1">
                  <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-zinc-400">ID</span>
                  <TextField value={form.id} onChange={(e) => setForm((f) => ({ ...f, id: e.target.value }))} placeholder="openrouter" disabled={!!editingId} className={editingId ? 'opacity-60' : undefined} autoComplete="off" data-form-type="other" data-lpignore="true" spellCheck={false} />
                </label>
                <label className="space-y-1">
                  <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-zinc-400">Name</span>
                  <TextField value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="OpenRouter" autoComplete="off" data-form-type="other" data-lpignore="true" />
                </label>
              </div>
              <label className="space-y-1">
                <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-zinc-400">API URL</span>
                <TextField value={form.api_url} onChange={(e) => setForm((f) => ({ ...f, api_url: e.target.value }))} placeholder="https://openrouter.ai/api/v1" autoComplete="off" data-form-type="other" data-lpignore="true" spellCheck={false} inputMode="url" />
              </label>
              <label className="space-y-1">
                <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-zinc-400">API key</span>
                <TextField value={form.api_key} onChange={(e) => setForm((f) => ({ ...f, api_key: e.target.value }))} placeholder="sk-..." type="password" autoComplete="new-password" data-form-type="other" data-lpignore="true" data-1p-ignore="true" spellCheck={false} />
                <span className="text-[10px] text-zinc-500">Stored in config.toml, never sent to the browser after save (shown as “key set”).</span>
              </label>
              <div className="flex items-center gap-2">
                <Button
                  variant="surface"
                  onClick={() => void handleTest()}
                  disabled={busy || !form.api_url.trim()}
                  className="flex-1"
                  title={!form.api_url.trim() ? 'Enter API URL first' : 'Fetch models from the endpoint using the URL + key above'}
                >
                  {busy ? 'Discovering…' : 'Auto-discover models'}
                </Button>
                <span className="font-mono text-[10px] text-zinc-500">Uses URL + key above to GET /models</span>
              </div>
              <label className="space-y-1">
                <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-zinc-400">Transport</span>
                <FancySelect
                  value={form.transport}
                  onChange={(v) => setForm((f) => ({ ...f, transport: v as never }))}
                  options={[
                    { value: 'openai_compatible', label: 'OpenAI-compatible (/v1/chat/completions)' },
                    { value: 'anthropic_compatible', label: 'Anthropic-compatible (/v1/messages)' },
                  ]}
                />
              </label>
              {discovered === null ? (
                <label className="space-y-1">
                  <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-zinc-400">Models (comma-separated, optional)</span>
                  <TextField value={form.models} onChange={(e) => setForm((f) => ({ ...f, models: e.target.value }))} placeholder="gpt-4o, gpt-4o-mini" autoComplete="off" data-form-type="other" data-lpignore="true" data-1p-ignore="true" spellCheck={false} />
                  <span className="text-[10px] text-zinc-500">Or click Auto-discover above to pick from what the endpoint reports.</span>
                </label>
              ) : (
                <div className="min-w-0 space-y-2 overflow-hidden rounded-xl border border-white/10 bg-white/[0.02] p-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-zinc-400">
                      Discovered — choose what to expose ({selected.size}/{discovered.length})
                    </span>
                    <span className="flex shrink-0 gap-1">
                      <button type="button" onClick={() => { const all = new Set(discovered); setSelected(all); setForm((f) => ({ ...f, models: [...all].join(', ') })) }} className="rounded-full border border-white/15 bg-white/5 px-2.5 py-1 text-[11px] font-medium text-zinc-300 hover:bg-white/10 hover:text-white">All</button>
                      <button type="button" onClick={() => { setSelected(new Set()); setForm((f) => ({ ...f, models: '' })) }} className="rounded-full border border-white/10 px-2.5 py-1 text-[11px] text-zinc-400 hover:bg-white/10">None</button>
                      <button type="button" onClick={() => { setDiscovered(null); setQuery('') }} className="rounded-full border border-white/10 px-2.5 py-1 text-[11px] text-zinc-400 hover:bg-white/10">Manual</button>
                    </span>
                  </div>
                  <TextField
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="Search models…"
                    leading={<Search size={14} />}
                    className="h-8 bg-black/30 text-[12px]"
                    autoComplete="off"
                    data-form-type="other"
                    data-lpignore="true"
                    data-1p-ignore="true"
                    spellCheck={false}
                  />
                  <div className="scroll-thin max-h-40 min-h-0 space-y-1 overflow-y-auto overscroll-contain rounded-lg border border-white/5 bg-black/20 p-1.5 pr-1.5">
                    {discovered.length === 0 ? (
                      <p className="px-2 py-3 text-center font-mono text-[11px] text-zinc-500">No models discovered — type them manually.</p>
                    ) : filtered!.length === 0 ? (
                      <p className="px-2 py-3 text-center font-mono text-[11px] text-zinc-500">No matches for “{query}”.</p>
                    ) : (
                      filtered!.map((m) => (
                        <label key={m} className="flex min-w-0 cursor-pointer items-center gap-3 rounded-lg border border-white/5 bg-black/30 px-2.5 py-2 hover:border-white/10 hover:bg-white/5 has-[input:checked]:border-white/20 has-[input:checked]:bg-white/[0.07]">
                          <input
                            type="checkbox"
                            checked={selected.has(m)}
                            onChange={() => toggleModel(m)}
                            className="h-[18px] w-[18px] shrink-0 cursor-pointer rounded-[4px] border-2 border-white/25 bg-white/5 accent-white checked:border-white checked:bg-white focus-visible:ring-1 focus-visible:ring-white/40"
                          />
                          <span className="min-w-0 flex-1 truncate font-mono text-[12px] leading-none text-zinc-200">{m}</span>
                          {form.default_model === m ? <span className="shrink-0 rounded-full bg-white px-2 py-0.5 font-mono text-[10px] font-bold text-black">default</span> : null}
                        </label>
                      ))
                    )}
                  </div>
                  <p className="font-mono text-[10px] leading-[1.4] text-zinc-500">
                    {query ? `Showing ${filtered!.length} of ${discovered.length} · ` : ''}Only checked models will be saved and shown in the picker. Default must be checked.
                  </p>
                </div>
              )}
              <label className="space-y-1">
                <span className="font-mono text-[11px] uppercase tracking-[0.08em] text-zinc-400">Default model {discovered !== null ? '(from selected)' : '(optional)'}</span>
                {discovered !== null && discovered.length > 0 ? (
                  <FancySelect
                    value={form.default_model}
                    onChange={(v) => setForm((f) => ({ ...f, default_model: v }))}
                    options={[{ value: '', label: '— none —' }, ...[...selected].map((m) => ({ value: m, label: m }))]}
                    placeholder="— none —"
                  />
                ) : (
                  <TextField value={form.default_model} onChange={(e) => setForm((f) => ({ ...f, default_model: e.target.value }))} placeholder="gpt-4o-mini" autoComplete="off" data-form-type="other" data-lpignore="true" data-1p-ignore="true" spellCheck={false} />
                )}
              </label>
              {formError ? <p className="rounded-lg border border-red-500/20 bg-red-500/5 px-3 py-2 text-[11.5px] text-red-400">{formError}</p> : null}
              {testResult ? <p className="rounded-lg border border-emerald-500/20 bg-emerald-500/5 px-3 py-2 text-[11.5px] text-emerald-300">{testResult}</p> : null}
              <div className="flex gap-2">
                <Button variant="primary" onClick={() => void handleCreate()} disabled={busy} className="flex-1">
                  {editingId ? 'Save changes' : 'Save'}
                </Button>
                <Button variant="ghost" onClick={() => { setShowForm(false); setDiscovered(null); setSelected(new Set()); setQuery(''); setEditingId(null) }} disabled={busy}>
                  Cancel
                </Button>
              </div>
            </form>
          </div>
        )}
      </section>
    </>
  )
}
