import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  Box,
  Check,
  Download,
  FolderOpen,
  Globe,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  X,
} from 'lucide-react'
import { Button, IconButton, Segmented, TextField } from '../ui'
import { cn } from '@/lib/format'
import { skillsApi, type InstalledSkill, type RegistrySkill } from '@/lib/api'
import { useStore } from '@/store'

/**
 * Skills management — backed by the daemon's per-project `.agentdeck/skills/`
 * directory (the same one the context assembler reads). Installed skills can
 * be toggled (a `.disabled` marker), edited, or removed; new skills come from
 * the built-in registry, a URL, pasted markdown, or a local file.
 */

type View = 'installed' | 'available'

/** Most recent session's project is the sensible default target. */
function defaultProject(): string {
  const sessions = useStore.getState().sessions
  const latest = [...sessions]
    .sort((a, b) => (a.updated_at < b.updated_at ? 1 : -1))
    .find((session) => session.project)
  return latest?.project ?? '.'
}

const PROJECT_KEY = 'agentdeck-skills-project'

function readProject(): string {
  try {
    return localStorage.getItem(PROJECT_KEY) ?? defaultProject()
  } catch {
    return defaultProject()
  }
}

type InstallTab = 'registry' | 'skillssh' | 'url' | 'paste' | 'file'

