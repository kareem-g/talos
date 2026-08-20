/**
 * SessionView — the most important screen, shared by mobile and desktop.
 *
 * There is exactly one of these. The shells decide layout and navigation; the
 * logic lives here once. The old code duplicated it between `MobileApp` (1234
 * lines) and a desktop hook, with seven pieces of derivation maintained in
 * parallel and already drifting.
 *
 * Zcode-style header: compact two-line top nav showing
 *   - connection status (dot + reconnecting/offline)
 *   - session + project breadcrumb
 *   - current model chip (taps to ConfigLayer)
 *   - derived agent state with detail (Working / Editing src/... )
 */

import { useEffect, useMemo, useState } from 'react'
import { Composer } from './Composer'
import { ConfigBar, ConfigControl } from './ConfigControls'
import { TerminalView } from './TerminalView'
import { Timeline } from './Timeline'
import {
  Button,
  ChevronLeft,
  Dot,
  IconButton,
  Layer,
  MessageIcon,
  Notice,
  Segmented,
  Terminal as TerminalIcon,
} from './ui'
import { getConversation, useConversation, useStore } from '@/store'
import { socket } from '@/lib/socket'
import { agentDisplayFor, modelChipLabel } from '@/lib/remote'
import { agentStateDisplay } from '@/types/remote'
import { isActive, type Session } from '@/types/session'
import { useRoute } from '@/lib/route'
import { cn } from '@/lib/format'

type Tab = 'chat' | 'terminal'

/** Play glyph for the resume action. */
function PlayIcon({ size = 12 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden>
      <path d="M8 5.5v13l11-6.5z" />
    </svg>
  )
}

function LayersIcon({ size = 14 }: { size?: number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden
    >
      <path d="M12 2L2 7l10 5 10-5-10-5z" />
      <path d="M2 17l10 5 10-5" />
      <path d="M2 12l10 5 10-5" />
    </svg>
  )
}

