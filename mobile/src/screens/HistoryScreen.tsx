/**
 * History — every session, grouped by day.
 *
 * QAI · WARM STUDIO
 * -----------------
 * The desktop's HistoryPage: all non-archived sessions in day groups
 * (Today / Yesterday / Nd / date), newest first, tap opens the session. The
 * phone adds what a phone needs around it — search, a starred filter, an
 * archived switch (which widens the snapshot itself, because archived rows
 * are omitted by the daemon until asked), and the full per-session action
 * set behind the row: star, resume, fork, archive/restore, delete.
 */

import * as React from 'react'
import { Text, View } from 'react-native'
import { History as HistoryIcon, Search } from 'lucide-react-native'

import { isInternalSession } from '@/lib/sessionState'
import type { Session } from '@/types/session'
import { useStore } from '@app/store'
import { mobileApi } from '@app/lib/api'
import { useOpenSession } from '@app/navigation'
import { palette } from '@app/design/tokens'
import { ConfirmDialog } from '@app/components/Sheet'
import {
  Button,
  Card,
  EmptyState,
  FilterChips,
  SearchField,
  haptic,
  toast,
} from '@app/components/ui'
import { ScreenScaffold, Section } from '@app/components/Screen'
import { DrawerButton } from '@app/components/Drawer'
import {
  SessionActionsSheet,
  SessionListSkeleton,
  SessionRow,
} from '@app/components/session/SessionRow'

