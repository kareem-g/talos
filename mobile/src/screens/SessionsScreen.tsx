/**
 * Sessions — the browser.
 *
 * QAI SIGNAL DECK
 * ---------------
 * Every session the desktop knows about, grouped by workspace, searchable and
 * filterable, with the full action set one gesture away (star, fork, resume,
 * archive, delete). The Deck answers "what needs me now"; this tab answers
 * "where was that thing I ran on Tuesday".
 *
 * The archived filter widens the snapshot itself (`include_archived`), because
 * archived rows are not merely hidden client-side — the daemon omits them
 * until asked. Rows keep the shared `SessionRow` vocabulary: signal stripe,
 * agent avatar, status pill, swipe actions.
 */

import * as React from 'react'
import { Text, View } from 'react-native'
import { Search } from 'lucide-react-native'

import { deriveHomeView, type HomeFilter } from '@/lib/homeView'
import { getConversation, useStore } from '@app/store'
import { mobileApi } from '@app/lib/api'
import { useNewTask, useOpenSession } from '@app/navigation'
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
import { ScreenScaffold } from '@app/components/Screen'
import {
  SessionActionsSheet,
  SessionListSkeleton,
  SessionRow,
  WorkspaceGroup,
} from '@app/components/session/SessionRow'

export function SessionsScreen() {
  const sessions = useStore((state) => state.sessions)
  const agents = useStore((state) => state.agents)
  const connection = useStore((state) => state.connection)
  const notices = useStore((state) => state.notices)
  const starred = useStore((state) => state.starred)
  const revisions = useStore((state) => state.revisions)
  const sessionsLoading = useStore((state) => state.sessionsLoading)
  const loadSnapshot = useStore((state) => state.loadSnapshot)
  const toggleStar = useStore((state) => state.toggleStar)
  const removeSession = useStore((state) => state.removeSession)
  const resumeSession = useStore((state) => state.resumeSession)
  const forkSession = useStore((state) => state.forkSession)

  const openSession = useOpenSession()
  const openNewTask = useNewTask()

  const [refreshing, setRefreshing] = React.useState(false)
  const [filter, setFilter] = React.useState<HomeFilter>('all')
  const [query, setQuery] = React.useState('')
  const [menuSession, setMenuSession] = React.useState<string | null>(null)
  const [confirmDelete, setConfirmDelete] = React.useState<string | null>(null)
  const [busyDelete, setBusyDelete] = React.useState(false)

  const providerNameFor = React.useCallback(
    (agentId: string) => agents.find((agent) => agent.id === agentId)?.name ?? agentId,
    [agents],
  )

  // The archived filter needs rows the default snapshot omits; widen it while
  // the filter is on, and restore the narrower snapshot when leaving.
  React.useEffect(() => {
    void loadSnapshot(filter === 'archived')
  }, [filter, loadSnapshot])

  const view = React.useMemo(
    () =>
      deriveHomeView({
        sessions,
        connection,
        search: query,
        filter,
        starredSet: new Set(starred),
        getConversation,
        providerNameFor,
        notices,
        now: Date.now(),
        // `revisions` re-derives previews as conversations stream.
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sessions, connection, query, filter, starred, notices, providerNameFor, revisions],
  )

  const filtering = filter !== 'all' || query.trim().length > 0

  const onRefresh = React.useCallback(async () => {
    setRefreshing(true)
    try {
      await loadSnapshot(filter === 'archived')
    } finally {
      setRefreshing(false)
    }
  }, [filter, loadSnapshot])

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
      void loadSnapshot(filter === 'archived')
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
      title="Sessions"
      eyebrow={`${view.counts.total} active · ${view.counts.archived} archived`}
      onRefresh={() => void onRefresh()}
      refreshing={refreshing}
      contentClassName="gap-4 pb-12"
      below={
        <View className="gap-2.5">
          <SearchField
            value={query}
            onChangeText={setQuery}
            placeholder="Search sessions, agents, workspaces…"
            accessibilityLabel="Search sessions"
          />
          <FilterChips
            label="Filter sessions"
            value={filter}
            onChange={(value) => {
              void haptic('light')
              setFilter(value as HomeFilter)
            }}
            options={[
              { value: 'all' as HomeFilter, label: 'Everything', count: view.counts.total },
              { value: 'attention' as HomeFilter, label: 'Needs you', count: view.counts.attention, tone: 'wait' },
              { value: 'active' as HomeFilter, label: 'Live', count: view.counts.running, tone: 'ok' },
              { value: 'starred' as HomeFilter, label: 'Starred', count: starred.length },
              { value: 'archived' as HomeFilter, label: 'Archived', count: view.counts.archived },
            ]}
          />
        </View>
      }
    >
      {sessionsLoading && sessions.length === 0 ? (
        <View className="px-4">
          <SessionListSkeleton count={6} />
        </View>
      ) : view.workspaces.length === 0 ? (
        <View className="px-4">
          <Card>
            <EmptyState
              title={filtering ? 'Nothing matches' : 'No sessions yet'}
              body={
                filtering
                  ? 'Try a different search, or clear the filter to see everything.'
                  : 'Start an agent from here, or open one on your desktop and it will appear.'
              }
              icon={<Search size={22} color={palette.ink3} />}
              action={
                filtering ? (
                  <Button
                    size="sm"
                    variant="secondary"
                    label="Clear filters"
                    onPress={() => {
                      setFilter('all')
                      setQuery('')
                    }}
                  />
                ) : (
                  <Button
                    size="sm"
                    variant="primary"
                    label="New task"
                    accessibilityLabel="Start a new task"
                    onPress={() => openNewTask()}
                  />
                )
              }
            />
          </Card>
        </View>
      ) : (
        <View className="gap-3 px-4">
          {view.workspaces.map((workspace, index) => (
            <WorkspaceGroup
              key={workspace.id}
              name={workspace.name}
              project={workspace.project}
              total={workspace.counts.total}
              attention={workspace.counts.attention}
              running={workspace.counts.running}
              defaultOpen={workspace.counts.attention > 0 || view.workspaces.length <= 3 || filtering}
              onNewTask={() => openNewTask(undefined, workspace.project ?? undefined)}
            >
              {workspace.sessions.map(({ session, uiState }, rowIndex) => (
                <SessionRow
                  key={session.id}
                  session={session}
                  state={uiState}
                  providerName={providerNameFor(session.agent)}
                  hideWorkspace
                  starred={starred.includes(session.id)}
                  enterIndex={rowIndex + index}
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
            </WorkspaceGroup>
          ))}
        </View>
      )}

      {filtering && view.workspaces.length > 0 ? (
        <View className="items-center px-4">
          <Text
            accessibilityRole="button"
            accessibilityLabel="Clear filters and search"
            onPress={() => {
              setFilter('all')
              setQuery('')
            }}
            className="min-h-9 px-4 text-[12.5px] font-semibold text-accent"
          >
            Clear filters
          </Text>
        </View>
      ) : null}

      <SessionActionsSheet
        session={menuRow}
        providerName={menuRow ? providerNameFor(menuRow.agent) : undefined}
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