export function SessionView({
  session,
  onBack,
}: {
  session: Session
  /** Present on mobile, where a session occupies the whole screen. */
  onBack?: () => void
}) {
  const [tab, setTab] = useState<Tab>('chat')
  const conversation = useConversation(session.id)
  const config = useStore((state) => state.configs[session.id])
  const notice = useStore((state) => state.notices[session.id])
  const connection = useStore((state) => state.connection)
  const providers = useStore((state) => state.providers)
  const sessions = useStore((state) => state.sessions)

  const openSession = useStore((state) => state.openSession)
  const sendPrompt = useStore((state) => state.sendPrompt)
  const stopSession = useStore((state) => state.stopSession)
  const resumeSession = useStore((state) => state.resumeSession)
  const setConfig = useStore((state) => state.setConfig)
  const respondToApproval = useStore((state) => state.respondToApproval)
  const dismissNotice = useStore((state) => state.dismissNotice)
  const [resuming, setResuming] = useState(false)
  const [switcherOpen, setSwitcherOpen] = useState(false)
  const { navigate } = useRoute()

  // Hydrate once per session. History replays through the same reducer as live
  // events, so reopening cannot produce a different conversation than watching.
  useEffect(() => {
    if (getConversation(session.id).messages.length === 0) {
      void openSession(session.id)
    }
  }, [session.id, openSession])

  const provider = useMemo(
    () => providers.find((candidate) => candidate.id === session.agent),
    [providers, session.agent],
  )

  /**
   * The terminal view is always available.
   *
   * Every session's raw output is recorded by the backend, so there is always
   * something to show — and hiding the tab for ACP providers meant no way to see
   * what an agent actually emitted. What varies is whether the terminal accepts
   * *input*, which the session reports via `interactiveTerminal` (a PTY does; ACP
   * over piped stdio does not).
   */
  const interactiveTerminal = config?.interactiveTerminal === true
  const working = isActive(session.status)

  /**
   * Whether this session can be restarted.
   *
   * A session with no live agent: `needs_resume` (the common case for imported
   * sessions) or `exited`. NOT `idle` — an idle session has a live agent waiting
   * for a prompt and should show the composer so the user can type, not a Resume
   * banner asking them to start something that is already started.
   */
  const resumable = session.status === 'needs_resume' || session.status === 'exited'

  const agentDisplay = useMemo(
    () => agentDisplayFor(session, conversation, connection),
    [session, conversation.activity, connection],
  )

  const modelOption = useMemo(
    () => config?.options.find((o) => o.id === 'model' || o.category === 'model'),
    [config],
  )
  const modelLabel = useMemo(
    () => modelChipLabel(provider, modelOption?.currentValue),
    [provider, modelOption?.currentValue],
  )

  async function resume() {
    setResuming(true)
    try {
      await resumeSession(session.id)
    } finally {
      setResuming(false)
    }
  }

  const connectionTone =
    connection === 'connected' ? 'green' : connection === 'connecting' || connection === 'reconnecting' ? 'orange' : 'red'
  const connectionPulse = connection === 'connecting' || connection === 'reconnecting'
  const showConnectionInline = connection !== 'connected'

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-canvas">
      {/* ── Compact remote-control header ─────────────────────────────────── */}
      <header
        className="flex shrink-0 flex-col gap-1 border-b border-line bg-canvas px-2.5 py-2"
        style={onBack ? { paddingTop: 'max(0.5rem, env(safe-area-inset-top))' } : undefined}
      >
        {/* Row 1: navigation + title + model + actions */}
        <div className="flex min-w-0 items-center gap-2">
          {onBack ? (
            <IconButton label="Back to sessions" onClick={onBack} className="-ml-1 shrink-0">
              <ChevronLeft />
            </IconButton>
          ) : null}

          <div className="min-w-0 flex-1">
            <p className="truncate text-[13px] font-medium leading-tight tracking-[-0.01em] text-ink">
              {session.name}
            </p>
            {/* Subtitle: agent state + detail + project */}
            <div className="flex min-w-0 items-center gap-1.5 text-[11px] leading-none text-ink-3">
              <span className="inline-flex items-center gap-1 truncate">
                <Dot tone={agentDisplay.tone} pulse={agentDisplay.pulse} />
                <span className={agentDisplay.tone === 'green' ? 'text-green' : agentDisplay.tone === 'orange' ? 'text-orange' : undefined}>
                  {agentDisplay.label}
                </span>
                {agentDisplay.detail ? (
                  <span className="hidden truncate font-mono text-ink-3 sm:inline">{agentDisplay.detail}</span>
                ) : null}
              </span>
              {session.project ? (
                <>
                  <span aria-hidden className="shrink-0 text-ink-3/60">
                    ·
                  </span>
                  <span className="hidden truncate font-mono sm:inline">
                    {session.project.split('/').pop() ?? session.project}
                  </span>
                </>
              ) : null}
              {showConnectionInline ? (
                <>
                  <span aria-hidden className="shrink-0 text-ink-3/60">
                    ·
                  </span>
                  <span className="inline-flex items-center gap-1 shrink-0">
                    <Dot tone={connectionTone as 'green' | 'orange' | 'red'} pulse={connectionPulse} />
                    <span className="text-[11px] capitalize">{connection}</span>
                  </span>
                </>
              ) : null}
            </div>
          </div>

          {/* Model chip — compact, provider-agnostic, taps to picker */}
          {modelOption ? (
            <div className="shrink-0">
              <ConfigControl
                option={modelOption}
                source={provider?.modelsSource}
                onChange={(value) => void setConfig(session.id, modelOption.id, value)}
                disabled={connection !== 'connected'}
              />
            </div>
          ) : modelLabel ? (
            <span className="hidden max-w-32 truncate rounded-chip bg-surface px-2 py-1 text-[11px] font-medium text-ink-2 shadow-btn sm:inline-flex">
              {modelLabel}
            </span>
          ) : null}

          {resumable ? (
            <Button
              variant="primary"
              onClick={() => void resume()}
              disabled={resuming || connection !== 'connected'}
              className="shrink-0"
            >
              <PlayIcon />
              {resuming ? 'Resuming…' : 'Resume'}
            </Button>
          ) : null}

          {/* Session switcher (mobile) */}
          {onBack ? (
            <IconButton label="Switch session" onClick={() => setSwitcherOpen(true)} className="-mr-1 shrink-0">
              <LayersIcon />
            </IconButton>
          ) : null}

          <Segmented
            value={tab}
            onChange={setTab}
            options={[
              { value: 'chat', label: 'Chat', icon: <MessageIcon size={12} /> },
              { value: 'terminal', label: 'Terminal', icon: <TerminalIcon size={12} /> },
            ]}
          />
        </div>

        {/* Row 2 (mobile detail overflow): show file detail full width on narrow */}
        {agentDisplay.detail ? (
          <div className="truncate font-mono text-[11px] leading-none text-ink-3 sm:hidden">{agentDisplay.detail}</div>
        ) : null}
      </header>

      {notice ? <Notice message={notice} onDismiss={() => dismissNotice(session.id)} /> : null}

      {tab === 'chat' ? (
        <>
          <Timeline
            conversation={conversation}
            onRespond={(requestId, decision) => respondToApproval(session.id, requestId, decision)}
          />

          {/*
             A stopped session has no agent to receive a prompt, so the composer
             would silently swallow one. Offer the action that actually works
             instead of an input that appears to work.
           */}
          {resumable ? (
            <div
              className="shrink-0 px-3 pb-3 pt-1.5"
              style={{ paddingBottom: 'max(0.75rem, env(safe-area-inset-bottom))' }}
            >
              <div className="mx-auto flex w-full max-w-[46rem] items-center gap-3 rounded-[18px] border border-line bg-surface px-3.5 py-3 shadow-raised">
                <p className="min-w-0 flex-1 text-[12px] leading-[1.6] text-ink-2">
                  {session.source && session.source !== 'agentdeck'
                    ? `This session was imported from ${provider?.name ?? session.agent}. Resume it to continue the conversation.`
                    : 'The agent has stopped. Resume it to continue this conversation.'}
                </p>
                <Button
                  variant="primary"
                  onClick={() => void resume()}
                  disabled={resuming || connection !== 'connected'}
                  className="shrink-0"
                >
                  <PlayIcon />
                  {resuming ? 'Resuming…' : 'Resume'}
                </Button>
              </div>
            </div>
          ) : (
            <Composer
              onSend={(text) => sendPrompt(session.id, text)}
              onStop={() => void stopSession(session.id)}
              onInterrupt={() => socket.interruptSession(session.id)}
              working={working}
              disabled={connection !== 'connected'}
              placeholder={connection !== 'connected' ? 'Waiting for connection…' : 'Message the agent…'}
              controls={
                config ? (
                  <ConfigBar
                    options={config.options}
                    live={config.live}
                    modelsSource={provider?.modelsSource}
                    onChange={(configId, value) => void setConfig(session.id, configId, value)}
                  />
                ) : null
              }
            />
          )}
        </>
      ) : (
        <TerminalView
          output={conversation.terminal}
          interactive={interactiveTerminal}
          transport={config?.transport}
          connectionState={connection}
          onInput={(data) => socket.sendTerminalInput(session.id, data)}
          onResize={(cols, rows) => socket.resizeTerminal(session.id, cols, rows)}
        />
      )}

      {/* Session switcher bottom sheet (mobile) */}
      {onBack ? (
        <Layer open={switcherOpen} onClose={() => setSwitcherOpen(false)} title="Switch session" size="md">
          <div className="flex flex-col gap-1">
            <div className="px-1 pb-2 text-[11px] text-ink-3">
              {sessions.length} sessions · {sessions.filter((s) => s.status === 'running' || s.status === 'starting').length} active
            </div>
            {sessions.map((s) => {
              const disp = agentStateDisplay(
                agentDisplayFor(s, undefined, connection).state,
              )
              return (
                <button
                  key={s.id}
                  type="button"
                  onClick={() => {
                    setSwitcherOpen(false)
                    navigate({ name: 'session', sessionId: s.id })
                  }}
                  className={cn(
                    'flex w-full items-center gap-2.5 rounded-control px-2.5 py-2.5 text-left transition-colors',
                    s.id === session.id ? 'bg-accent-tint' : 'hover:bg-hover-2',
                  )}
                >
                  <Dot tone={disp.tone} pulse={disp.pulse} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[12.5px] font-medium text-ink">{s.name}</span>
                    <span className="block truncate text-[11px] text-ink-3">
                      {disp.label} · {s.agent} {s.project ? `· ${s.project.split('/').pop()}` : ''}
                    </span>
                  </span>
                  {s.id === session.id ? <span className="text-[11px] font-medium text-accent-ink">Active</span> : null}
                </button>
              )
            })}
          </div>
        </Layer>
      ) : null}
    </div>
  )
}
