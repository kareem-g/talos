/**
 * LeftPaneSheet — the desktop LeftSidebar, as the session's left sheet.
 *
 * ONE-TO-ONE WITH THE DESKTOP PANE
 * --------------------------------
 * The desktop SessionView's PanelLeft button opens a left-anchored Layer
 * holding, in order: the workspace's Rooms (channels first — the team above
 * the threads), the Sessions list with "needs you" pinned above recency, and
 * the Explorer file tree. This is that pane: same order, same data sources
 * (rooms API, shared session-state ranking, the rail's lazy FilesTab), same
 * footer ("Workspace" jumps to the right rail, exactly like the desktop's
 * sheet footer).
 */

import * as React from 'react'
import {Pressable, View} from 'react-native'
import { Text } from '@app/components/Text'
import { PanelRight, Waypoints } from 'lucide-react-native'

import { relativeTime } from '@/lib/format'
import { isInternalSession, sessionUIState, uiStateDisplay } from '@/lib/sessionState'
import type { Session } from '@/types/session'
import { roomsApi } from '@app/lib/api'
import { getConversation, useStore } from '@app/store'
import { palette } from '@app/design/tokens'
import { SideSheet } from '@app/components/Sheet'
import { FilesTab } from '@app/components/panel/Tabs'
import { Dot, EmptyState, Eyebrow, Mono, haptic } from '@app/components/ui'
import { stateTone } from '@app/components/session/SessionRow'

