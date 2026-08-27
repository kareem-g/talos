import { useEffect, useMemo, useState } from 'react'
import { Box, Check, Download, Plus, RefreshCw, Search, Trash2, X } from 'lucide-react'
import { Button, IconButton, TextField } from '../ui'
import { cn } from '@/lib/format'
import { skillsApi } from '@/lib/api'

type SkillScope = 'workspace' | 'personal'
type Skill = { id: string; name: string; description: string; scope: SkillScope; enabled: boolean }

const STORAGE_KEY = 'agentdeck-skills'
/** Local overlays on top of the on-disk catalog (~/.hermes/skills). */
const ENABLED_KEY = 'agentdeck-skills-enabled'
const HIDDEN_KEY = 'agentdeck-skills-hidden'
const CUSTOM_KEY = 'agentdeck-skills-custom'
const SEED_SKILLS: Skill[] = [
  ['ask-matt', 'Ask which skill or flow fits your situation. A router over the skills in this repo.', 'workspace'],
  ['claude-handoff', 'Hand the current conversation off to a fresh background agent that picks up the work.', 'workspace'],
  ['code-review', 'Review the changes since a fixed point and report issues with direct evidence.', 'workspace'],
  ['codebase-design', 'Shared vocabulary for designing deep modules and maintainable boundaries.', 'workspace'],
  ['domain-modeling', 'Model the problem domain before implementation and make invariants explicit.', 'workspace'],
  ['diagnosing-bugs', 'Investigate symptoms, reproduce the issue, and isolate the first broken layer.', 'workspace'],
  ['git-guardrails-claude-code', 'Safe Git workflows for agents: inspect state, preserve work, and verify writes.', 'workspace'],
  ['grill-me', 'Challenge assumptions with focused questions before committing to a solution.', 'workspace'],
  ['grill-with-docs', 'Pressure-test a design against repository documentation and acceptance criteria.', 'workspace'],
  ['implement', 'Carry a scoped change through implementation, tests, and a verified handoff.', 'workspace'],
  ['implement-spec', 'Turn a specification into a concrete, testable implementation plan.', 'workspace'],
  ['improve-codebase-architecture', 'Refactor toward clearer modules without breaking existing behavior.', 'workspace'],
  ['loop-me', 'Repeat a check-and-fix loop until the acceptance criteria are verified.', 'workspace'],
  ['migrate-to-shoehorn', 'Move a workflow incrementally while keeping compatibility at each step.', 'workspace'],
  ['prototype', 'Build a small throwaway experiment to validate uncertain behavior quickly.', 'workspace'],
  ['research', 'Gather evidence from primary sources and return a grounded, cited summary.', 'personal'],
  ['tdd', 'Write the failing test first, implement the smallest fix, then refactor.', 'workspace'],
  ['teach', 'Explain the concept progressively with examples tied to the current codebase.', 'personal'],
  ['to-spec', 'Convert a rough request into precise acceptance criteria and constraints.', 'workspace'],
  ['writing-for-agents', 'Author durable instructions that are explicit, scoped, and easy to execute.', 'personal'],
  ['frontend-design', 'Create considered interfaces from source context instead of generic templates.', 'workspace'],
].map(([name, description, scope]) => ({ id: name, name, description, scope: scope as SkillScope, enabled: true }))

/** Local overlay helpers: enabled-set, hidden-set, user-added skills. */
function readSet(key: string): Set<string> {
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? '[]') as string[]
    return new Set(Array.isArray(value) ? value : [])
  } catch { return new Set() }
}
function writeSet(key: string, set: Set<string>) {
  localStorage.setItem(key, JSON.stringify([...set]))
}
function readCustom(): Skill[] {
  try { return JSON.parse(localStorage.getItem(CUSTOM_KEY) ?? '[]') as Skill[] } catch { return [] }
}

/**
 * Merge the daemon's on-disk catalog (~/.hermes/skills, ~/.claude/skills) with
 * local overlays. Falls back to the seed catalog when the daemon is unreachable.
 */
