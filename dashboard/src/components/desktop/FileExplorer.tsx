/**
 * FileExplorer — the workspace file tree for the session sidebar.
 *
 * Lazy: only the root lists on mount; every directory loads its entries on
 * first expand via `/api/workspace/dirs?files=1` and caches them. Clicking a
 * file publishes it to the file-viewer store — the right pane's File tab
 * renders it. Directories sort first, everything case-insensitive.
 *
 * Noise (dotfiles, build output, dependency dirs) stays hidden so the tree
 * reads like a project, not a disk dump.
 */

import { useCallback, useEffect, useState } from 'react'
import { ChevronRight, FileText, Folder, FolderOpen, ImageIcon } from 'lucide-react'
import { workspaceApi } from '@/lib/api'
import { cn } from '@/lib/format'

const SKIPPED_DIRS = new Set([
  '.git',
  'node_modules',
  'target',
  'dist',
  'build',
  '__pycache__',
  '.venv',
  'venv',
  'coverage',
  '.next',
  '.turbo',
])

function visible(name: string, dir: boolean): boolean {
  if (name.startsWith('.')) return false
  if (dir && SKIPPED_DIRS.has(name)) return false
  return true
}

interface Entry {
  name: string
  path: string
  dir: boolean
}

function sortEntries(entries: Entry[]): Entry[] {
  return [...entries].sort((a, b) => {
    if (a.dir !== b.dir) return a.dir ? -1 : 1
    return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' })
  })
}

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'svg', 'ico', 'bmp'])

function FileGlyph({ name }: { name: string }) {
  const dot = name.lastIndexOf('.')
  const ext = dot > 0 ? name.slice(dot + 1).toLowerCase() : ''
  if (IMAGE_EXTS.has(ext)) return <ImageIcon size={13} className="shrink-0 text-ink-3" />
  return <FileText size={13} className="shrink-0 text-ink-3" />
}

export function FileExplorer({
  root,
  selectedPath,
  onOpenFile,
}: {
  /** Absolute workspace path. Empty = no workspace (Inbox). */
  root: string
  /** Currently previewed file, for the active highlight. */
  selectedPath?: string | null
  onOpenFile: (path: string) => void
}) {
  const [children, setChildren] = useState<Map<string, Entry[]>>(new Map())
  const [expanded, setExpanded] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState<Set<string>>(new Set())
  const [failed, setFailed] = useState<Map<string, string>>(new Map())

  const load = useCallback(async (dir: string) => {
    setLoading((current) => new Set(current).add(dir))
    setFailed((current) => {
      const next = new Map(current)
      next.delete(dir)
      return next
    })
    try {
      const listing = await workspaceApi.dirs(dir, true)
      const entries = sortEntries(
        (listing.entries ?? [])
          .filter((entry) => visible(entry.name, entry.dir === true))
          .map((entry) => ({ name: entry.name, path: entry.path, dir: entry.dir === true })),
      )
      setChildren((current) => new Map(current).set(dir, entries))
    } catch (cause) {
      setFailed((current) =>
        new Map(current).set(dir, cause instanceof Error ? cause.message : 'Could not list files'),
      )
    } finally {
      setLoading((current) => {
        const next = new Set(current)
        next.delete(dir)
        return next
      })
    }
  }, [])

  // Fresh root → fresh tree. The root itself starts expanded.
  useEffect(() => {
    setChildren(new Map())
    setFailed(new Map())
    setLoading(new Set())
    if (!root) {
      setExpanded(new Set())
      return
    }
    setExpanded(new Set([root]))
    void load(root)
  }, [root, load])

  function toggle(dir: string) {
    setExpanded((current) => {
      const next = new Set(current)
      if (next.has(dir)) next.delete(dir)
      else {
        next.add(dir)
        if (!children.has(dir) && !loading.has(dir)) void load(dir)
      }
      return next
    })
  }

  if (!root) {
    return (
      <p className="px-3 py-3 text-[10.5px] leading-relaxed text-zinc-600">
        No workspace folder — files appear once the session has a project.
      </p>
    )
  }

  const rootEntries = children.get(root) ?? []
  const rootFailed = failed.get(root)
  const rootLoading = loading.has(root) && rootEntries.length === 0

  return (
    <div className="py-1" role="tree" aria-label="Workspace files">
      {rootLoading ? (
        <p className="px-3 py-2 font-mono text-[10px] text-zinc-600">Listing files…</p>
      ) : null}
      {rootFailed ? (
        <div className="px-3 py-2">
          <p className="text-[10.5px] text-red-400">{rootFailed}</p>
          <button
            type="button"
            onClick={() => void load(root)}
            className="mt-1 rounded-md px-1.5 py-0.5 font-mono text-[10px] text-zinc-400 hover:bg-white/[0.06] hover:text-zinc-200"
          >
            Retry
          </button>
        </div>
      ) : null}
      {rootEntries.map((entry) => (
        <TreeNode
          key={entry.path}
          entry={entry}
          depth={0}
          expanded={expanded}
          childrenMap={children}
          loading={loading}
          failed={failed}
          selectedPath={selectedPath}
          onToggle={toggle}
          onRetry={load}
          onOpenFile={onOpenFile}
        />
      ))}
      {!rootLoading && !rootFailed && rootEntries.length === 0 ? (
        <p className="px-3 py-2 text-[10.5px] text-zinc-600">Empty folder.</p>
      ) : null}
    </div>
  )
}