export function LeftPaneSheet({
  open,
  onClose,
  session,
  onSelectSession,
  onOpenWorkspace,
}: {
  open: boolean
  onClose: () => void
  session: Session
  onSelectSession: (sessionId: string) => void
  /** The desktop footer's move: close this pane, open the workspace rail. */
  onOpenWorkspace: () => void
}) {
  const sessions = useStore((state) => state.sessions)
  const connection = useStore((state) => state.connection)
  const revisions = useStore((state) => state.revisions)

  const [rooms, setRooms] = React.useState<Array<{ id: string; name: string; session_id?: string; workers?: unknown[] }> | null>(null)

  React.useEffect(() => {
    if (!open) return
    roomsApi
      .list()
      .then((result) => setRooms(result ?? []))
      .catch(() => setRooms([]))
  }, [open])

  const { attention, workspace } = React.useMemo(() => {
    const visible = sessions.filter((candidate) => !isInternalSession(candidate) && candidate.status !== 'archived')
    const withState = visible.map((candidate) => ({
      session: candidate,
      state: sessionUIState(candidate, getConversation(candidate.id), connection),
    }))
    const needs = withState
      .filter(({ state }) => state === 'approval' || state === 'input' || state === 'failed' || state === 'paused')
      .sort((a, b) => b.session.updated_at.localeCompare(a.session.updated_at))
    const here = withState
      .filter(
        ({ session: candidate, state }) =>
          candidate.project === session.project &&
          candidate.id !== session.id &&
          state !== 'approval' &&
          state !== 'input' &&
          state !== 'failed' &&
          state !== 'paused',
      )
      .sort((a, b) => b.session.updated_at.localeCompare(a.session.updated_at))
      .slice(0, 20)
    return { attention: needs, workspace: here }
    // `revisions` re-ranks as conversations stream.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions, connection, session.id, session.project, revisions])

  return (
    <SideSheet
      open={open}
      onClose={onClose}
      title="Sessions"
      side="left"
      footer={
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open the workspace"
          onPress={() => {
            void haptic('light')
            onOpenWorkspace()
          }}
          className="h-9 flex-row items-center justify-center gap-1.5 rounded-md border border-line bg-surface active:bg-raised"
        >
          <PanelRight size={13} color={palette.ink2} />
          <Text className="text-[12px] font-medium text-ink-2">Workspace</Text>
        </Pressable>
      }
    >
      {/* ── Rooms — channels first, the team above the threads ─────── */}
      <View className="gap-1.5">
        <Eyebrow>Rooms</Eyebrow>
        {rooms === null ? (
          <Text className="px-2.5 py-1 text-[11.5px] text-ink-3">Loading rooms…</Text>
        ) : rooms.length === 0 ? (
          <Text className="px-2.5 py-1 text-[11.5px] leading-[16px] text-ink-3">
            No rooms. Send /orchestrator inside a session to fan a task out.
          </Text>
        ) : (
          rooms.map((room) => {
            const workers = Array.isArray(room.workers) ? room.workers.length : 0
            return (
              <Pressable
                key={room.id}
                accessibilityRole="button"
                accessibilityLabel={room.name}
                accessibilityHint={room.session_id ? 'Opens the room channel' : 'This room has no channel session yet'}
                onPress={() => {
                  if (!room.session_id) return
                  void haptic('light')
                  onSelectSession(room.session_id)
                }}
                className="min-h-10 flex-row items-center gap-2.5 rounded-md px-2.5 py-1.5 active:bg-raised"
                style={{ opacity: room.session_id ? 1 : 0.55 }}
              >
                <Waypoints size={14} color={palette.ink3} />
                <Text className="min-w-0 flex-1 text-[12.5px] text-ink-2" numberOfLines={1}>
                  {room.name}
                </Text>
                {workers > 0 ? (
                  <Mono className="text-[9.5px] text-ink-4">{workers}w</Mono>
                ) : null}
              </Pressable>
            )
          })
        )}
      </View>

      {/* ── Needs you — pinned above everything, the desktop's rule ── */}
      {attention.length > 0 ? (
        <View className="gap-1.5">
          <Eyebrow>Needs you · {attention.length}</Eyebrow>
          {attention.map(({ session: row, state }) => (
            <PaneSessionRow
              key={row.id}
              session={row}
              state={state}
              active={row.id === session.id}
              onPress={() => {
                void haptic('light')
                onSelectSession(row.id)
              }}
            />
          ))}
        </View>
      ) : null}

      {/* ── This workspace ─────────────────────────────────────────── */}
      <View className="gap-1.5">
        <Eyebrow>
          {session.project ? session.project.split('/').filter(Boolean).pop() : 'Inbox'} · {workspace.length}
        </Eyebrow>
        {workspace.length === 0 ? (
          <Text className="px-2.5 py-1 text-[11.5px] leading-[16px] text-ink-3">
            No other sessions in this workspace.
          </Text>
        ) : (
          workspace.map(({ session: row, state }) => (
            <PaneSessionRow
              key={row.id}
              session={row}
              state={state}
              active={row.id === session.id}
              onPress={() => {
                void haptic('light')
                onSelectSession(row.id)
              }}
            />
          ))
        )}
      </View>

      {/* ── Explorer — the rail's lazy file tree, same component ───── */}
      <View className="gap-1.5">
        <Eyebrow>Explorer</Eyebrow>
        {session.project ? (
          <View className="overflow-hidden rounded-lg border border-line bg-surface p-2">
            <FilesTab session={session} />
          </View>
        ) : (
          <EmptyState compact title="No workspace" body="This session has no folder to explore." />
        )}
      </View>
    </SideSheet>
  )
}

/** One session row in the pane: dot + name + state word + age. */
function PaneSessionRow({
  session,
  state,
  active,
  onPress,
}: {
  session: Session
  state: string
  active: boolean
  onPress: () => void
}) {
  const display = uiStateDisplay(state as never)
  const tone = stateTone(state)
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={session.name}
      accessibilityHint={`${display.label}. ${relativeTime(session.updated_at)}`}
      accessibilityState={{ selected: active }}
      onPress={onPress}
      className="min-h-10 flex-row items-center gap-2.5 rounded-md px-2.5 py-1.5"
      style={{ backgroundColor: active ? palette.accentSoft : 'transparent' }}
    >
      <Dot tone={tone} pulse={display.pulse} />
      <Text
        className="min-w-0 flex-1 text-[12.5px] text-ink"
        numberOfLines={1}
        style={{ fontWeight: active ? '600' : '400' }}
      >
        {session.name}
      </Text>
      <Mono className="shrink-0 text-[9.5px] text-ink-4">{relativeTime(session.updated_at)}</Mono>
    </Pressable>
  )
}