export function SkillsScreen() {
  const [project, setProject] = useState<string>(readProject)
  const [view, setView] = useState<View>('installed')
  const [query, setQuery] = useState('')
  const [installed, setInstalled] = useState<InstalledSkill[]>([])
  const [available, setAvailable] = useState<RegistrySkill[]>([])
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [notice, setNotice] = useState<string>()
  const [installOpen, setInstallOpen] = useState(false)
  const [editing, setEditing] = useState<InstalledSkill | null>(null)

  const refresh = useCallback(async () => {
    setLoading(true)
    try {
      const [installedRes, availableRes] = await Promise.all([
        skillsApi.installed(project),
        skillsApi.available(),
      ])
      setInstalled(installedRes.skills)
      setAvailable(availableRes.skills)
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'Failed to load skills')
    } finally {
      setLoading(false)
    }
  }, [project])

  useEffect(() => {
    void refresh()
  }, [refresh])

  function flash(message: string) {
    setNotice(message)
    window.setTimeout(() => setNotice(undefined), 2200)
  }

  function onProjectChange(next: string) {
    setProject(next)
    try {
      localStorage.setItem(PROJECT_KEY, next)
    } catch {
      /* non-fatal */
    }
  }

  async function toggle(skill: InstalledSkill) {
    const next = !skill.enabled
    setBusy(true)
    try {
      await skillsApi.toggle(skill.id, next, project)
      setInstalled((current) =>
        current.map((entry) => (entry.id === skill.id ? { ...entry, enabled: next } : entry)),
      )
    } catch (error) {
      flash(error instanceof Error ? error.message : 'Toggle failed')
    } finally {
      setBusy(false)
    }
  }

  async function remove(skill: InstalledSkill) {
    setBusy(true)
    try {
      await skillsApi.uninstall(skill.id, project)
      setInstalled((current) => current.filter((entry) => entry.id !== skill.id))
      flash(`Removed ${skill.id}`)
    } catch (error) {
      flash(error instanceof Error ? error.message : 'Remove failed')
    } finally {
      setBusy(false)
    }
  }

  /** Install from any source, then refresh the installed list. */
  async function install(source: Parameters<typeof skillsApi.install>[0], name?: string) {
    setBusy(true)
    try {
      await skillsApi.install(source, project)
      flash(`Installed ${name ?? source.kind}`)
      await refresh()
    } catch (error) {
      flash(error instanceof Error ? error.message : 'Install failed')
    } finally {
      setBusy(false)
    }
  }

  const installedById = useMemo(
    () => new Map(installed.map((skill) => [skill.id, skill])),
    [installed],
  )

  const visibleInstalled = useMemo(
    () =>
      installed.filter(
        (skill) =>
          !query.trim() || `${skill.id} ${skill.path}`.toLowerCase().includes(query.trim().toLowerCase()),
      ),
    [installed, query],
  )

  const visibleAvailable = useMemo(
    () =>
      available.filter((skill) => {
        const matchesQuery =
          !query.trim() || `${skill.name} ${skill.description}`.toLowerCase().includes(query.trim().toLowerCase())
        const already = installedById.has(skill.id)
        return matchesQuery && !already
      }),
    [available, installedById, query],
  )

  return (
    <div className="scroll-thin min-h-0 flex-1 overflow-y-auto bg-[#141210]">
      <div className="mx-auto w-full max-w-5xl px-5 pb-16 pt-7 sm:px-8 lg:px-10">
        <header className="flex flex-col gap-4 border-b border-white/[0.08] pb-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <div className="mb-2 flex items-center gap-2 text-zinc-500">
              <Box size={17} />
              <span className="font-mono text-[10px] uppercase tracking-[0.16em]">Prompt library</span>
              <span className="rounded-full border border-emerald-500/25 bg-emerald-500/[0.08] px-2 py-0.5 font-mono text-[9.5px] normal-case tracking-normal text-emerald-300">
                live · project skills
              </span>
            </div>
            <h1 className="text-[26px] font-semibold tracking-[-0.04em] text-zinc-100">Skills</h1>
            <p className="mt-1 max-w-xl text-[12px] leading-[1.6] text-zinc-500">
              Skills install to <code className="rounded bg-white/[0.06] px-1 py-0.5 font-mono text-[11px] text-zinc-300">.agentdeck/skills/</code> in the
              project — the same files the context assembler injects into every turn.
            </p>
          </div>
          <div className="flex items-center gap-1">
            <Button onClick={() => setInstallOpen(true)} className="bg-white text-black hover:bg-zinc-200">
              <Plus size={13} /> Install
            </Button>
            <IconButton label="Refresh skills" onClick={() => void refresh()} className="size-9">
              <RefreshCw size={15} />
            </IconButton>
          </div>
        </header>

        {notice ? (
          <div role="status" className="mt-4 flex items-center gap-2 rounded-lg border border-emerald-500/20 bg-emerald-500/[0.07] px-3 py-2 text-[11px] text-emerald-300">
            <Check size={13} /> {notice}
          </div>
        ) : null}

        {/* Project target */}
        <div className="mt-5">
          <label className="mb-1.5 flex items-center gap-1.5 text-[11px] text-zinc-400">
            <FolderOpen size={12} /> Project
          </label>
          <TextField
            value={project}
            onChange={(event) => onProjectChange(event.target.value)}
            placeholder="/path/to/project"
            aria-label="Project directory"
            className="max-w-xl"
          />
        </div>

        {/* Toolbar */}
        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <Segmented<View>
            value={view}
            onChange={setView}
            options={[
              { value: 'installed', label: `Installed (${installed.length})` },
              { value: 'available', label: `Registry (${visibleAvailable.length})` },
            ]}
          />
          <TextField
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search skills…"
            aria-label="Search skills"
            leading={<Search size={14} />}
            className="sm:w-64"
          />
        </div>

        <div className="mb-2 mt-5 flex items-center gap-2">
          <h2 className="text-[13px] font-medium text-zinc-300">
            {view === 'installed' ? 'Installed skills' : 'Available from registry'}
          </h2>
          {loading ? (
            <span className="font-mono text-[10px] text-zinc-600">loading…</span>
          ) : (
            <span className="font-mono text-[10px] text-zinc-600">
              {view === 'installed' ? visibleInstalled.length : visibleAvailable.length}
            </span>
          )}
        </div>

        <section className="overflow-hidden rounded-2xl border border-white/[0.1] bg-white/[0.018]">
          {loading ? (
            <div className="p-10 text-center text-[12px] text-zinc-500">Loading skills…</div>
          ) : view === 'installed' ? (
            visibleInstalled.length === 0 ? (
              <div className="p-10 text-center text-[12px] text-zinc-500">
                No skills installed in this project. Install one from the registry or another source.
              </div>
            ) : (
              visibleInstalled.map((skill) => (
                <InstalledRow
                  key={skill.id}
                  skill={skill}
                  busy={busy}
                  onToggle={() => toggle(skill)}
                  onEdit={() => setEditing(skill)}
                  onDelete={() => remove(skill)}
                />
              ))
            )
          ) : visibleAvailable.length === 0 ? (
            <div className="p-10 text-center text-[12px] text-zinc-500">
              {installed.length > 0
                ? 'Every registry skill is already installed.'
                : 'The registry is empty or loading.'}
            </div>
          ) : (
            visibleAvailable.map((skill) => (
              <AvailableRow
                key={skill.id}
                skill={skill}
                busy={busy}
                onInstall={() =>
                  install({ kind: 'registry', skill_id: skill.id }, skill.name)
                }
              />
            ))
          )}
        </section>
        <p className="mt-3 font-mono text-[10px] text-zinc-600">
          {installed.filter((skill) => skill.enabled).length} enabled · {installed.length} installed
        </p>
      </div>

      {installOpen ? (
        <InstallDialog
          onClose={() => setInstallOpen(false)}
          onInstall={async (source, name) => {
            await install(source, name)
            setInstallOpen(false)
          }}
        />
      ) : null}
      {editing ? (
        <EditDialog
          skill={editing}
          project={project}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            void refresh()
          }}
        />
      ) : null}
    </div>
  )
}

