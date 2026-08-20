/**
 * SessionView — the most important screen, shared by mobile and desktop.
 *
 * There is exactly one of these. The shells decide layout and navigation; the
 * logic lives here once. The old code duplicated it between `MobileApp` (1234
 * lines) and a desktop hook, with seven pieces of derivation maintained in
 * parallel and already drifting.
 */

import { useEffect, useMemo, useState } from 'react'
import { Composer } from './Composer'
import { ConfigBar } from './ConfigControls'
import { statusLabel, StatusDot } from './SessionList'
import { TerminalView } from './TerminalView'
import { Timeline } from './Timeline'
import {
  Button,
  ChevronLeft,
  IconButton,
  MessageIcon,
  Notice,
  Segmented,
  Terminal as TerminalIcon,
} from './ui'
import { getConversation, useConversation, useStore } from '@/store'
import { socket } from '@/lib/socket'
import { basename } from '@/lib/format'
import { isActive, type Session } from '@/types/session'

type Tab = 'chat' | 'terminal'

/** Play glyph for the resume action. */
function PlayIcon({ size = 12 }: { size?: number }) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" aria-hidden>
      <path d="M8 5.5v13l11-6.5z" />
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

  const openSession = useStore((state) => state.openSession)
  const sendPrompt = useStore((state) => state.sendPrompt)
  const stopSession = useStore((state) => state.stopSession)
  const resumeSession = useStore((state) => state.resumeSession)
  const setConfig = useStore((state) => state.setConfig)
  const respondToApproval = useStore((state) => state.respondToApproval)
  const dismissNotice = useStore((state) => state.dismissNotice)
  const [resuming, setResuming] = useState(false)

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

  async function resume() {
    setResuming(true)
    try {
      await resumeSession(session.id)
    } finally {
      setResuming(false)
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-canvas">
      <header
        className="flex shrink-0 items-center gap-2 border-b border-line px-2.5 py-2"
        style={onBack ? { paddingTop: 'max(0.5rem, env(safe-area-inset-top))' } : undefined}
      >
        {onBack ? (
          <IconButton label="Back to sessions" onClick={onBack} className="-ml-1">
            <ChevronLeft />
          </IconButton>
        ) : null}

        <div className="min-w-0 flex-1">
          <p className="truncate text-[13px] font-medium text-ink">{session.name}</p>
          <p className="mt-0.5 flex min-w-0 items-center gap-1.5 text-[11.5px] text-ink-3">
            <StatusDot status={session.status} />
            <span className={working ? 'text-green' : undefined}>
              {statusLabel(session.status)}
            </span>
            <span aria-hidden>·</span>
            <span className="truncate">{provider?.name ?? session.agent}</span>
            {session.project ? (
              <>
                <span aria-hidden>·</span>
                <span className="truncate font-mono">{basename(session.project)}</span>
              </>
            ) : null}
          </p>
        </div>

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

        <Segmented
          value={tab}
          onChange={setTab}
          options={[
            { value: 'chat', label: 'Chat', icon: <MessageIcon size={12} /> },
            { value: 'terminal', label: 'Terminal', icon: <TerminalIcon size={12} /> },
          ]}
        />
      </header>

      {notice ? (
        <Notice message={notice} onDismiss={() => dismissNotice(session.id)} />
      ) : null}

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
              working={working}
              disabled={connection !== 'connected'}
              placeholder={
                connection !== 'connected' ? 'Waiting for connection…' : 'Message the agent…'
              }
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
          onInput={(data) => socket.sendTerminalInput(session.id, data)}
          onResize={(cols, rows) => socket.resizeTerminal(session.id, cols, rows)}
        />
      )}
    </div>
  )
}
