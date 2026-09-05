import { useEffect, useMemo, useState } from 'react'
import { Check, Clock3, Copy, MoreHorizontal, Play, Plus, Trash2, X, Zap } from 'lucide-react'
import { Button, Chip, IconButton, TextField } from '../ui'
import { cn } from '@/lib/format'
import { useStore } from '@/store'

type AutomationKind = 'scheduled' | 'idle'
type Automation = {
  id: string
  name: string
  prompt: string
  cadence: string
  kind: AutomationKind
  enabled: boolean
  lastRun?: string
}

const STORAGE_KEY = 'agentdeck-automations'
const KEEP_AWAKE_KEY = 'agentdeck-keep-awake'

const IDLE_TEMPLATES = [
  { name: 'Standup Git Summary', prompt: 'Summarize commits, module changes, and follow-ups from this week.', cadence: 'Soonest available', kind: 'idle' as const },
  { name: 'CI Failures & Flaky Test Report', prompt: 'Review recent CI failures, flaky tests, and likely causes.', cadence: 'Soonest available', kind: 'idle' as const },
  { name: 'Documentation sync check', prompt: 'Check whether README files, docs, configuration guidance, and usage examples match the current code.', cadence: 'Soonest available', kind: 'idle' as const },
]

const SCHEDULED_TEMPLATES = [
  { name: 'Morning dev brief', prompt: 'Summarize commits, module changes, and follow-ups since the previous workday.', cadence: 'Weekdays at 09:00', kind: 'scheduled' as const },
  { name: 'Risk scan', prompt: 'Inspect changes from the last 24 hours and report high-confidence risks with direct evidence.', cadence: 'Daily at 10:00', kind: 'scheduled' as const },
  { name: 'Release brief', prompt: "Turn this week's merged changes into team-facing and user-facing release notes.", cadence: 'Fridays at 16:00', kind: 'scheduled' as const },
  { name: 'Documentation sync check', prompt: 'Compare recent implementation changes and flag likely missing documentation updates.', cadence: 'Wednesdays at 15:00', kind: 'scheduled' as const },
]

function loadAutomations(): Automation[] {
  try { return JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]') as Automation[] } catch { return [] }
}