function TreeNode({
  entry,
  depth,
  expanded,
  childrenMap,
  loading,
  failed,
  selectedPath,
  onToggle,
  onRetry,
  onOpenFile,
}: {
  entry: Entry
  depth: number
  expanded: Set<string>
  childrenMap: Map<string, Entry[]>
  loading: Set<string>
  failed: Map<string, string>
  selectedPath?: string | null
  onToggle: (dir: string) => void
  onRetry: (dir: string) => void
  onOpenFile: (path: string) => void
}) {
  const isOpen = expanded.has(entry.path)
  const kids = childrenMap.get(entry.path) ?? []
  const isLoading = loading.has(entry.path)
  const error = failed.get(entry.path)

  if (!entry.dir) {
    const active = selectedPath === entry.path
    return (
      <button
        type="button"
        role="treeitem"
        aria-selected={active}
        title={entry.path}
        onClick={() => onOpenFile(entry.path)}
        style={{ paddingLeft: depth * 12 + 10 }}
        className={cn(
          'flex h-7 w-full items-center gap-1.5 rounded-md pr-2 text-left transition-colors duration-100',
          active ? 'bg-white/[0.09] text-white' : 'text-zinc-400 hover:bg-white/[0.05] hover:text-zinc-100',
        )}
      >
        <FileGlyph name={entry.name} />
        <span className="min-w-0 flex-1 truncate font-mono text-[11px] leading-none">{entry.name}</span>
      </button>
    )
  }

  return (
    <div role="group">
      <button
        type="button"
        role="treeitem"
        aria-expanded={isOpen}
        title={entry.path}
        onClick={() => onToggle(entry.path)}
        style={{ paddingLeft: depth * 12 + 6 }}
        className="flex h-7 w-full items-center gap-1 rounded-md pr-2 text-left text-zinc-300 transition-colors duration-100 hover:bg-white/[0.05] hover:text-zinc-100"
      >
        <ChevronRight
          size={12}
          className={cn('shrink-0 text-zinc-600 transition-transform duration-150', isOpen && 'rotate-90')}
        />
        {isOpen ? (
          <FolderOpen size={13} className="shrink-0 text-zinc-500" />
        ) : (
          <Folder size={13} className="shrink-0 text-zinc-500" />
        )}
        <span className="min-w-0 flex-1 truncate text-[11.5px] leading-none">{entry.name}</span>
        {isLoading ? <span className="size-2 shrink-0 animate-pulse rounded-full bg-zinc-600" aria-hidden /> : null}
      </button>
      {isOpen ? (
        <div>
          {error ? (
            <div className="flex items-center gap-1 py-1" style={{ paddingLeft: (depth + 1) * 12 + 10 }}>
              <span className="truncate text-[10px] text-red-400">{error}</span>
              <button
                type="button"
                onClick={() => onRetry(entry.path)}
                className="shrink-0 rounded px-1 font-mono text-[10px] text-zinc-400 hover:bg-white/[0.06]"
              >
                Retry
              </button>
            </div>
          ) : null}
          {kids.map((kid) => (
            <TreeNode
              key={kid.path}
              entry={kid}
              depth={depth + 1}
              expanded={expanded}
              childrenMap={childrenMap}
              loading={loading}
              failed={failed}
              selectedPath={selectedPath}
              onToggle={onToggle}
              onRetry={onRetry}
              onOpenFile={onOpenFile}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}