/** Desktop `relativeDay`: Today / Yesterday / Nd / a short date. */
function relativeDay(iso: string): string {
  const then = new Date(iso)
  if (Number.isNaN(then.getTime())) return 'Earlier'
  const days = Math.floor((Date.now() - then.getTime()) / 86_400_000)
  if (days <= 0) return 'Today'
  if (days === 1) return 'Yesterday'
  if (days < 7) return `${days}d ago`
  return then.toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

type Mode = 'all' | 'starred' | 'archived'

export function HistoryScreen() {
  const sessions = useStore((s) => s.sessions)
  const agents = useStore((s) => s.agents)
  const starred = useStore((s) => s.starred)
  const revisions = useStore((s) => s.revisions)
  const sessionsLoading = useStore((s) => s.sessionsLoading)
  const loadSnapshot = useStore((s) => s.loadSnapshot)
  const toggleStar = useStore((s) => s.toggleStar)
  const removeSession = useStore((s) => s.removeSession)
  const resumeSession = useStore((s) => s.resumeSession)
  const forkSession = useStore((s) => s.forkSession)

  const openSession = useOpenSession()

  const [mode, setMode] = React.useState<Mode>('all')
  const [query, setQuery] = React.useState('')
  const [refreshing, setRefreshing] = React.useState(false)
  const [menuSession, setMenuSession] = React.useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = React.useState<string | null>(null)
  const [busyDelete, setBusyDelete] = React.useState(false)

  const providerName = React.useCallback(
    (agentId: string) => agents.find((agent) => agent.id === agentId)?.name ?? agentId,
    [agents],
  )

  // The archived mode needs rows the default snapshot omits.
  React.useEffect(() => {
    void loadSnapshot(mode === 'archived')
  }, [mode, loadSnapshot])

  const visible = React.useMemo(() => {
    const needle = query.trim().toLowerCase()
    return sessions
      .filter((session) => !isInternalSession(session))
      .filter((session) =>
        mode === 'archived'
          ? session.status === 'archived'
          : session.status !== 'archived',
      )
      .filter((session) => (mode === 'starred' ? starred.includes(session.id) : true))
      .filter(
        (session) =>
          !needle ||
          session.name.toLowerCase().includes(needle) ||
          session.agent.toLowerCase().includes(needle) ||
          (session.project ?? '').toLowerCase().includes(needle),
      )
      .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
    // `revisions` re-sorts as live status lands.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessions, mode, query, starred, revisions])

  const groups = React.useMemo(() => {
    const byDay = new Map<string, Session[]>()
    for (const session of visible) {
      const key = relativeDay(session.updated_at)
      const list = byDay.get(key)
      if (list) list.push(session)
      else byDay.set(key, [session])
    }
    return [...byDay.entries()]
  }, [visible])

  const onRefresh = React.useCallback(async () => {
    setRefreshing(true)
    try {
      await loadSnapshot(mode === 'archived')
    } finally {
      setRefreshing(false)
    }
  }, [loadSnapshot, mode])

  async function toggleArchive(sessionId: string, archived: boolean) {
    try {
      if (archived) await mobileApi.restore(sessionId)
      else await mobileApi.archive(sessionId)
      toast({ message: archived ? 'Restored' : 'Archived', tone: 'ok' })
    } catch (cause) {
      toast({
        message: archived ? 'Could not restore that session' : 'Could not archive that session',
        detail: cause instanceof Error ? cause.message : undefined,
        tone: 'danger',
      })
    } finally {
      void loadSnapshot(mode === 'archived')
    }
  }

  async function doDelete(sessionId: string) {
    setBusyDelete(true)
    const name = sessions.find((session) => session.id === sessionId)?.name ?? 'Session'
    const ok = await removeSession(sessionId)
    setBusyDelete(false)
    setConfirmDelete(null)
    setMenuSession(null)
    toast(
      ok
        ? { message: `Deleted “${name}”` }
        : { message: `Could not delete “${name}”`, tone: 'danger' },
    )
  }

  const menuRow = menuSession ? sessions.find((s) => s.id === menuSession) : undefined

  return (
    <ScreenScaffold
      title="History"
      eyebrow={`${visible.length} ${visible.length === 1 ? 'session' : 'sessions'}`}
      subtitle="Everything this station has run, newest first."
      onRefresh={() => void onRefresh()}
      refreshing={refreshing}
      contentClassName="pb-10"
      headerLeft={<DrawerButton />}
      below={
        <View className="gap-2.5">
          <SearchField
            value={query}
            onChangeText={setQuery}
            placeholder="Search history"
            accessibilityLabel="Search sessions"
          />
          <FilterChips
            label="Filter history"
            value={mode}
            onChange={(value) => {
              void haptic('light')
              setMode(value as Mode)
            }}
            options={[
              { value: 'all' as Mode, label: 'All' },
              { value: 'starred' as Mode, label: 'Starred', count: starred.length },
              { value: 'archived' as Mode, label: 'Archived' },
            ]}
          />
        </View>
      }
    >
      {sessionsLoading && visible.length === 0 ? (
        <View className="px-4">
          <SessionListSkeleton count={6} />
        </View>
      ) : groups.length === 0 ? (
        <View className="px-4">
          <Card>
            <EmptyState
              title={query || mode !== 'all' ? 'Nothing matches' : 'Nothing yet'}
              body={
                query || mode !== 'all'
                  ? 'Try a different search or filter.'
                  : 'Sessions you run on the desktop appear here, newest first.'
              }
              icon={query ? <Search size={22} color={palette.ink3} /> : <HistoryIcon size={22} color={palette.ink3} />}
              action={
                query || mode !== 'all' ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    label="Clear"
                    onPress={() => {
                      setQuery('')
                      setMode('all')
                    }}
                  />
                ) : undefined
              }
            />
          </Card>
        </View>
      ) : (
        <View className="gap-5">
          {groups.map(([title, rows], groupIndex) => (
            <Section
              key={title}
              eyebrow={title}
              enterIndex={groupIndex}
              action={
                <Text
                  className="pb-0.5 text-[10.5px] font-medium text-ink-4"
                  style={{ fontVariant: ['tabular-nums'] }}
                >
                  {rows.length}
                </Text>
              }
            >
              <Card>
                {rows.map((session, index) => (
                  <SessionRow
                    key={session.id}
                    session={session}
                    enterIndex={index}
                    providerName={providerName(session.agent)}
                    starred={starred.includes(session.id)}
                    onOpen={() => openSession(session.id)}
                    onToggleStar={() => {
                      void toggleStar(session.id)
                      toast({
                        message: starred.includes(session.id) ? 'Star removed' : 'Starred',
                        tone: 'muted',
                        haptic: 'light',
                      })
                    }}
                    onArchive={() => void toggleArchive(session.id, session.status === 'archived')}
                    onMore={() => setMenuSession(session.id)}
                  />
                ))}
              </Card>
            </Section>
          ))}
        </View>
      )}

      <SessionActionsSheet
        session={menuRow}
        providerName={menuRow ? providerName(menuRow.agent) : undefined}
        starred={menuSession ? starred.includes(menuSession) : false}
        onClose={() => setMenuSession(null)}
        onStar={() => {
          if (menuSession) toggleStar(menuSession)
        }}
        onResume={() => {
          if (!menuSession) return
          void resumeSession(menuSession).then((ok) => {
            if (ok) {
              const id = menuSession
              setMenuSession(null)
              openSession(id)
            } else {
              toast({ message: 'Could not resume that session', tone: 'danger' })
            }
          })
        }}
        onFork={() => {
          if (!menuSession) return
          void forkSession(menuSession).then((forked) => {
            if (forked) {
              setMenuSession(null)
              openSession(forked.id)
              toast({ message: 'Forked into a new session', tone: 'ok' })
            } else {
              toast({ message: 'Could not fork that session', tone: 'danger' })
            }
          })
        }}
        onArchive={() => {
          if (menuSession) void toggleArchive(menuSession, false)
          setMenuSession(null)
        }}
        onRestore={() => {
          if (menuSession) void toggleArchive(menuSession, true)
          setMenuSession(null)
        }}
        onDelete={() => {
          if (menuSession) setConfirmDelete(menuSession)
        }}
      />

      <ConfirmDialog
        open={confirmDelete !== null}
        busy={busyDelete}
        title="Delete this session?"
        body={`“${sessions.find((s) => s.id === confirmDelete)?.name ?? 'This session'}” and its full history will be removed from the desktop. This cannot be undone.`}
        confirmLabel="Delete forever"
        onClose={() => setConfirmDelete(null)}
        onConfirm={() => confirmDelete && void doDelete(confirmDelete)}
      />
    </ScreenScaffold>
  )
}