async function loadSkills(): Promise<{ skills: Skill[]; source: 'daemon' | 'local' }> {
  const enabled = readSet(ENABLED_KEY)
  const hidden = readSet(HIDDEN_KEY)
  const custom = readCustom()
  let base: Skill[]
  try {
    const { skills } = await skillsApi.list()
    if (skills.length === 0 && custom.length === 0) throw new Error('no skills on disk')
    // hermes → personal scope, claude → workspace scope (mirrors the two CLIs).
    base = skills.map((entry) => ({
      id: entry.name,
      name: entry.name,
      description: entry.description || `${entry.source} skill`,
      scope: (entry.source === 'hermes' ? 'personal' : 'workspace') as SkillScope,
      enabled: !hidden.has(entry.name),
    }))
  } catch {
    base = loadSeedSkills().map((skill) => ({ ...skill, enabled: enabled.size > 0 ? enabled.has(skill.id) : true }))
  }
  return { skills: [...base, ...custom.map((skill) => ({ ...skill, enabled: !hidden.has(skill.id) }))], source: base.length > 0 && !localStorage.getItem(STORAGE_KEY + '-offline') ? 'daemon' : 'local' }
}

function loadSeedSkills(): Skill[] {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? 'null') as Skill[] | null
    return value?.length ? value : SEED_SKILLS
  } catch { return SEED_SKILLS }
}

