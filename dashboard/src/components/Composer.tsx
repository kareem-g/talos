/**
 * Composer — the message input, in the PromptBar shape: a raised rounded field
 * with controls tucked inside its lower edge.
 *
 * Three ways to say more than plain text:
 *   /command   agent-announced commands plus a curated built-in set
 *   @context   workspace files and folders, browsed live from the daemon
 *   chips      config controls (model, mode, …) passed in by the caller
 *
 * Mobile ergonomics that matter and are easy to get wrong:
 * - The input stays above the software keyboard via the viewport meta plus
 *   `dvh` units, not by measuring `visualViewport` every frame.
 * - Enter sends on desktop; on touch it inserts a newline.
 * - The field grows to a cap, then scrolls internally.
 */

import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { ArrowUp, StopIcon } from './ui'
import { skillsApi, workspaceApi, type DirListing } from '@/lib/api'
import { cn } from '@/lib/format'

const MAX_HEIGHT_PX = 168

/** Coarse pointer means touch: Enter must not send. */
function isTouchPrimary(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(pointer: coarse)').matches
}

/** Curated built-in slash commands per agent family (agent-announced ones win). */
const BUILTIN_COMMANDS: Record<string, string[]> = {
  claude: ['init', 'compact', 'review', 'security-review', 'pr-comments', 'release-notes'],
  opencode: ['init', 'compact', 'share', 'unshare', 'help'],
  codex: ['init', 'compact', 'review'],
}

type MenuKind = 'slash' | 'at' | 'skill' | 'mention'

interface MenuItem {
  /** Text inserted when chosen (without the leading trigger char). */
  insert: string
  label: string
  hint?: string
}

const TOKEN_RE = /([@$#/])(\S+)/g

type Segment =
  | { kind: 'text'; text: string }
  | { kind: 'at' | 'skill' | 'mention' | 'slash'; trigger: string; token: string; label: string }

/** Split the draft into plain-text and token (chip) segments for rendering. */
function parseSegments(
  text: string,
  mentionNames: Array<{ id: string; name: string }>,
): Segment[] {
  const segments: Segment[] = []
  let last = 0
  for (const match of text.matchAll(TOKEN_RE)) {
    const index = match.index ?? 0
    if (index > last) segments.push({ kind: 'text', text: text.slice(last, index) })
    const trigger = match[1]
    const token = match[2]

    // A slash is only a command chip at a word boundary (line/space start),
    // never mid-word like "and/or".
    if (trigger === '/' && index > 0 && !/\s/.test(text[index - 1])) {
      segments.push({ kind: 'text', text: match[0] })
      last = index + match[0].length
      continue
    }

    const kind = trigger === '@' ? 'at' : trigger === '$' ? 'skill' : trigger === '#' ? 'mention' : 'slash'
    let label = token
    if (kind === 'mention') {
      // Stored as "Name (id)" — show the friendly name.
      const idMatch = /\(([^)]+)\)$/.exec(token)
      const id = idMatch?.[1]
      const found = id ? mentionNames.find((m) => m.id === id) : undefined
      label = found?.name ?? token.replace(/\s*\([^)]*\)$/, '')
    } else if (kind === 'at') {
      label = token.replace(/\/$/, '')
    } else if (kind === 'slash') {
      label = token
    }
    segments.push({ kind, trigger, token, label })
    last = index + match[0].length
  }
  if (last < text.length) segments.push({ kind: 'text', text: text.slice(last) })
  return segments
}

const TRIGGERS: Record<MenuKind, string> = { slash: '/', at: '@', skill: '$', mention: '#' }