export function AutomationsSection() {
  const [automations, setAutomations] = useState<Automation[]>(loadAutomations)
  const [keepAwake, setKeepAwake] = useState(() => localStorage.getItem(KEEP_AWAKE_KEY) === '1')
  const [editor, setEditor] = useState<Automation | null>(null)
  const [showAll, setShowAll] = useState(false)
  const [notice, setNotice] = useState<string>()
  const createSession = useStore((s) => s.createSession)
  const providers = useStore((s) => s.providers)

  useEffect(() => { localStorage.setItem(STORAGE_KEY, JSON.stringify(automations)) }, [automations])
  useEffect(() => { localStorage.setItem(KEEP_AWAKE_KEY, keepAwake ? '1' : '0') }, [keepAwake])

  const scheduled = useMemo(() => automations.filter((automation) => automation.kind === 'scheduled'), [automations])
  const idle = useMemo(() => automations.filter((automation) => automation.kind === 'idle'), [automations])

  function openNew(kind: AutomationKind, template?: Partial<Automation>) {
    setEditor({ id: `automation-${Date.now()}`, name: template?.name ?? '', prompt: template?.prompt ?? '', cadence: template?.cadence ?? (kind === 'idle' ? 'Soonest available' : 'Weekdays at 09:00'), kind, enabled: true })
  }

  function saveAutomation(value: Automation) {
    setAutomations((current) => [...current.filter((automation) => automation.id !== value.id), value])
    setEditor(null)
    setNotice(`${value.name || 'Automation'} saved`)
    window.setTimeout(() => setNotice(undefined), 2200)
  }

  function toggle(id: string) { setAutomations((current) => current.map((automation) => automation.id === id ? { ...automation, enabled: !automation.enabled } : automation)) }
  /** Real run: spawns a live agent session with this automation's prompt. */
  async function runNow(id: string) {
    const automation = automations.find((a) => a.id === id)
    if (!automation) return
    const ready = providers.find((p) => p.state === 'ready' && p.id !== 'cmd')
    if (!ready) {
      setNotice('No agent CLI is ready — install or authenticate one in Settings')
      window.setTimeout(() => setNotice(undefined), 3200)
      return
    }
    setNotice(`Starting ${ready.name}…`)
    try {
      await createSession({ agent: ready.id, prompt: automation.prompt, name: automation.name || 'Automation run' })
      setAutomations((current) => current.map((a) => a.id === id ? { ...a, enabled: true, lastRun: new Date().toISOString() } : a))
      setNotice(`${ready.name} is running “${automation.name || 'automation'}” — see it on Home`)
      window.setTimeout(() => setNotice(undefined), 3200)
    } catch (cause) {
      setNotice(cause instanceof Error ? cause.message : String(cause))
      window.setTimeout(() => setNotice(undefined), 4200)
    }
  }
  function remove(id: string) { setAutomations((current) => current.filter((automation) => automation.id !== id)) }

  return (
    <div className="flex flex-col gap-4">
      {notice ? <div role="status" className="flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/[0.07] px-3 py-2 text-[11px] text-emerald-300"><Check size={13} /> {notice}</div> : null}

      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-mono text-[10px] text-zinc-600">{scheduled.length} scheduled · {idle.length} idle-time</p>
        <div className="flex items-center gap-2">
          <Button onClick={() => openNew('scheduled')} className="bg-white text-black hover:bg-zinc-200"><Plus size={13} /> Create scheduled task</Button>
          <IconButton label="More automation actions" onClick={() => setShowAll((value) => !value)} className="size-9"><MoreHorizontal size={16} /></IconButton>
        </div>
      </div>

      <section className="rounded-2xl border border-white/[0.1] bg-white/[0.018]">
        {automations.length === 0 ? <div className="flex min-h-[190px] flex-col items-center justify-center p-6 text-center"><Clock3 size={21} className="mb-3 text-zinc-600" /><p className="text-[13px] font-medium text-zinc-300">No scheduled tasks yet.</p><p className="mt-1 text-[11px] text-zinc-600">Create one now or start from a template below.</p><div className="mt-4 flex flex-wrap justify-center gap-2"><Button onClick={() => openNew('scheduled')} className="bg-white text-black hover:bg-zinc-200">Create scheduled task <span className="ml-1 text-zinc-500">⌄</span></Button><Button onClick={() => openNew('idle')} variant="ghost" disabled={false}>Create idle-time task</Button></div></div> : <div className="divide-y divide-white/[0.08]">{(showAll ? automations : automations.slice(0, 4)).map((automation) => <AutomationRow key={automation.id} automation={automation} onToggle={() => toggle(automation.id)} onRun={() => runNow(automation.id)} onEdit={() => setEditor(automation)} onDelete={() => remove(automation.id)} />)}{automations.length > 4 ? <button type="button" onClick={() => setShowAll((value) => !value)} className="w-full py-2 text-[11px] text-zinc-500 hover:text-zinc-200">{showAll ? 'Show less' : `Show all ${automations.length} automations`}</button> : null}</div>}
      </section>

      <button type="button" onClick={() => setKeepAwake((value) => !value)} className="flex w-full items-center gap-3 rounded-xl border border-white/[0.06] bg-white/[0.035] px-3.5 py-3 text-left transition hover:bg-white/[0.05]"><span className="flex size-7 items-center justify-center rounded-lg bg-white/[0.06] text-zinc-500"><Zap size={14} /></span><span className="flex-1"><span className="block text-[12px] text-zinc-300">Keep your computer awake while Plumb is running a task.</span><span className="mt-0.5 block font-mono text-[10px] text-zinc-600">Browser setting · applies to this device</span></span><span className={cn('flex h-5 w-9 items-center rounded-full p-0.5 transition', keepAwake ? 'bg-white justify-end' : 'bg-zinc-800 justify-start')}><span className={cn('size-4 rounded-full transition', keepAwake ? 'bg-black' : 'bg-zinc-400')} /></span></button>

      <TemplateSection title="Idle-time task templates" templates={IDLE_TEMPLATES} onCreate={(template) => openNew('idle', template)} />
      <TemplateSection title="Scheduled task templates" templates={SCHEDULED_TEMPLATES} onCreate={(template) => openNew('scheduled', template)} />
      {editor ? <AutomationEditor value={editor} onClose={() => setEditor(null)} onSave={saveAutomation} /> : null}
    </div>
  )
}

