import { useEffect, useMemo, useRef, useState } from 'react'
import { Button, Dot, IconButton, Notice } from '../ui'
import { useStore, getConversation, useConversation } from '@/store'
import { socket } from '@/lib/socket'
import { cn } from '@/lib/format'
import { isActive, type Session } from '@/types/session'
import { Timeline } from '../Timeline'
import { Composer } from '../Composer'
import { TerminalView } from '../TerminalView'
import { ConfigBar } from '../ConfigControls'
import { statusLabel } from '../SessionList'
import { agentDisplayFor } from '@/lib/remote'

const LEFT_KEY = 'agentdeck-desktop-left-collapsed'
const RIGHT_KEY = 'agentdeck-desktop-right-collapsed'
const NOTES_PREFIX = 'agentdeck-notes-'

export function SessionWorkspace({ session, onBack }: { session: Session; onBack: () => void }) {
  const conversation = useConversation(session.id)
  const config = useStore((s) => s.configs[session.id])
  const notice = useStore((s) => s.notices[session.id])
  const connection = useStore((s) => s.connection)
  const providers = useStore((s) => s.providers)
  const openSession = useStore((s) => s.openSession)
  const sendPrompt = useStore((s) => s.sendPrompt)
  const stopSession = useStore((s) => s.stopSession)
  const setConfig = useStore((s) => s.setConfig)
  const dismissNotice = useStore((s) => s.dismissNotice)
  const deleteSession = useStore((s) => s.deleteSession)
  const [tab, setTab] = useState<'chat' | 'terminal'>('chat')

  const [leftCollapsed, setLeftCollapsed] = useState(() => {
    try {
      return localStorage.getItem(LEFT_KEY) === '1'
    } catch {
      return false
    }
  })
  const [rightCollapsed, setRightCollapsed] = useState(() => {
    try {
      const v = localStorage.getItem(RIGHT_KEY)
      if (v !== null) return v === '1'
      // default collapsed on 1024–1280 per spec
      return window.matchMedia('(max-width: 1280px)').matches
    } catch {
      return false
    }
  })
  const [editingTitle, setEditingTitle] = useState(false)
  const [titleDraft, setTitleDraft] = useState(session.name)
  const titleInputRef = useRef<HTMLInputElement>(null)
  const [notes, setNotes] = useState(() => {
    try {
      return localStorage.getItem(NOTES_PREFIX + session.id) ?? ''
    } catch {
      return ''
    }
  })

  useEffect(() => {
    try {
      localStorage.setItem(LEFT_KEY, leftCollapsed ? '1' : '0')
    } catch {}
  }, [leftCollapsed])
  useEffect(() => {
    try {
      localStorage.setItem(RIGHT_KEY, rightCollapsed ? '1' : '0')
    } catch {}
  }, [rightCollapsed])
  useEffect(() => {
    try {
      localStorage.setItem(NOTES_PREFIX + session.id, notes)
    } catch {}
  }, [notes, session.id])

  useEffect(() => {
    if (getConversation(session.id).messages.length === 0) void openSession(session.id)
  }, [session.id, openSession])

  useEffect(() => {
    if (editingTitle) titleInputRef.current?.focus()
  }, [editingTitle])

  const provider = useMemo(() => providers.find((p) => p.id === session.agent), [providers, session.agent])
  const working = isActive(session.status)
  const resumable = session.status === 'needs_resume' || session.status === 'exited'
  const agentDisplay = useMemo(() => agentDisplayFor(session, conversation, connection), [session, conversation.activity, connection])

  // Outline: sections derived from messages
  const outline = useMemo(() => {
    return conversation.messages.map((m, idx) => {
      const preview =
        m.parts
          .filter((p) => p.kind === 'text')
          .map((p) => (p as { text: string }).text)
          .join(' ')
          .slice(0, 48) || m.role
      return { idx, role: m.role, preview: preview || `Section ${idx + 1}` }
    })
  }, [conversation.messages])

  const centerRef = useRef<HTMLDivElement>(null)
  const scrollToSection = (idx: number) => {
    const host = centerRef.current
    if (!host) return
    const scroller = host.querySelector('.scroll-thin') as HTMLElement | null
    const target = scroller ?? host
    const max = target.scrollHeight - target.clientHeight
    const ratio = conversation.messages.length > 1 ? idx / (conversation.messages.length - 1) : 0
    target.scrollTo({ top: ratio * Math.max(0, max), behavior: 'smooth' })
  }

  // Keyboard: Esc closes panels (right first then left)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        if (!rightCollapsed) setRightCollapsed(true)
        else if (!leftCollapsed) setLeftCollapsed(true)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [leftCollapsed, rightCollapsed])

  const duration = useMemo(() => {
    const start = new Date(session.created_at).getTime()
    const end = new Date(session.updated_at).getTime()
    const diff = Math.max(0, end - start)
    const mins = Math.floor(diff / 60000)
    if (mins < 60) return `${mins}m`
    const hrs = Math.floor(mins / 60)
    return `${hrs}h ${mins % 60}m`
  }, [session.created_at, session.updated_at])

  return (
    <div className="flex h-dvh flex-col bg-canvas text-ink">
      {/* Top bar */}
      <header className="flex h-14 shrink-0 items-center gap-3 border-b border-line bg-canvas px-3">
        <IconButton label="Back to sessions" onClick={onBack} className="-ml-1">
          <BackIcon />
        </IconButton>
        <span className="h-6 w-px bg-line" aria-hidden />
        <div className="min-w-0 flex-1">
          {editingTitle ? (
            <input
              ref={titleInputRef}
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={() => setEditingTitle(false)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') setEditingTitle(false)
                if (e.key === 'Escape') {
                  setTitleDraft(session.name)
                  setEditingTitle(false)
                }
              }}
              className="w-full max-w-[360px] rounded-control border border-line bg-field px-2 py-1 text-[13px] font-medium outline-none focus:border-line-strong"
            />
          ) : (
            <button type="button" onClick={() => setEditingTitle(true)} className="truncate text-left text-[13px] font-medium tracking-[-0.01em] hover:underline">
              {session.name}
            </button>
          )}
          <div className="flex items-center gap-1.5 text-[11px] text-ink-3">
            <Dot tone={agentDisplay.tone} pulse={agentDisplay.pulse} />
            <span className={agentDisplay.tone === 'green' ? 'text-green' : undefined}>{agentDisplay.label}</span>
            <span aria-hidden>·</span>
            <span className="rounded-full border border-line bg-inset px-1.5 py-0.5 text-[10px] leading-none">{statusLabel(session.status)}</span>
            {provider ? (
              <>
                <span aria-hidden>·</span>
                <span>{provider.name}</span>
              </>
            ) : null}
          </div>
        </div>
        <div className="flex items-center gap-1">
          <IconButton label={leftCollapsed ? 'Show left panel' : 'Hide left panel'} onClick={() => setLeftCollapsed((v) => !v)}>
            <PanelLeftIcon collapsed={leftCollapsed} />
          </IconButton>
          <IconButton label={rightCollapsed ? 'Show right panel' : 'Hide right panel'} onClick={() => setRightCollapsed((v) => !v)}>
            <PanelRightIcon collapsed={rightCollapsed} />
          </IconButton>
          <span className="mx-1 h-5 w-px bg-line" aria-hidden />
          <Button
            variant="ghost"
            onClick={() => {
              navigator.clipboard?.writeText(window.location.href)
            }}
          >
            Share
          </Button>
          <Button
            variant="ghost"
            onClick={() => {
              const blob = new Blob([JSON.stringify(session, null, 2)], { type: 'application/json' })
              const url = URL.createObjectURL(blob)
              const a = document.createElement('a')
              a.href = url
              a.download = `${session.name}.json`
              a.click()
              URL.revokeObjectURL(url)
            }}
          >
            Export
          </Button>
          <Button
            variant="danger"
            onClick={async () => {
              if (confirm(`Delete "${session.name}"?`)) {
                await deleteSession(session.id)
                onBack()
              }
            }}
          >
            Delete
          </Button>
        </div>
      </header>

      {notice ? <Notice message={notice} onDismiss={() => dismissNotice(session.id)} /> : null}

      <div className="flex min-h-0 flex-1">
        {/* Left panel — 260–320 collapsible, persists in localStorage */}
        <aside
          className={cn(
            'flex shrink-0 flex-col border-r border-line bg-canvas transition-[width] duration-200 motion-reduce:transition-none',
            leftCollapsed ? 'w-0 overflow-hidden border-r-0' : 'w-[300px]',
          )}
          aria-hidden={leftCollapsed}
        >
          <div className="scroll-thin flex-1 overflow-y-auto p-4">
            <Section title="Session metadata">
              <MetaRow label="Created" value={new Date(session.created_at).toLocaleString()} />
              <MetaRow label="Duration" value={duration} />
              <MetaRow label="Tokens" value={session.tokens_used != null ? String(session.tokens_used) : '—'} />
              <MetaRow label="Cost" value={session.cost != null ? `$${session.cost.toFixed(2)}` : '—'} />
              <MetaRow label="Project" value={session.project ?? '—'} mono />
              <MetaRow label="Worktree" value={session.worktree_path ?? '—'} mono />
            </Section>

            <Section title="Outline">
              {outline.length === 0 ? (
                <p className="text-[12px] text-ink-3">No sections yet.</p>
              ) : (
                <ol className="flex flex-col gap-1">
                  {outline.map((s) => (
                    <li key={s.idx}>
                      <button
                        type="button"
                        onClick={() => scrollToSection(s.idx)}
                        className="flex w-full items-center gap-2 rounded-control px-2 py-1.5 text-left hover:bg-hover-2"
                      >
                        <span className={cn('size-1.5 shrink-0 rounded-full', s.role === 'user' ? 'bg-accent' : 'bg-green')} aria-hidden />
                        <span className="line-clamp-1 text-[12px] text-ink-2">{s.preview}</span>
                      </button>
                    </li>
                  ))}
                </ol>
              )}
            </Section>

            <Section title="Notes">
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Personal annotations for this session…"
                rows={4}
                className="w-full resize-none rounded-control border border-line bg-field px-2.5 py-2 text-[12px] leading-[1.6] text-ink outline-none placeholder:text-ink-3 focus:border-line-strong"
              />
              <p className="mt-1 text-[11px] text-ink-3">Stored locally for this browser.</p>
            </Section>
          </div>
        </aside>

        {/* Center */}
        <main className="flex min-w-0 flex-1 flex-col bg-canvas">
          <div className="flex shrink-0 items-center gap-2 border-b border-line bg-inset px-3 py-2">
            <div className="flex rounded-control border border-line bg-surface p-0.5">
              <button
                type="button"
                onClick={() => setTab('chat')}
                className={cn('rounded-[6px] px-2.5 py-1 text-[11.5px]', tab === 'chat' ? 'bg-hover text-ink' : 'text-ink-3')}
              >
                Chat
              </button>
              <button
                type="button"
                onClick={() => setTab('terminal')}
                className={cn('rounded-[6px] px-2.5 py-1 text-[11.5px]', tab === 'terminal' ? 'bg-hover text-ink' : 'text-ink-3')}
              >
                Terminal
              </button>
            </div>
            <span className="ml-auto text-[11px] text-ink-3">
              {session.tokens_used != null ? `${session.tokens_used} tokens` : ''} {tab === 'chat' ? '· Scrollable' : ''}
            </span>
          </div>

          <div ref={centerRef} className="flex min-h-0 flex-1 flex-col bg-canvas">
            {tab === 'chat' ? (
              <>
                <div className="scroll-thin min-h-0 flex-1 overflow-y-auto">
                  <div className="mx-auto w-full max-w-[900px] p-4">
                    <TimelineWithAnchors conversation={conversation} onRespond={(id, d) => useStore.getState().respondToApproval(session.id, id, d)} />
                  </div>
                </div>
                {resumable ? (
                  <div className="shrink-0 border-t border-line bg-surface p-3">
                    <div className="mx-auto flex max-w-[900px] items-center gap-3">
                      <p className="flex-1 text-[12px] text-ink-2">Agent stopped. Resume to continue.</p>
                      <Button variant="primary" onClick={() => void useStore.getState().resumeSession(session.id)}>
                        Resume
                      </Button>
                    </div>
                  </div>
                ) : (
                  <div className="shrink-0 border-t border-line bg-surface">
                    <div className="mx-auto max-w-[900px]">
                      <Composer
                        onSend={(t) => sendPrompt(session.id, t)}
                        onStop={() => void stopSession(session.id)}
                        onInterrupt={() => socket.interruptSession(session.id)}
                        working={working}
                        placeholder={connection !== 'connected' ? 'Waiting for connection…' : 'Message the agent…'}
                        controls={
                          config ? (
                            <ConfigBar
                              options={config.options}
                              live={config.live}
                              modelsSource={provider?.modelsSource}
                              onChange={(id, v) => void setConfig(session.id, id, v)}
                            />
                          ) : null
                        }
                      />
                    </div>
                  </div>
                )}
              </>
            ) : (
              <TerminalView
                output={conversation.terminal}
                interactive={config?.interactiveTerminal === true}
                transport={config?.transport}
                connectionState={connection}
                onInput={(d) => socket.sendTerminalInput(session.id, d)}
                onResize={(c, r) => socket.resizeTerminal(session.id, c, r)}
              />
            )}
          </div>
        </main>

        {/* Right panel — 280–360 toggleable, collapses to dock at 1024–1280 */}
        <aside className={cn('flex shrink-0 flex-col border-l border-line bg-inset transition-[width] duration-200 motion-reduce:transition-none', rightCollapsed ? 'w-0 overflow-hidden border-l-0' : 'w-[320px]')}>
          <div className="scroll-thin flex-1 overflow-y-auto p-4">
            <Section title="References">
              {session.project ? (
                <p className="break-all font-mono text-[11.5px] text-ink-2">{session.project}</p>
              ) : (
                <p className="text-[12px] text-ink-3">No linked references.</p>
              )}
              {config?.options.length ? (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {config.options.map((o) => (
                    <span key={o.id} className="rounded-full border border-line bg-surface px-2 py-0.5 text-[11px] text-ink-2">
                      {o.name}: {o.currentValue ?? '—'}
                    </span>
                  ))}
                </div>
              ) : null}
            </Section>

            <Section title="Metadata">
              <MetaRow label="Model" value={config?.options.find((o) => o.id === 'model' || o.category === 'model')?.currentValue ?? '—'} />
              <MetaRow label="Agent" value={provider?.name ?? session.agent} />
              <MetaRow label="Status" value={statusLabel(session.status)} />
              <MetaRow label="Branch" value={session.branch ?? '—'} mono />
            </Section>

            <Section title="Action log">
              <div className="flex flex-col gap-1.5">
                {conversation.messages.length === 0 ? (
                  <p className="text-[12px] text-ink-3">No operations yet.</p>
                ) : (
                  conversation.messages.slice(-8).map((m) => (
                    <div key={m.id} className="rounded-control border border-line bg-surface px-2.5 py-2">
                      <p className="text-[11px] font-medium text-ink-3">{m.role === 'user' ? 'You' : 'Assistant'} · {new Date(m.createdAt).toLocaleTimeString()}</p>
                      <p className="mt-0.5 line-clamp-2 text-[12px] leading-[1.5] text-ink-2">
                        {m.parts
                          .filter((p) => p.kind === 'text')
                          .map((p) => (p as { text: string }).text)
                          .join(' ')
                          .slice(0, 120) || '(no text)'}
                      </p>
                    </div>
                  ))
                )}
              </div>
            </Section>

            <Section title="Bookmarks">
              <p className="text-[12px] text-ink-3">Star messages to bookmark them. (Local only)</p>
            </Section>
          </div>
        </aside>
      </div>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-5">
      <h3 className="mb-2 text-[10.5px] font-medium uppercase tracking-[0.06em] text-ink-3">{title}</h3>
      {children}
    </section>
  )
}
function MetaRow({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="flex items-center justify-between gap-2 py-1">
      <span className="text-[11.5px] text-ink-3">{label}</span>
      <span className={cn('max-w-[170px] truncate text-right text-[11.5px] text-ink', mono && 'font-mono')}>{value}</span>
    </div>
  )
}
function TimelineWithAnchors({ conversation, onRespond }: { conversation: ReturnType<typeof getConversation>; onRespond: (id: string, decision: string) => void }) {
  return <Timeline conversation={conversation} onRespond={onRespond} />
}
function BackIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <path d="M15 18l-6-6 6-6" />
    </svg>
  )
}
function PanelLeftIcon({ collapsed }: { collapsed: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d={collapsed ? 'M9 3v18' : 'M9 3v18M9 8l-2 2 2 2'} />
    </svg>
  )
}
function PanelRightIcon({ collapsed }: { collapsed: boolean }) {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="18" height="18" rx="2" />
      <path d={collapsed ? 'M15 3v18' : 'M15 3v18M15 8l2 2-2 2'} />
    </svg>
  )
}