function InstalledRow({
  skill,
  busy,
  onToggle,
  onEdit,
  onDelete,
}: {
  skill: InstalledSkill
  busy: boolean
  onToggle: () => void
  onEdit: () => void
  onDelete: () => void
}) {
  return (
    <div className="group flex items-center gap-3 border-b border-white/[0.08] px-4 py-3 last:border-b-0 sm:px-5">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full border border-white/[0.1] text-zinc-500">
        <Box size={14} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[12.5px] font-medium text-zinc-200">{skill.name}</p>
        <p className="mt-0.5 truncate font-mono text-[10px] text-zinc-600">{skill.path}</p>
      </div>
      <button
        type="button"
        onClick={onToggle}
        disabled={busy}
        aria-label={skill.enabled ? `Disable ${skill.name}` : `Enable ${skill.name}`}
        className={cn(
          'flex h-5 w-9 shrink-0 items-center rounded-full p-0.5 transition',
          skill.enabled ? 'justify-end bg-white' : 'justify-start bg-zinc-800',
        )}
      >
        <span className={cn('size-4 rounded-full transition', skill.enabled ? 'bg-black' : 'bg-zinc-500')} />
      </button>
      <IconButton label={`Edit ${skill.name}`} onClick={onEdit} className="size-8">
        <Pencil size={13} />
      </IconButton>
      <button
        type="button"
        onClick={onDelete}
        aria-label={`Delete ${skill.name}`}
        className="rounded-md p-1.5 text-zinc-600 opacity-60 transition hover:bg-red-500/10 hover:text-red-400 sm:opacity-0 sm:group-hover:opacity-100"
      >
        <Trash2 size={13} />
      </button>
    </div>
  )
}

function AvailableRow({
  skill,
  busy,
  onInstall,
}: {
  skill: RegistrySkill
  busy: boolean
  onInstall: () => void
}) {
  return (
    <div className="flex items-center gap-3 border-b border-white/[0.08] px-4 py-3 last:border-b-0 sm:px-5">
      <span className="flex size-8 shrink-0 items-center justify-center rounded-full border border-white/[0.1] text-zinc-500">
        <Box size={14} />
      </span>
      <div className="min-w-0 flex-1">
        <p className="truncate text-[12.5px] font-medium text-zinc-200">{skill.name}</p>
        <p className="mt-0.5 line-clamp-1 text-[11px] text-zinc-500">{skill.description}</p>
      </div>
      <span className="hidden font-mono text-[10px] text-zinc-500 sm:block">
        {skill.category ?? 'general'}
      </span>
      <Button variant="ghost" onClick={onInstall} disabled={busy} className="shrink-0">
        Install
      </Button>
    </div>
  )
}