function AutomationRow({ automation, onToggle, onRun, onEdit, onDelete }: { automation: Automation; onToggle: () => void; onRun: () => void; onEdit: () => void; onDelete: () => void }) {
  return <div className="flex flex-col gap-3 px-4 py-3.5 sm:flex-row sm:items-center"><span className={cn('flex size-8 shrink-0 items-center justify-center rounded-lg', automation.kind === 'scheduled' ? 'bg-sky-500/10 text-sky-300' : 'bg-accent/10 text-accent')}>{automation.kind === 'scheduled' ? <Clock3 size={15} /> : <Zap size={15} />}</span><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><p className="truncate text-[13px] font-medium text-zinc-200">{automation.name || 'Untitled automation'}</p><Chip tone={automation.enabled ? 'green' : 'default'}>{automation.enabled ? 'Enabled' : 'Paused'}</Chip></div><p className="mt-1 line-clamp-1 text-[11px] text-zinc-500">{automation.prompt}</p><p className="mt-1 font-mono text-[10px] text-zinc-600">{automation.cadence}{automation.lastRun ? ` · last run ${new Date(automation.lastRun).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : ''}</p></div><div className="flex items-center gap-1.5"><button type="button" onClick={onRun} className="inline-flex h-8 items-center gap-1.5 rounded-lg bg-white/[0.06] px-2.5 text-[10px] text-zinc-300 hover:bg-white/10 hover:text-white"><Play size={11} /> Run</button><button type="button" onClick={onToggle} className={cn('flex h-8 w-12 items-center rounded-full p-1 transition', automation.enabled ? 'justify-end bg-white' : 'justify-start bg-zinc-800')} aria-label={automation.enabled ? 'Pause automation' : 'Enable automation'}><span className={cn('size-6 rounded-full', automation.enabled ? 'bg-black' : 'bg-zinc-500')} /></button><IconButton label="Edit automation" onClick={onEdit} className="size-8"><Copy size={13} /></IconButton><IconButton label="Delete automation" onClick={onDelete} className="size-8 hover:text-red-400"><Trash2 size={13} /></IconButton></div></div>
}

function TemplateSection({ title, templates, onCreate }: { title: string; templates: Array<{ name: string; prompt: string; cadence: string; kind: AutomationKind }>; onCreate: (template: typeof templates[number]) => void }) {
  return <section className="mt-8"><div className="mb-3 flex items-center gap-2"><h2 className="font-mono text-[11px] uppercase tracking-[0.14em] text-zinc-500">{title}</h2><span className="h-px flex-1 bg-white/[0.07]" /></div><div className="grid gap-2 md:grid-cols-2">{templates.map((template) => <button key={`${template.kind}-${template.name}`} type="button" onClick={() => onCreate(template)} className="group rounded-xl border border-white/[0.09] bg-white/[0.018] p-3.5 text-left transition hover:border-white/20 hover:bg-white/[0.04]"><div className="flex items-center gap-2"><span className="text-zinc-500">{template.kind === 'scheduled' ? <Clock3 size={14} /> : <Zap size={14} />}</span><span className="text-[12px] font-medium text-zinc-300 group-hover:text-white">{template.name}</span></div><p className="mt-2 line-clamp-2 text-[11px] leading-[1.5] text-zinc-500">{template.prompt}</p><p className="mt-3 font-mono text-[10px] text-zinc-600">{template.cadence}</p></button>)}</div></section>
}

function AutomationEditor({ value, onClose, onSave }: { value: Automation; onClose: () => void; onSave: (automation: Automation) => void }) {
  const [draft, setDraft] = useState(value)
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"><div className="w-full max-w-lg rounded-2xl border border-white/10 bg-[#241f1a] shadow-2xl"><div className="flex items-center gap-2 border-b border-white/10 px-5 py-4"><div className="flex-1"><p className="font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-600">New automation</p><h2 className="mt-1 text-[15px] font-semibold text-zinc-100">{draft.kind === 'scheduled' ? 'Create scheduled task' : 'Create idle-time task'}</h2></div><IconButton label="Close" onClick={onClose} className="size-8"><X size={15} /></IconButton></div><div className="space-y-4 p-5"><label className="block"><span className="mb-1.5 block text-[11px] text-zinc-400">Task name</span><TextField value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="e.g. Morning dev brief" /></label><label className="block"><span className="mb-1.5 block text-[11px] text-zinc-400">Instruction</span><textarea autoFocus rows={4} value={draft.prompt} onChange={(event) => setDraft({ ...draft, prompt: event.target.value })} placeholder="What should the agent do?" className="w-full resize-none rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-[12px] leading-[1.55] text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-white/25" /></label><label className="block"><span className="mb-1.5 block text-[11px] text-zinc-400">{draft.kind === 'scheduled' ? 'Schedule' : 'Availability'}</span>{draft.kind === 'scheduled' ? <select value={draft.cadence} onChange={(event) => setDraft({ ...draft, cadence: event.target.value })} className="h-9 w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 text-[12px] text-zinc-200 outline-none"><option className="bg-zinc-900">Weekdays at 09:00</option><option className="bg-zinc-900">Daily at 10:00</option><option className="bg-zinc-900">Fridays at 16:00</option><option className="bg-zinc-900">Custom schedule</option></select> : <div className="rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2 text-[11px] text-zinc-400">Run as soon as the machine is idle.</div>}</label><div className="flex justify-end gap-2 border-t border-white/[0.08] pt-4"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={() => onSave({ ...draft, name: draft.name.trim() || 'Untitled automation', prompt: draft.prompt.trim() || 'Review the current workspace and report useful next actions.' })} className="bg-white text-black hover:bg-zinc-200"><Check size={13} /> Save automation</Button></div></div></div></div>
}
