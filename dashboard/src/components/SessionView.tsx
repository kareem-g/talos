/**
 * SessionView — the most important screen, shared by mobile and desktop.
 *
 * There is exactly one of these. The shells decide layout and navigation; the
 * logic lives here once. The old code duplicated it between `MobileApp` (1234
 * lines) and a desktop hook, with seven pieces of derivation maintained in
 * parallel and already drifting.
 *
 * Mobile vs desktop share the same body (Timeline + StateZone); the mobile
 * header adds PanelLeft/PanelRight buttons that open the same Sessions list
 * and Agent Workspace right rail the desktop session uses, just surfaced as
 * side sheets. So the "right pane" looks and behaves the same on both shapes.
 */

import { useEffect, useMemo, useRef, useState } from 'react'
import { StateZone, SessionControls } from './StateZone'
import { Timeline } from './Timeline'
import { PanelLeft, PanelRight, List, SlidersHorizontal, Settings2 } from 'lucide-react'
import { Dot, IconButton, Layer, Notice, StatusPill, ChevronLeft } from './ui'
import { LeftSidebar } from './desktop/LeftSidebar'
import { RightRail, type RightRailHandle } from './desktop/session/RightRail'
import { useConversation, useStore } from '@/store'
import { sessionUIState, uiStateDisplay } from '@/lib/sessionState'
import { agentDisplayFor } from '@/lib/remote'
import { openFile } from '@/lib/fileViewer'
import type { Session } from '@/types/session'
import { useRoute } from '@/lib/route'
import { useRooms } from '@/lib/rooms'
import { createSessionSendHandlers } from '@/lib/sessionCommands'

