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
import { SessionPanels } from './SessionPanels'
import { StateZone } from './StateZone'
import { TerminalView } from './TerminalView'
import { Timeline } from './Timeline'
import {
  ChevronLeft,
  Dot,
  IconButton,
  Layer,
  MessageIcon,
  Notice,
  Segmented,
  StatusPill,
  Terminal as TerminalIcon,
} from './ui'
import { useConversation, useStore } from '@/store'
import { socket } from '@/lib/socket'
import { sessionUIState, uiStateDisplay } from '@/lib/sessionState'
import { agentStateDisplay } from '@/types/remote'
import { agentDisplayFor } from '@/lib/remote'
import type { Session } from '@/types/session'
import { useRoute } from '@/lib/route'
import { cn } from '@/lib/format'

type Tab = 'chat' | 'terminal'

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
  const setConfig = useStore((state) => state.setConfig)
  const respondToApproval = useStore((state) => state.respondToApproval)
  const dismissNotice = useStore((state) => state.dismissNotice)
  const [switcherOpen, setSwitcherOpen] = useState(false)
  const [panelsOpen, setPanelsOpen] = useState(false)
  const { navigate } = useRoute()

  // Hydrate on every session switch. The store now clears and
  // replays history in chronological order, so a second open fixes
  // the "all user bubbles first" layout and ensures the sidebar
  // selection always loads fresh transcript.
  useEffect(() => {
    void openSession(session.id)
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

  const uiState = sessionUIState(session, conversation, connection)
  const stateDisplay = uiStateDisplay(uiState)
  // Keep the live detail (file being edited etc.) that `deriveAgentState`
  // refines; merge it with the single StatusPill rather than a second dot.
  // `conversation` is a stable object mutated in place, so the activity
  // reference is the real signal; the lint rule cannot see that.
  const activity = conversation.activity
  const agentDisplay = useMemo(
    () => agentDisplayFor(session, conversation, connection),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [session, activity, connection],
  )

  const modelOption = useMemo(
    () => config?.options.find((o) => o.id === 'model' || o.category === 'model'),
    [config],
  )

  const connectionTone =
    connection === 'connected' ? 'green' : connection === 'connecting' || connection === 'reconnecting' ? 'orange' : 'red'
  const connectionPulse = connection === 'connecting' || connection === 'reconnecting'
  const showConnectionInline = connection !== 'connected'

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-canvas">
      {/* ── Compact remote-control header ─────────────────────────────────── */}
      <header
        className="flex shrink-0 flex-col gap-1 border-b border-line/60 bg-canvas px-2.5 py-2"
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
            {/* Single status pill: the one source of truth for this screen. */}
            <div className="flex min-w-0 items-center gap-1.5 text-[11px] leading-none text-ink-3">
              <StatusPill label={stateDisplay.label} tone={stateDisplay.tone} pulse={stateDisplay.pulse} detail={agentDisplay.detail} />
              {session.project ? (
                <>
                  <span aria-hidden className="shrink-0 text-ink-3/60">·</span>
                  <span className="hidden truncate font-mono sm:inline">{session.project.split('/').pop() ?? session.project}</span>
                </>
              ) : null}
              {showConnectionInline ? (
                <>
                  <span aria-hidden className="shrink-0 text-ink-3/60">·</span>
                  <span className="inline-flex items-center gap-1 shrink-0">
                    <Dot tone={connectionTone as 'green' | 'orange' | 'red'} pulse={connectionPulse} />
                    <span className="text-[11px] capitalize">{connection}</span>
                  </span>
                </>
              ) : null}
            </div>
          </div>

          <IconButton label="Session details" onClick={() => setPanelsOpen(true)} className="-mr-1 shrink-0">
            <svg viewBox="0 0 24 24" width={15} height={15} fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <rect x="3" y="3" width="18" height="18" rx="3" />
              <path d="M7 8h10M7 12h6M7 16h4" />
            </svg>
          </IconButton>

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
          <StateZone
            session={session}
            conversation={conversation}
            connection={connection}
            config={config}
            provider={provider}
            onSend={(t) => sendPrompt(session.id, t)}
            onSetConfig={(id, v) => void setConfig(session.id, id, v)}
          />
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

      {/* Details / git changes / worktrees — right-panel parity on mobile */}
      <Layer open={panelsOpen} onClose={() => setPanelsOpen(false)} title="Session details" size="md">
        <SessionPanels
          sessionId={session.id}
          facts={{
            createdAt: session.created_at,
            updatedAt: session.updated_at,
            project: session.project,
            branch: session.branch,
            agentName: provider?.name ?? session.agent,
            statusLabel: stateDisplay.label,
            modelValue: modelOption?.currentValue ?? undefined,
            worktreePath: (session as { worktree_path?: string | null }).worktree_path ?? null,
          }}
        />
      </Layer>

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
