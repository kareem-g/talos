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
import { workspaceApi, type DirListing } from '@/lib/api'
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

type MenuKind = 'slash' | 'at'

interface MenuItem {
  /** Text inserted when chosen (without the leading trigger char). */
  insert: string
  label: string
  hint?: string
}

/** The token (trigger + partial query) ending at the caret, if any. */
function activeToken(text: string, caret: number): { kind: MenuKind; query: string; start: number } | null {
  // Only look at the current line up to the caret.
  const upto = text.slice(0, caret)
  const lineStart = upto.lastIndexOf('\n') + 1
  const line = upto.slice(lineStart)
  const match = /(^|\s)([/@])([^\s/]*)$/.exec(line)
  if (!match) return null
  const kind: MenuKind = match[2] === '/' ? 'slash' : 'at'
  if (kind === 'slash') {
    // A slash only opens the menu as the message's first word — otherwise it
    // is ordinary punctuation mid-sentence.
    if (line.trimStart().length > match[0].trimStart().length) return null
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
  const [menu, setMenu] = useState<{ kind: MenuKind; query: string; start: number } | null>(null)
  const [menuIndex, setMenuIndex] = useState(0)

  const menuItems = useMemo<MenuItem[]>(() => {
    if (!menu) return []
    const query = menu.query.toLowerCase()
    if (menu.kind === 'slash') {
      return slashItems.filter((item) => item.label.toLowerCase().includes(query)).slice(0, 8)
    }
    const entries = atListing?.entries ?? []
    const filtered = entries.filter((entry) => entry.name.toLowerCase().includes(query))
    // A typed path that matches nothing is still insertable verbatim.
    if (filtered.length === 0 && menu.query.length > 0 && !query.includes('/')) return []
    return filtered.slice(0, 10).map((entry) => ({
      insert: entry.dir ? `${entry.name}/` : entry.name,
      label: entry.name,
      hint: entry.dir ? 'folder' : undefined,
    }))
  }, [menu, slashItems, atListing])

  function loadAt(path?: string) {
    setAtLoading(true)
    workspaceApi
      .dirs(path || projectPath, true)
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
      if (token.kind === 'at' && (!atListing || menu?.kind !== 'at')) loadAt()
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
    const trigger = menu.kind === 'slash' ? '/' : '@'
    const inserted = `${trigger}${item.insert} `
    const nextValue = `${before}${inserted}${after}`
    setValue(nextValue)
    setMenu(null)
    requestAnimationFrame(() => {
      textareaRef.current?.focus()
      const pos = (before + inserted).length
      textareaRef.current?.setSelectionRange(pos, pos)
      // Opening a folder keeps the @ menu alive for the next segment.
      if (menu.kind === 'at' && item.insert.endsWith('/')) {
        const dir = (projectPath ? projectPath.replace(/\/$/, '') + '/' : '') + before.slice(before.lastIndexOf('@') + 1) + item.insert
        void dir
        // Re-list from the resolved path on the next change event instead of
        // guessing here; the menu simply stays open with what we have.
        setMenu({ kind: 'at', query: '', start: menu.start })
      }
    })
  }

  function send() {
    const text = value.trim()
    if (!text || disabled) return
    setValue('')
    setMenu(null)
    onSend(text)
  }

  function insertCommand(command: string) {
    if (disabled) return
    setValue((current) => {
      const prefix = `/${command.replace(/^\//, '')} `
      if (current.trim() === prefix.trim()) return current
      return current ? `${current.trimEnd()} ${prefix}` : prefix
    })
    textareaRef.current?.focus()
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
                {menu.kind === 'slash' ? 'Commands' : 'Files'}
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
                onMouseDown={(event) => {
                  event.preventDefault()
                  applyItem(item)
                }}
                className={cn(
                  'flex w-full items-center gap-2.5 px-3 py-2 text-left transition-colors duration-75',
                  index === menuIndex ? 'bg-accent/[0.08]' : 'hover:bg-hover-2',
                )}
              >
                <span className={cn(
                  'flex size-5 shrink-0 items-center justify-center rounded-md font-mono text-[10px] font-semibold',
                  menu.kind === 'slash' ? 'bg-accent/[0.12] text-accent-ink' : 'bg-green/[0.10] text-green',
                )}>
                  {menu.kind === 'slash' ? '/' : '@'}
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

        {/* Quick command chips (tap targets, no typing required). */}
        {commands && commands.length > 0 && !working ? (
          <div
            className="scroll-thin mb-2 flex items-center gap-1.5 overflow-x-auto pb-0.5"
            aria-label="Agent commands"
          >
            {commands.map((command) => (
              <button
                key={command}
                type="button"
                onClick={() => insertCommand(command)}
                className={cn(
                  'inline-flex h-7 shrink-0 items-center rounded-lg border border-line/50 bg-surface/80 px-2.5',
                  'font-mono text-[11px] text-ink-2 transition-all duration-150',
                  'hover:border-line-strong hover:bg-hover hover:text-ink',
                )}
              >
                <span className="text-accent-ink">/</span>
                {command.replace(/^\//, '')}
              </button>
            ))}
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
          <textarea
            ref={textareaRef}
            rows={1}
            value={value}
            disabled={disabled}
            onFocus={() => setFocused(true)}
            onBlur={() => setFocused(false)}
            onChange={(changeEvent) => handleChange(changeEvent.target.value)}
            onBlurCapture={() => setTimeout(() => setMenu(null), 120)}
            onKeyDown={(keyEvent) => {
              if (keyEvent.key !== 'Enter') return
              if (keyEvent.shiftKey || isTouchPrimary()) return
              if (menu && menuItems.length > 0) return // handled by wrapper
              keyEvent.preventDefault()
              send()
            }}
            placeholder={placeholder ?? 'Message the agent…'}
            aria-label="Message"
            className={cn(
              'scroll-thin block w-full resize-none bg-transparent px-3.5 pt-3',
              'text-[13px] leading-[1.6] text-ink outline-none',
              'placeholder:text-ink-3 disabled:opacity-50',
            )}
            style={{ maxHeight: MAX_HEIGHT_PX }}
          />

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