export function SessionView({
  session,
  onBack,
}: {
  session: Session
  /** Present on mobile, where a session occupies the whole screen. */
  onBack?: () => void
}) {
  const conversation = useConversation(session.id)
  const config = useStore((state) => state.configs[session.id])
  const notice = useStore((state) => state.notices[session.id])
  const connection = useStore((state) => state.connection)
  const providers = useStore((state) => state.providers)

  const openSession = useStore((state) => state.openSession)
  const setConfig = useStore((state) => state.setConfig)
  const respondToApproval = useStore((state) => state.respondToApproval)
  const dismissNotice = useStore((state) => state.dismissNotice)
  // Which side panel is open, if any. The pane button in the header opens
  // a small popover to choose between them; tapping a destination sets the
  // state and the Layer renders.
  const [pane, setPane] = useState<'sessions' | 'details' | 'controls' | null>(null)
  const timelineDetail = useStore((s) => s.timelineDetail)
  const setTimelineDetail = useStore((s) => s.setTimelineDetail)
  // Lets the explorer/left sheet open a file in the right rail's File tab.
  const rightRailRef = useRef<RightRailHandle>(null)
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
   * The terminal view is always available on desktop. On mobile we lock the
   * body to chat only — the chat/terminal Segmented toggle was removed from
   * the mobile header to free header space, and the desktop `SessionWorkspace`
   * keeps the toggle for users on a real desktop terminal.
   */

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

  /* ── Command dispatch — same shared handlers as the desktop workspace ─────
     /orchestrator, #RoomName, @worker, /side and /btw behave identically
     here. A dispatch that opens another session (a room channel or the side
     thread) navigates to it — the mobile analog of the desktop's rails. */
  const rooms = useRooms()
  const roomOfSession = rooms.find((room) => room.sessionId === session.id) ?? null
  const dispatch = createSessionSendHandlers(session, {
    openSessionView: (id) => {
      if (id !== session.id) navigate({ name: 'session', sessionId: id })
    },
    revealSideSession: (sideId) => {
      if (sideId && sideId !== session.id) navigate({ name: 'session', sessionId: sideId })
    },
  })

  const connectionTone =
    connection === 'connected' ? 'green' : connection === 'connecting' || connection === 'reconnecting' ? 'orange' : 'red'
  const connectionPulse = connection === 'connecting' || connection === 'reconnecting'
  const showConnectionInline = connection !== 'connected'

  return (
    <div className="flex h-full min-h-0 flex-1 flex-col bg-canvas">
      {/* ── Compact remote-control header ─────────────────────────────── */}
      <header
        className="flex shrink-0 flex-col gap-1 border-b border-line/60 bg-canvas px-2.5 py-2"
        style={onBack ? { paddingTop: 'max(0.5rem, env(safe-area-inset-top))' } : undefined}
      >
        {/* Row 1: navigation + title + actions + segmented */}
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

          {/* Pane openers (mobile only): PanelLeft opens the sessions
              sheet, PanelRight opens the same Agent Workspace right rail
              the desktop session uses, anchored to the right edge. Two
              dedicated icons replace the single popover the mobile
              header used to have. */}
          {onBack ? (
            <>
              {/* Model / thinking / permissions live in the composer on a wide
                  screen; on a phone they move up here so the composer stays one
                  line and the keyboard keeps its room. */}
              <IconButton
                label="Model and permissions"
                onClick={() => setPane((current) => (current === 'controls' ? null : 'controls'))}
                aria-expanded={pane === 'controls'}
                aria-haspopup="dialog"
                className="shrink-0"
              >
                <Settings2 size={15} />
              </IconButton>
              <IconButton
                label="Sessions"
                onClick={() => setPane((current) => (current === 'sessions' ? null : 'sessions'))}
                aria-expanded={pane === 'sessions'}
                aria-haspopup="dialog"
                className="shrink-0"
              >
                <PanelLeft size={15} />
              </IconButton>
              <IconButton
                label="Workspace"
                onClick={() => setPane((current) => (current === 'details' ? null : 'details'))}
                aria-expanded={pane === 'details'}
                aria-haspopup="dialog"
                className="shrink-0"
              >
                <PanelRight size={15} />
              </IconButton>
              <IconButton
                label={timelineDetail === 'simple' ? 'Show technical detail' : 'Simplify the timeline'}
                aria-pressed={timelineDetail === 'detailed'}
                onClick={() => setTimelineDetail(timelineDetail === 'simple' ? 'detailed' : 'simple')}
                className="-mr-1 shrink-0"
              >
                {timelineDetail === 'simple' ? <List size={15} /> : <SlidersHorizontal size={15} />}
              </IconButton>
            </>
          ) : null}
        </div>

        {/* Row 2 (mobile detail overflow): show file detail full width on narrow */}
        {agentDisplay.detail ? (
          <div className="truncate font-mono text-[11px] leading-none text-ink-3 sm:hidden">{agentDisplay.detail}</div>
        ) : null}
      </header>

      {notice ? <Notice message={notice} onDismiss={() => dismissNotice(session.id)} /> : null}

      <Timeline
        conversation={conversation}
        onRespond={(requestId, decision, meta) => respondToApproval(session.id, requestId, decision, meta)}
        project={session.project ?? undefined}
        sessionId={session.id}
      />
      <StateZone
        session={session}
        conversation={conversation}
        connection={connection}
        config={config}
        provider={provider}
        onSend={(t, attachments) => dispatch.send(t, attachments)}
        onQueue={(t, attachments) => dispatch.queue(t, attachments)}
        onSetConfig={(id, v) => void setConfig(session.id, id, v)}
        rooms={rooms.map((r) => r.name)}
        workers={roomOfSession?.workers.map((w) => w.name)}
        compact={Boolean(onBack)}
        hideInlineControls={Boolean(onBack)}
      />

      {/* Left sheet — the desktop session navigator reused for mobile:
          workspace-scoped Sessions, Rooms channels, and the file Explorer.
          Opening a session/room navigates here; opening a file previews it
          in the right rail's File tab, just like on the desktop. */}
      <Layer
        open={pane === 'sessions'}
        onClose={() => setPane(null)}
        title="Sessions"
        size="md"
        side="left"
        footer={
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setPane('details')}
              className="flex h-8 flex-1 items-center justify-center gap-1.5 rounded-lg border border-line/60 bg-surface px-2.5 text-[12px] font-medium text-ink-2 transition-colors hover:bg-hover-2"
            >
              <PanelRight size={12} /> Workspace
            </button>
          </div>
        }
      >
        <div className="-m-1.5 flex h-full min-h-0 flex-col">
          <LeftSidebar
            session={session}
            fill
            onSelect={(id) => {
              setPane(null)
              if (id !== session.id) navigate({ name: 'session', sessionId: id })
            }}
            onOpenFile={(project, path) => {
              openFile(project, path)
              // Close the navigator and open the file in the right rail.
              setPane('details')
              window.setTimeout(() => rightRailRef.current?.openTab('files'), 0)
            }}
          />
        </div>
      </Layer>

      {/* Controls sheet — the model / thinking / permission controls that the
          composer renders inline on a wide screen. Same component, so the two
          placements cannot drift. */}
      <Layer
        open={pane === 'controls'}
        onClose={() => setPane(null)}
        title="Model & permissions"
        size="md"
        side="right"
      >
        <div className="flex flex-wrap items-center gap-2 p-1">
          <SessionControls
            session={session}
            config={config}
            onSetConfig={(id, value) => void setConfig(session.id, id, value)}
          />
        </div>
      </Layer>

      {/* Right rail — the same browser-style Agent Workspace the desktop
          session uses, surfaced as a right-anchored sheet on mobile. Tapping
          the PanelRight header button opens it; tapping the dim or pressing
          Escape closes it. Sub-sessions inside the rail navigate the
          underlying route, just like they would in the desktop workspace. */}
      <Layer
        open={pane === 'details'}
        onClose={() => setPane(null)}
        title="Workspace"
        size="lg"
        side="right"
      >
        {/* The Layer body has 6px padding; cancel it so the rail's tab strip
            and content fill the sheet edge-to-edge like on the desktop. */}
        <div className="-m-1.5 flex h-full min-h-0 flex-col">
          <RightRail
            ref={rightRailRef}
            session={session}
            fill
            onOpenSession={(id) => {
              setPane(null)
              navigate({ name: 'session', sessionId: id })
            }}
            notify={(message, tone) => {
              if (tone === 'error') {
                useStore.setState((state) => ({ notices: { ...state.notices, [session.id]: message } }))
              }
            }}
          />
        </div>
      </Layer>

    </div>
  )
}