/** Install dialog with four sources: registry, URL, pasted markdown, file. */
function InstallDialog({
  onClose,
  onInstall,
}: {
  onClose: () => void
  onInstall: (source: Parameters<typeof skillsApi.install>[0], name?: string) => Promise<void>
}) {
  const [tab, setTab] = useState<InstallTab>('registry')
  const [registryId, setRegistryId] = useState('')
  const [skillsshRef, setSkillsshRef] = useState('')
  const [skillsshName, setSkillsshName] = useState('')
  const [url, setUrl] = useState('')
  const [urlName, setUrlName] = useState('')
  const [pasteName, setPasteName] = useState('')
  const [pasteContent, setPasteContent] = useState('')
  const [fileContent, setFileContent] = useState('')
  const [fileName, setFileName] = useState('')
  const [available, setAvailable] = useState<RegistrySkill[]>([])
  const [working, setWorking] = useState(false)
  const fileRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    void skillsApi.available().then((res) => setAvailable(res.skills)).catch(() => {})
  }, [])

  function readFile(file: File) {
    setFileName(file.name.replace(/\.(md|markdown|txt)$/i, ''))
    const reader = new FileReader()
    reader.onload = () => setFileContent(String(reader.result ?? ''))
    reader.readAsText(file)
  }

  async function submit() {
    setWorking(true)
    try {
      if (tab === 'registry') {
        await onInstall({ kind: 'registry', skill_id: registryId }, registryId)
      } else if (tab === 'skillssh') {
        await onInstall(
          { kind: 'skillssh', url: skillsshRef.trim(), name: skillsshName.trim() || undefined },
          skillsshName.trim() || undefined,
        )
      } else if (tab === 'url') {
        await onInstall({ kind: 'url', url: url.trim(), name: urlName.trim() || undefined }, urlName.trim() || undefined)
      } else if (tab === 'paste') {
        await onInstall({ kind: 'content', name: pasteName.trim() || 'custom', content: pasteContent }, pasteName.trim() || 'custom')
      } else if (tab === 'file') {
        await onInstall({ kind: 'content', name: fileName.trim() || 'custom', content: fileContent }, fileName.trim() || 'custom')
      }
    } finally {
      setWorking(false)
    }
  }

  const canSubmit =
    (tab === 'registry' && registryId.trim().length > 0) ||
    (tab === 'skillssh' && skillsshRef.trim().length > 0) ||
    (tab === 'url' && url.trim().length > 0) ||
    (tab === 'paste' && pasteContent.trim().length > 0) ||
    (tab === 'file' && fileContent.trim().length > 0)

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <div className="w-full max-w-lg rounded-2xl border border-white/10 bg-[#241f1a] shadow-2xl">
        <div className="flex items-center gap-2 border-b border-white/10 px-5 py-4">
          <div className="flex-1">
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-600">Skill library</p>
            <h2 className="mt-1 text-[15px] font-semibold text-zinc-100">Install a skill</h2>
          </div>
          <IconButton label="Close" onClick={onClose} className="size-8">
            <X size={15} />
          </IconButton>
        </div>

        <div className="px-5 pt-4">
          <Segmented<InstallTab>
            value={tab}
            onChange={setTab}
            options={[
              { value: 'registry', label: 'Registry' },
              { value: 'skillssh', label: 'skills.sh' },
              { value: 'url', label: 'URL' },
              { value: 'paste', label: 'Paste' },
              { value: 'file', label: 'File' },
            ]}
          />
        </div>

        <div className="space-y-4 p-5">
          {tab === 'registry' ? (
            <label className="block">
              <span className="mb-1.5 block text-[11px] text-zinc-400">Built-in registry</span>
              <select
                value={registryId}
                onChange={(event) => setRegistryId(event.target.value)}
                className="h-9 w-full rounded-xl border border-white/10 bg-white/[0.04] px-3 text-[12px] text-zinc-200 outline-none"
              >
                <option value="" className="bg-zinc-900">
                  Choose a skill…
                </option>
                {available.map((skill) => (
                  <option key={skill.id} value={skill.id} className="bg-zinc-900">
                    {skill.name} — {skill.description}
                  </option>
                ))}
              </select>
            </label>
          ) : tab === 'skillssh' ? (
            <>
              <label className="block">
                <span className="mb-1.5 block text-[11px] text-zinc-400">
                  skills.sh skill <span className="text-zinc-600">(URL or owner/repo/skill)</span>
                </span>
                <TextField
                  value={skillsshRef}
                  onChange={(event) => setSkillsshRef(event.target.value)}
                  placeholder="https://www.skills.sh/emilkowalski/skills/apple-design"
                  aria-label="skills.sh skill"
                  leading={<Globe size={13} />}
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-[11px] text-zinc-400">
                  Name <span className="text-zinc-600">(defaults to the skill's name)</span>
                </span>
                <TextField
                  value={skillsshName}
                  onChange={(event) => setSkillsshName(event.target.value)}
                  placeholder="e.g. apple-design"
                  aria-label="Skill name"
                />
              </label>
              <p className="rounded-lg border border-white/[0.08] bg-white/[0.03] px-3 py-2 text-[10.5px] leading-[1.5] text-zinc-500">
                Installs from the skills.sh directory by fetching the skill's{' '}
                <code className="font-mono text-zinc-400">SKILL.md</code> from its GitHub repo.
              </p>
            </>
          ) : tab === 'url' ? (
            <>
              <label className="block">
                <span className="mb-1.5 block text-[11px] text-zinc-400">
                  URL to SKILL.md <span className="text-zinc-600">(raw markdown)</span>
                </span>
                <TextField
                  value={url}
                  onChange={(event) => setUrl(event.target.value)}
                  placeholder="https://raw.githubusercontent.com/…/SKILL.md"
                  aria-label="Skill URL"
                  leading={<Globe size={13} />}
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-[11px] text-zinc-400">
                  Name <span className="text-zinc-600">(defaults to the URL's file name)</span>
                </span>
                <TextField
                  value={urlName}
                  onChange={(event) => setUrlName(event.target.value)}
                  placeholder="e.g. release-checklist"
                  aria-label="Skill name"
                />
              </label>
            </>
          ) : tab === 'paste' ? (
            <>
              <label className="block">
                <span className="mb-1.5 block text-[11px] text-zinc-400">Name</span>
                <TextField
                  value={pasteName}
                  onChange={(event) => setPasteName(event.target.value.replace(/\s+/g, '-').toLowerCase())}
                  placeholder="e.g. release-checklist"
                  aria-label="Skill name"
                />
              </label>
              <label className="block">
                <span className="mb-1.5 block text-[11px] text-zinc-400">Markdown body</span>
                <textarea
                  rows={8}
                  value={pasteContent}
                  onChange={(event) => setPasteContent(event.target.value)}
                  placeholder="# My skill\n\nInstructions for the agent…"
                  className="w-full resize-none rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 font-mono text-[11px] leading-[1.55] text-zinc-200 outline-none placeholder:text-zinc-700 focus:border-white/25"
                />
              </label>
            </>
          ) : (
            <>
              <input
                ref={fileRef}
                type="file"
                accept=".md,.markdown,.txt,text/markdown"
                className="hidden"
                onChange={(event) => {
                  const file = event.target.files?.[0]
                  if (file) readFile(file)
                }}
              />
              <button
                type="button"
                onClick={() => fileRef.current?.click()}
                className="flex w-full flex-col items-center gap-2 rounded-xl border border-dashed border-white/15 bg-white/[0.02] px-4 py-8 text-center transition hover:border-white/30"
              >
                <Download size={18} className="text-zinc-500" />
                <span className="text-[12px] text-zinc-300">
                  {fileName ? `Loaded ${fileName}.md` : 'Choose a .md / .txt file'}
                </span>
                <span className="text-[10.5px] text-zinc-600">Its contents become the SKILL.md body</span>
              </button>
              {fileContent ? (
                <div className="max-h-40 overflow-y-auto rounded-lg border border-white/10 bg-black/20 p-2.5 font-mono text-[10.5px] leading-relaxed text-zinc-400">
                  {fileContent.slice(0, 2000)}
                  {fileContent.length > 2000 ? '\n…' : ''}
                </div>
              ) : null}
            </>
          )}

          <div className="flex justify-end gap-2 border-t border-white/[0.08] pt-4">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
            <Button onClick={() => void submit()} disabled={!canSubmit || working} className="bg-white text-black hover:bg-zinc-200">
              <Check size={13} /> Install
            </Button>
          </div>
        </div>
      </div>
    </div>
  )
}