export function SkillsScreen() {
  const [skills, setSkills] = useState<Skill[]>(loadSeedSkills)
  const [source, setSource] = useState<'daemon' | 'local' | null>(null)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<'all' | 'enabled' | SkillScope>('all')
  const [editorOpen, setEditorOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [notice, setNotice] = useState<string>()

  useEffect(() => {
    let cancelled = false
    void loadSkills().then(({ skills: loaded, source: loadedSource }) => {
      if (!cancelled) {
        setSkills(loaded)
        setSource(loadedSource)
        localStorage.setItem(STORAGE_KEY, JSON.stringify(loaded))
      }
    })
    return () => { cancelled = true }
  }, [])

  /** Toggle = local hide/show overlay on the real catalog entry. */
  function toggle(id: string) {
    const hidden = readSet(HIDDEN_KEY)
    if (hidden.has(id)) hidden.delete(id)
    else hidden.add(id)
    writeSet(HIDDEN_KEY, hidden)
    setSkills((current) => current.map((skill) => skill.id === id ? { ...skill, enabled: hidden.has(id) === false } : skill))
  }
  /** Remove = hide a catalog skill on disk, or drop a custom one entirely. */
  function remove(id: string) {
    const hidden = readSet(HIDDEN_KEY)
    hidden.add(id)
    writeSet(HIDDEN_KEY, hidden)
    if (readCustom().some((skill) => skill.id === id)) {
      localStorage.setItem(CUSTOM_KEY, JSON.stringify(readCustom().filter((skill) => skill.id !== id)))
    }
    setSkills((current) => current.filter((skill) => skill.id !== id))
    setNotice('Skill removed')
    window.setTimeout(() => setNotice(undefined), 1800)
  }
  function reload() {
    void loadSkills().then(({ skills: loaded }) => {
      setSkills(loaded)
      localStorage.setItem(STORAGE_KEY, JSON.stringify(loaded))
      setNotice('Skill catalog refreshed from ~/.hermes/skills')
      window.setTimeout(() => setNotice(undefined), 2200)
    })
  }
  function download() { const blob = new Blob([JSON.stringify(skills, null, 2)], { type: 'application/json' }); const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = 'agentdeck-skills.json'; link.click(); URL.revokeObjectURL(url) }

  const visible = useMemo(() => skills.filter((skill) => {
    const matchesQuery = !query.trim() || `${skill.name} ${skill.description}`.toLowerCase().includes(query.trim().toLowerCase())
    const matchesFilter = filter === 'all' || filter === 'enabled' && skill.enabled || filter === skill.scope
    return matchesQuery && matchesFilter
  }), [skills, query, filter])

  return <div className="scroll-thin min-h-0 flex-1 overflow-y-auto bg-[#0f0f10]"><div className="mx-auto w-full max-w-5xl px-5 pb-16 pt-7 sm:px-8 lg:px-10">
    <header className="flex flex-col gap-4 border-b border-white/[0.08] pb-6 sm:flex-row sm:items-end sm:justify-between"><div><div className="mb-2 flex items-center gap-2 text-zinc-500"><Box size={17} /><span className="font-mono text-[10px] uppercase tracking-[0.16em]">Prompt library</span>{source === 'daemon' ? <span className="rounded-full border border-emerald-500/25 bg-emerald-500/[0.08] px-2 py-0.5 font-mono text-[9.5px] normal-case tracking-normal text-emerald-300">live · ~/.hermes/skills</span> : source === 'local' ? <span className="rounded-full border border-white/10 bg-white/[0.05] px-2 py-0.5 font-mono text-[9.5px] normal-case tracking-normal text-zinc-400">offline catalog</span> : null}</div><h1 className="text-[26px] font-semibold tracking-[-0.04em] text-zinc-100">Skills</h1><p className="mt-1 max-w-xl text-[12px] leading-[1.6] text-zinc-500">Manage workspace and personal skills. Enabled skills can be referenced in chat with <code className="rounded bg-white/[0.06] px-1 py-0.5 font-mono text-[11px] text-zinc-300">$skill-name</code>.</p></div><div className="flex items-center gap-1"><Button onClick={() => setEditorOpen(true)} className="bg-white text-black hover:bg-zinc-200"><Plus size={13} /> Add skill</Button><IconButton label="Export skills" onClick={download} className="size-9"><Download size={15} /></IconButton><IconButton label="Import skills" onClick={() => setImportOpen(true)} className="size-9"><Download size={15} /></IconButton><IconButton label="Refresh skills" onClick={reload} className="size-9"><RefreshCw size={15} /></IconButton></div></header>
    {notice ? <div role="status" className="mt-4 flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/[0.07] px-3 py-2 text-[11px] text-emerald-300"><Check size={13} /> {notice}</div> : null}
    <div className="mt-6 flex flex-col gap-2 sm:flex-row"><TextField value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search skills…" aria-label="Search skills" leading={<Search size={14} />} className="flex-1" /><div className="flex items-center gap-1 rounded-xl border border-white/10 bg-white/[0.035] p-1">{(['all', 'enabled', 'workspace', 'personal'] as const).map((value) => <button key={value} type="button" onClick={() => setFilter(value)} className={cn('rounded-lg px-2.5 py-1.5 text-[10px] capitalize transition', filter === value ? 'bg-white text-black' : 'text-zinc-500 hover:text-zinc-200')}>{value}</button>)}</div></div>
    <div className="mb-2 mt-5 flex items-center gap-2"><h2 className="text-[13px] font-medium text-zinc-300">Workspace and personal skills</h2><span className="font-mono text-[10px] text-zinc-600">{visible.length} of {skills.length}</span></div>
    <section className="overflow-hidden rounded-2xl border border-white/[0.1] bg-white/[0.018]">{visible.length === 0 ? <div className="p-10 text-center text-[12px] text-zinc-500">No skills match this search.</div> : visible.map((skill) => <SkillRow key={skill.id} skill={skill} onToggle={() => toggle(skill.id)} onDelete={() => remove(skill.id)} />)}</section>
    <p className="mt-3 font-mono text-[10px] text-zinc-600">Skills are saved locally for this dashboard. {skills.filter((skill) => skill.enabled).length} enabled.</p>
    {editorOpen ? <SkillEditor onClose={() => setEditorOpen(false)} onSave={(skill) => { const custom = readCustom(); custom.push(skill); localStorage.setItem(CUSTOM_KEY, JSON.stringify(custom)); setSkills((current) => [...current, skill]); setEditorOpen(false); setNotice('Skill added'); window.setTimeout(() => setNotice(undefined), 1800) }} /> : null}
    {importOpen ? <ImportLayer onClose={() => setImportOpen(false)} onImport={(items) => { setSkills((current) => [...current, ...items.filter((item) => !current.some((skill) => skill.id === item.id))]); setImportOpen(false); setNotice(`${items.length} skill${items.length === 1 ? '' : 's'} imported`); window.setTimeout(() => setNotice(undefined), 2000) }} /> : null}
  </div></div>
}

function SkillRow({ skill, onToggle, onDelete }: { skill: Skill; onToggle: () => void; onDelete: () => void }) {
  return <div className="group flex items-center gap-3 border-b border-white/[0.08] px-4 py-3 last:border-b-0 sm:px-5"><span className="flex size-8 shrink-0 items-center justify-center rounded-full border border-white/[0.1] text-zinc-500"><Box size={14} /></span><div className="min-w-0 flex-1"><p className="truncate text-[12.5px] font-medium text-zinc-200">{skill.name}</p><p className="mt-0.5 line-clamp-1 text-[11px] text-zinc-500">{skill.description}</p></div><span className="hidden font-mono text-[10px] text-zinc-500 sm:block">{skill.scope}</span><button type="button" onClick={onToggle} aria-label={skill.enabled ? `Disable ${skill.name}` : `Enable ${skill.name}`} className={cn('flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition', skill.enabled ? 'justify-end bg-white' : 'justify-start bg-zinc-800')}><span className={cn('size-4 rounded-full transition', skill.enabled ? 'bg-black' : 'bg-zinc-500')} /></button><button type="button" onClick={onDelete} aria-label={`Delete ${skill.name}`} className="rounded-md p-1.5 text-zinc-600 opacity-60 transition hover:bg-red-500/10 hover:text-red-400 sm:opacity-0 sm:group-hover:opacity-100"><Trash2 size={13} /></button></div>
}

function SkillEditor({ onClose, onSave }: { onClose: () => void; onSave: (skill: Skill) => void }) {
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [scope, setScope] = useState<SkillScope>('personal')
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"><div className="w-full max-w-lg rounded-2xl border border-white/10 bg-[#1b1b1d] shadow-2xl"><div className="flex items-center gap-2 border-b border-white/10 px-5 py-4"><div className="flex-1"><p className="font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-600">Skill library</p><h2 className="mt-1 text-[15px] font-semibold text-zinc-100">Add a skill</h2></div><IconButton label="Close" onClick={onClose} className="size-8"><X size={15} /></IconButton></div><div className="space-y-4 p-5"><label className="block"><span className="mb-1.5 block text-[11px] text-zinc-400">Skill name</span><TextField autoFocus value={name} onChange={(event) => setName(event.target.value.replace(/\s+/g, '-').toLowerCase())} placeholder="e.g. release-checklist" /></label><label className="block"><span className="mb-1.5 block text-[11px] text-zinc-400">Description</span><textarea rows={3} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="What does this skill help an agent do?" className="w-full resize-none rounded-xl border border-white/10 bg-white/[0.04] px-3 py-2.5 text-[12px] leading-[1.55] text-zinc-200 outline-none placeholder:text-zinc-600 focus:border-white/25" /></label><label className="block"><span className="mb-1.5 block text-[11px] text-zinc-400">Scope</span><select value={scope} onChange={(event) => setScope(event.target.value as SkillScope)} className="h-9 w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 text-[12px] text-zinc-200 outline-none"><option value="personal" className="bg-zinc-900">Personal</option><option value="workspace" className="bg-zinc-900">Workspace</option></select></label><div className="flex justify-end gap-2 border-t border-white/[0.08] pt-4"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={() => onSave({ id: name || `skill-${Date.now()}`, name: name || 'new-skill', description: description || 'Custom AgentDeck skill.', scope, enabled: true })} className="bg-white text-black hover:bg-zinc-200"><Check size={13} /> Add skill</Button></div></div></div></div>
}

function ImportLayer({ onClose, onImport }: { onClose: () => void; onImport: (skills: Skill[]) => void }) {
  const [text, setText] = useState('')
  function importSkills() {
    try {
      const parsed = JSON.parse(text) as Array<Partial<Skill>>
      const valid = parsed.filter((item) => typeof item.name === 'string').map((item) => ({ id: item.id ?? item.name!, name: item.name!, description: item.description ?? 'Imported skill.', scope: item.scope === 'workspace' ? 'workspace' as const : 'personal' as const, enabled: item.enabled !== false }))
      if (valid.length) onImport(valid)
    } catch { /* keep the dialog open and let the user correct malformed JSON */ }
  }
  return <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"><div className="w-full max-w-lg rounded-2xl border border-white/10 bg-[#1b1b1d] shadow-2xl"><div className="flex items-center gap-2 border-b border-white/10 px-5 py-4"><div className="flex-1"><p className="font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-600">Import</p><h2 className="mt-1 text-[15px] font-semibold text-zinc-100">Import skill JSON</h2></div><IconButton label="Close" onClick={onClose} className="size-8"><X size={15} /></IconButton></div><div className="space-y-3 p-5"><p className="text-[11px] leading-[1.5] text-zinc-500">Paste an array of skill objects exported from another dashboard.</p><textarea autoFocus rows={8} value={text} onChange={(event) => setText(event.target.value)} placeholder='[{"name":"my-skill","description":"…"}]' className="w-full resize-none rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 font-mono text-[11px] leading-[1.55] text-zinc-200 outline-none placeholder:text-zinc-700 focus:border-white/25" /><div className="flex justify-end gap-2 border-t border-white/[0.08] pt-4"><Button variant="ghost" onClick={onClose}>Cancel</Button><Button onClick={importSkills} className="bg-white text-black hover:bg-zinc-200"><Download size={13} /> Import</Button></div></div></div></div>
}