/** The token (trigger + partial query) ending at the caret, if any. */
function activeToken(text: string, caret: number): { kind: MenuKind; query: string; start: number } | null {
  // Only look at the current line up to the caret.
  const upto = text.slice(0, caret)
  const lineStart = upto.lastIndexOf('\n') + 1
  const line = upto.slice(lineStart)
  const match = /(^|\s)([/@$#])([^\s/]*)$/.exec(line)
  if (!match) return null
  const kind = (match[2] === '/' ? 'slash' : match[2] === '@' ? 'at' : match[2] === '$' ? 'skill' : 'mention') as MenuKind
  if (kind === 'slash') {
    // A slash opens the command menu at a word boundary (line/space start),
    // not mid-word like "and/or". Unlike before, it need not be the first word.
    const slashStart = lineStart + match.index + match[1].length
    if (slashStart > 0 && !/\s/.test(text[slashStart - 1])) return null
  }
  const start = lineStart + match.index + match[1].length
  return { kind, query: match[3], start }
}

export function Composer({
  onSend,
  onStop,
  onInterrupt,
  working,
  disabled,
  placeholder,
  controls,
  commands,
  agentId,
  projectPath,
  wide,
}: {
  onSend: (text: string) => void
  onStop?: () => void
  onInterrupt?: () => void
  /** True while the agent is running: send becomes stop. */
  working?: boolean
  disabled?: boolean
  placeholder?: string
  /** Config chips, rendered inside the field's lower edge. */
  controls?: ReactNode
  /**
   * Slash commands the agent announced (`commands_available`). Tapping one
   * inserts it into the draft — the agent, not this app, defines what it does.
   */
  commands?: string[]
  /** Used to pick the built-in command set for the / menu. */
  agentId?: string
  /** Root directory the @context browser opens in. */
  projectPath?: string
  /** Desktop workspace: drop the centered reading column, use full width. */
  wide?: boolean
}) {
  const [value, setValue] = useState('')
  const [focused, setFocused] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const backdropRef = useRef<HTMLDivElement>(null)

  // Slash menu items: agent-announced first, then curated built-ins.
  const slashItems = useMemo<MenuItem[]>(() => {
    const announced = (commands ?? []).map((name) => ({
      insert: name.replace(/^\//, ''),
      label: name.replace(/^\//, ''),
      hint: 'agent',
    }))
    const builtin = (BUILTIN_COMMANDS[agentId ?? ''] ?? []).map((name) => ({
      insert: name,
      label: name,
      hint: 'built-in',
    }))
    return [...announced, ...builtin.filter((b) => !announced.some((a) => a.insert === b.insert))]
  }, [commands, agentId])

  // @context browsing state.
  const [atListing, setAtListing] = useState<DirListing>()
  const [atLoading, setAtLoading] = useState(false)
  /** Current @ navigation path ('' = project root). Drilling into a folder updates this. */
  const [atPath, setAtPath] = useState('')
  // $ skills (agent-announced or daemon-listed) and # past conversations.
  const [skills, setSkills] = useState<Array<{ name: string; description: string }>>([])
  const [mentions, setMentions] = useState<Array<{ id: string; name: string }>>([])
  const [menu, setMenu] = useState<{ kind: MenuKind; query: string; start: number } | null>(null)
  const [menuIndex, setMenuIndex] = useState(0)

  function loadSkills() {
    if (skills.length > 0) return
    skillsApi
      .list()
      .then((body) => setSkills(body.skills ?? []))
      .catch(() => setSkills([]))
  }

  function loadMentions() {
    if (mentions.length > 0) return
    import('@/lib/api')
      .then(({ sessionsApi }) => sessionsApi.list())
      .then((all) =>
        setMentions(
          all
            .filter((s) => s.status !== 'archived')
            .slice(0, 30)
            .map((s) => ({ id: s.id, name: s.name })),
        ),
      )
      .catch(() => setMentions([]))
  }

  const menuItems = useMemo<MenuItem[]>(() => {
    if (!menu) return []
    const query = menu.query.toLowerCase()
    if (menu.kind === 'slash') {
      return slashItems.filter((item) => item.label.toLowerCase().includes(query)).slice(0, 8)
    }
    if (menu.kind === 'skill') {
      return skills
        .filter((skill) => skill.name.toLowerCase().includes(query))
        .slice(0, 8)
        .map((skill) => ({
          insert: skill.name,
          label: skill.name,
          hint: skill.description ? skill.description.slice(0, 60) : 'skill',
        }))
    }
    if (menu.kind === 'mention') {
      return mentions
        .filter((session) => session.name.toLowerCase().includes(query))
        .slice(0, 8)
        .map((session) => ({
          insert: `${session.name} (${session.id})`,
          label: session.name,
          hint: 'conversation',
        }))
    }
    const entries = atListing?.entries ?? []
    const filtered = entries.filter((entry) => entry.name.toLowerCase().includes(query))
    // A typed path that matches nothing is still insertable verbatim.
    if (filtered.length === 0 && menu.query.length > 0 && !query.includes('/')) return []
    // When navigated into a subdir, offer a ".." row to go back up.
    const parent: MenuItem[] =
      menu.kind === 'at' && atPath
        ? [{ insert: '..', label: '..', hint: 'up' }]
        : []
    return [
      ...parent,
      ...filtered.slice(0, 10).map((entry) => ({
        insert: entry.dir ? `${entry.name}/` : entry.name,
        label: entry.name,
        hint: entry.dir ? 'folder' : undefined,
      })),
    ]
  }, [menu, slashItems, atListing, skills, mentions, atPath])

  function loadAt(path?: string) {
    const resolved = path ?? atPath ?? ''
    setAtPath(resolved)
    setMenuIndex(0)
    setAtLoading(true)
    workspaceApi
      .dirs(resolved || projectPath, true)
      .then(setAtListing)
      .catch(() => setAtListing(undefined))
      .finally(() => setAtLoading(false))
  }

  // Autosize before paint, so there is no visible jump as the field grows.
  useLayoutEffect(() => {
    const element = textareaRef.current
    if (!element) return
    element.style.height = 'auto'
    element.style.height = `${Math.min(element.scrollHeight, MAX_HEIGHT_PX)}px`
  }, [value])

  function handleChange(next: string) {
    setValue(next)
    const caret = textareaRef.current?.selectionStart ?? next.length
    const token = activeToken(next, caret)
    if (token && !disabled) {
      if (token.kind === 'at') {
        // A freshly-started @ token resets navigation to the project root.
        if (menu?.kind !== 'at') setAtPath('')
        if (!atListing || menu?.kind !== 'at') loadAt()
      }
      if (token.kind === 'skill') loadSkills()
      if (token.kind === 'mention') loadMentions()
      setMenu(token)
      setMenuIndex(0)
    } else {
      setMenu(null)
    }
  }

  /** Replace the active trigger token with the chosen completion. */
  function applyItem(item: MenuItem) {
    if (!menu) return
    const caret = textareaRef.current?.selectionStart ?? value.length
    const before = value.slice(0, menu.start)
    const after = value.slice(caret)
    const trigger = TRIGGERS[menu.kind]

    // @ folder: drill into it instead of inserting — list its subdirs.
    if (menu.kind === 'at' && item.insert.endsWith('/')) {
      // Resolve the absolute path from the entry so the backend lists the right dir.
      const name = item.insert.replace(/\/$/, '')
      const entry = atListing?.entries.find((e) => e.dir && e.name === name)
      const childPath = entry?.path ?? (atPath ? `${atPath.replace(/\/$/, '')}/${name}` : name)
      loadAt(childPath)
      setMenu({ kind: 'at', query: '', start: menu.start })
      return
    }

    // @ "..": navigate up one directory level (absolute).
    if (menu.kind === 'at' && item.insert === '..') {
      const parentPath = atPath ? atPath.replace(/\/$/, '').split('/').slice(0, -1).join('/') : ''
      loadAt(parentPath || undefined)
      setMenu({ kind: 'at', query: '', start: menu.start })
      return
    }

    const inserted = `${trigger}${item.insert} `
    const nextValue = `${before}${inserted}${after}`
    setValue(nextValue)
    setMenu(null)
    requestAnimationFrame(() => {
      textareaRef.current?.focus()
      const pos = (before + inserted).length
      textareaRef.current?.setSelectionRange(pos, pos)
    })
  }

  function send() {
    const text = value.trim()
    if (!text || disabled) return
    setValue('')
    setMenu(null)
    onSend(text)
  }

  const canSend = value.trim().length > 0 && !disabled

  return (
    <div
      className="shrink-0 px-3 pb-3 pt-1.5"
      style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
    >
      <div className={cn('relative mx-auto w-full', !wide && 'max-w-[46rem]')}>
        {/* Completion menu — IDE-style floating popup with sections. */}
        {menu && menuItems.length > 0 ? (
          <div
            role="listbox"
            aria-label={menu.kind === 'slash' ? 'Commands' : 'Workspace context'}
            className="animate-up absolute bottom-full left-0 right-0 z-20 mb-2 overflow-hidden rounded-xl border border-line/60 bg-surface shadow-overlay backdrop-blur-xl"
          >
            <div className="px-2.5 py-1.5 border-b border-line/40">
              <span className="font-mono text-[9.5px] uppercase tracking-[0.16em] text-ink-3">
                {menu.kind === 'slash' ? 'Commands' : menu.kind === 'at' ? 'Files' : menu.kind === 'skill' ? 'Skills' : 'Conversations'}
              </span>
            </div>
            {menu.kind === 'at' && atLoading ? (
              <p className="px-3 py-2 text-[11px] text-ink-3">Listing…</p>
            ) : null}
            <div className="max-h-[240px] overflow-y-auto scroll-thin py-1">
            {menuItems.map((item, index) => (
              <button
                key={`${item.insert}-${index}`}
                type="button"
                role="option"
                aria-selected={index === menuIndex}
                ref={(node) => {
                  if (index === menuIndex && node) node.scrollIntoView({ block: 'nearest' })
                }}
                onMouseDown={(event) => {
                  event.preventDefault()
                  applyItem(item)
                }}
                className={cn(
                  'flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors duration-75',
                  index === menuIndex
                    ? 'bg-white/[0.14] text-white ring-1 ring-inset ring-white/20'
                    : 'hover:bg-white/[0.06]',
                )}
              >
                <span className={cn(
                  'flex size-5 shrink-0 items-center justify-center rounded-md font-mono text-[10px] font-semibold',
                  menu.kind === 'slash'
                    ? 'bg-accent/[0.12] text-accent-ink'
                    : menu.kind === 'skill'
                      ? 'bg-purple-400/[0.12] text-purple-300'
                      : menu.kind === 'mention'
                        ? 'bg-sky-400/[0.12] text-sky-300'
                        : 'bg-green/[0.10] text-green',
                )}>
                  {TRIGGERS[menu.kind]}
                </span>
                <span className="min-w-0 flex-1 truncate font-mono text-[12px] text-ink">{item.label}</span>
                {item.hint ? (
                  <span className="shrink-0 rounded-md bg-inset px-1.5 py-0.5 text-[9.5px] uppercase tracking-[0.06em] text-ink-3">{item.hint}</span>
                ) : null}
              </button>
            ))}
            </div>
          </div>
        ) : null}


        <div
          className={cn(
            'overflow-hidden rounded-2xl border bg-surface/90 shadow-raised backdrop-blur-sm',
            'transition-colors duration-150',
            focused ? 'border-accent/30' : 'border-line/60',
          )}
          onKeyDown={(keyEvent) => {
            if (!menu || menuItems.length === 0) return
            if (keyEvent.key === 'ArrowDown') {
              keyEvent.preventDefault()
              setMenuIndex((index) => (index + 1) % menuItems.length)
            } else if (keyEvent.key === 'ArrowUp') {
              keyEvent.preventDefault()
              setMenuIndex((index) => (index - 1 + menuItems.length) % menuItems.length)
            } else if (keyEvent.key === 'Enter' && !isTouchPrimary()) {
              keyEvent.preventDefault()
              applyItem(menuItems[menuIndex])
            } else if (keyEvent.key === 'Escape') {
              keyEvent.preventDefault()
              setMenu(null)
            }
          }}
        >
          <div className="relative">
            {/* Backdrop: renders the draft with inline chips behind the textarea. */}
            <div
              aria-hidden
              className={cn(
                'pointer-events-none absolute inset-0 overflow-hidden px-3.5 pt-3',
                'whitespace-pre-wrap break-words text-[13px] leading-[1.6] text-ink',
              )}
              ref={backdropRef}
            >
              {parseSegments(value, mentions).map((segment, index) =>
                segment.kind === 'text' ? (
                  <span key={index}>{segment.text}</span>
                ) : (
                  <span
                    key={index}
                    className={cn(
                      'inline-flex max-w-full items-baseline rounded px-0.5 py-[1px]',
                      'text-[12px] font-medium',
                      segment.kind === 'at' && 'bg-green/[0.16] text-green',
                      segment.kind === 'skill' && 'bg-purple-400/[0.18] text-purple-300',
                      segment.kind === 'mention' && 'bg-sky-400/[0.16] text-sky-300',
                      segment.kind === 'slash' && 'bg-orange/[0.16] text-orange',
                    )}
                  >
                    <span className="shrink-0 opacity-60">{segment.trigger}</span>
                    <span className="truncate">{segment.label}</span>
                  </span>
                ),
              )}
              {/* Trailing space keeps the last line's height in sync. */}
              {' '}
            </div>
            <textarea
              ref={textareaRef}
              rows={1}
              value={value}
              disabled={disabled}
              onFocus={() => setFocused(true)}
              onBlur={() => setFocused(false)}
              onChange={(changeEvent) => handleChange(changeEvent.target.value)}
              onScroll={(scrollEvent) => {
                if (backdropRef.current) backdropRef.current.scrollTop = (scrollEvent.target as HTMLTextAreaElement).scrollTop
              }}
              onBlurCapture={() => setTimeout(() => setMenu(null), 120)}
              onKeyDown={(keyEvent) => {
                if (keyEvent.key === 'Backspace') {
                  // Delete a whole chip (token) as a single unit when the caret
                  // sits immediately after it.
                  const caret = textareaRef.current?.selectionStart ?? value.length
                  if (caret === textareaRef.current?.selectionEnd && caret > 0) {
                    const before = value.slice(0, caret)
                    const m = /([@$#])(\S*)$/.exec(before)
                    if (m && m.index < caret) {
                      keyEvent.preventDefault()
                      setValue(before.slice(0, m.index) + value.slice(caret))
                      return
                    }
                  }
                }
                if (keyEvent.key !== 'Enter') return
                if (keyEvent.shiftKey || isTouchPrimary()) return
                if (menu && menuItems.length > 0) return // handled by wrapper
                keyEvent.preventDefault()
                send()
              }}
              placeholder={placeholder ?? 'Message the agent…'}
              aria-label="Message"
              className={cn(
                'scroll-thin relative block w-full resize-none bg-transparent px-3.5 pt-3',
                'text-[13px] leading-[1.6] text-transparent caret-white outline-none',
                'placeholder:text-ink-3 disabled:opacity-50',
              )}
              style={{ maxHeight: MAX_HEIGHT_PX }}
            />
          </div>

          <div className="flex items-end justify-between gap-2 px-2 pb-2 pt-1.5">
            <div className="flex min-w-0 flex-1 items-center gap-1.5 overflow-hidden">
              <span
                aria-hidden
                title="Type / for commands, @ for files"
                className="hidden shrink-0 font-mono text-[11px] text-ink-3 sm:block"
              >
                / · @
              </span>
              <div className="scroll-thin flex min-w-0 flex-1 items-center gap-1.5 overflow-x-auto pb-0.5">{controls}</div>
            </div>

            {working ? (
              <span className="flex shrink-0 items-center gap-1.5">
                {onInterrupt ? (
                  <button
                    type="button"
                    onClick={onInterrupt}
                    aria-label="Interrupt"
                    title="Interrupt (Ctrl+C)"
                    className={cn(
                      'flex size-8 items-center justify-center rounded-full',
                      'bg-hover text-ink-2 transition-[background-color,transform] duration-150',
                      'hover:bg-line-strong hover:text-ink active:scale-95',
                    )}
                  >
                    <span className="font-mono text-[10px] font-bold">^C</span>
                  </button>
                ) : null}
                <button
                  type="button"
                  onClick={onStop}
                  aria-label="Stop the agent"
                  className={cn(
                    'flex size-8 items-center justify-center rounded-full',
                    'bg-red-tint text-red transition-[background-color,transform] duration-150',
                    'hover:bg-red-tint active:scale-95',
                  )}
                >
                  <StopIcon />
                </button>
              </span>
            ) : (
              <button
                type="button"
                onClick={send}
                disabled={!canSend}
                aria-label="Send"
                className={cn(
                  'flex size-8 shrink-0 items-center justify-center rounded-full',
                  'transition-[background-color,color,transform] duration-150',
                  canSend ? 'bg-ink text-canvas active:scale-95' : 'bg-hover text-ink-3',
                )}
              >
                <ArrowUp />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}