/** Edit a skill's SKILL.md body, loading the current content first. */
function EditDialog({
  skill,
  project,
  onClose,
  onSaved,
}: {
  skill: InstalledSkill
  project: string
  onClose: () => void
  onSaved: () => void
}) {
  const [content, setContent] = useState<string | null>(null)
  const [error, setError] = useState<string>()
  const [working, setWorking] = useState(false)

  useEffect(() => {
    let cancelled = false
    void skillsApi
      .content(skill.id, project)
      .then((res) => {
        if (!cancelled) setContent(res.content)
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : 'Failed to load content')
      })
    return () => {
      cancelled = true
    }
  }, [skill.id, project])

  async function save() {
    if (content === null) return
    setWorking(true)
    try {
      await skillsApi.update(skill.id, content, project)
      onSaved()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Save failed')
      setWorking(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm">
      <div className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-2xl border border-white/10 bg-[#241f1a] shadow-2xl">
        <div className="flex items-center gap-2 border-b border-white/10 px-5 py-4">
          <div className="flex-1">
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-zinc-600">Edit skill</p>
            <h2 className="mt-1 truncate text-[15px] font-semibold text-zinc-100">{skill.name}</h2>
          </div>
          <IconButton label="Close" onClick={onClose} className="size-8">
            <X size={15} />
          </IconButton>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto p-5">
          {error ? (
            <div className="rounded-lg border border-red-500/20 bg-red-500/[0.07] px-3 py-2 text-[11px] text-red-300">{error}</div>
          ) : content === null ? (
            <div className="p-8 text-center text-[12px] text-zinc-500">Loading content…</div>
          ) : (
            <textarea
              value={content}
              onChange={(event) => setContent(event.target.value)}
              rows={22}
              className="w-full resize-none rounded-xl border border-white/10 bg-black/20 px-3 py-2.5 font-mono text-[11.5px] leading-[1.6] text-zinc-200 outline-none focus:border-white/25"
            />
          )}
        </div>
        <div className="flex justify-end gap-2 border-t border-white/[0.08] px-5 py-4">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button
            onClick={() => void save()}
            disabled={content === null || working}
            className="bg-white text-black hover:bg-zinc-200"
          >
            <Check size={13} /> Save
          </Button>
        </div>
      </div>
    </div>
  )
}
