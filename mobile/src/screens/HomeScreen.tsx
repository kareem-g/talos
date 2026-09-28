/**
 * Home — the Control Deck.
 *
 * Composition follows the desktop `StationHome` top to bottom: the control-deck
 * header (eyebrow, attention pill, live count, New), the anchor strip, then
 * "Needs you" triage → "Active" → workspace-grouped sessions with the same
 * All/Active/Attention/Starred/Archived filters and search, and finally the
 * phone/connection section.
 *
 * The ranking, headlines, counts and workspace grouping are not reimplemented
 * here — they come from the desktop's own pure `deriveHomeView`, fed the mobile
 * store's conversations. So a session that floats to the top of triage on the
 * desktop floats to the top here too, for the same reasons.
 */

import * as React from 'react'
import { FlatList, Modal, Pressable, RefreshControl, ScrollView, Text, View } from 'react-native'
import { SafeAreaView } from 'react-native-safe-area-context'
import { useNavigation } from '@react-navigation/native'
import type { DrawerNavigationProp } from '@react-navigation/drawer'
import {
  Archive,
  ArchiveRestore,
  ChevronRight,
  Plus,
  Search,
  Star,
  X,
} from 'lucide-react-native'

import { getConversation, useStore } from '@app/store'
import { deriveHomeView, type HomeFilter } from '@/lib/homeView'
import { firstOpenApprovalId } from '@/lib/sessionState'
import { basename } from '@/lib/format'
import type { Session } from '@/types/session'
import { useOpenSession, type DrawerParamList } from '@app/navigation'
import { mobileApi } from '@app/lib/api'
import { AutomationsSection, SkillsSection } from '@app/components/home/Sections'
import { deviceBaseUrl, deviceRoutes } from '@app/lib/native'
import {
  Button,
  Card,
  CardHeader,
  Chip,
  Dot,
  Dots,
  EmptyState,
  IconButton,
  Mono,
  PageHeader,
  SectionHeading,
  SectionLabel,
  Segmented,
  StatusPill,
  TextField,
} from '@app/components/ui'

const FILTERS: Array<{ value: HomeFilter; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'active', label: 'Active' },
  { value: 'attention', label: 'Attention' },
  { value: 'starred', label: 'Starred' },
  { value: 'archived', label: 'Archived' },
]

type FilterValue = HomeFilter

export function HomeScreen() {
  const navigation = useNavigation<DrawerNavigationProp<DrawerParamList>>()
  const sessions = useStore((s) => s.sessions)
  const agents = useStore((s) => s.agents)
  const connection = useStore((s) => s.connection)
  const desktopName = useStore((s) => s.desktopName)
  const notices = useStore((s) => s.notices)
  const starred = useStore((s) => s.starred)
  const revisions = useStore((s) => s.revisions)
  const sessionsLoading = useStore((s) => s.sessionsLoading)
  const loadSnapshot = useStore((s) => s.loadSnapshot)
  const respondToApproval = useStore((s) => s.respondToApproval)
  const toggleStar = useStore((s) => s.toggleStar)
  const createSession = useStore((s) => s.createSession)

  const [filter, setFilter] = React.useState<FilterValue>('all')
  const [search, setSearch] = React.useState('')
  const [refreshing, setRefreshing] = React.useState(false)
  const [newOpen, setNewOpen] = React.useState(false)

  const providerNameFor = React.useCallback(
    (agentId: string) => agents.find((agent) => agent.id === agentId)?.name ?? agentId,
    [agents],
  )

  const view = React.useMemo(
    () =>
      deriveHomeView({
        sessions,
        connection,
        search,
        filter,
        starredSet: new Set(starred),
        getConversation,
        providerNameFor,
        notices,
        now: Date.now(),
        // `revisions` is a dependency only so a conversation mutation re-derives
        // the headline/preview; the value itself is not read.
      }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sessions, connection, search, filter, starred, notices, providerNameFor, revisions],
  )

  async function onRefresh() {
    setRefreshing(true)
    await loadSnapshot()
    setRefreshing(false)
  }

  async function approve(sessionId: string) {
    const requestId = firstOpenApprovalId(getConversation(sessionId))
    if (!requestId) return
    respondToApproval(sessionId, requestId, 'allow')
  }

  async function archive(sessionId: string, restore: boolean) {
    try {
      if (restore) await mobileApi.restore(sessionId)
      else await mobileApi.archive(sessionId)
    } finally {
      void loadSnapshot()
    }
  }

  const openSession = useOpenSession()

  return (
    <SafeAreaView className="flex-1 bg-canvas" edges={['top']}>
      <PageHeader
        onMenu={() => navigation.openDrawer()}
        title="Home"
        right={
          <>
            <StatusPill
              tone={view.counts.attention > 0 ? 'red' : 'green'}
              label={view.counts.attention > 0 ? `${view.counts.attention} need you` : 'all clear'}
            />
            <IconButton label="New session" onPress={() => setNewOpen(true)}>
              <Plus size={18} color="#f2f2f3" />
            </IconButton>
          </>
        }
      />

      <FlatList
        data={view.filtered}
        keyExtractor={(entry) => entry.session.id}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} tintColor="#7e7e86" />}
        ListHeaderComponent={
          <ListHeader
            view={view}
            desktopName={desktopName}
            filter={filter}
            setFilter={setFilter}
            search={search}
            setSearch={setSearch}
            onApprove={approve}
            onOpen={openSession}
            connection={connection}
          />
        }
        renderItem={({ item }) => (
          <SessionRow
            session={item.session}
            onPress={() => openSession(item.session.id)}
            starred={starred.includes(item.session.id)}
            onToggleStar={() => toggleStar(item.session.id)}
            onArchive={() => void archive(item.session.id, item.session.status === 'archived')}
          />
        )}
        ListEmptyComponent={
          sessionsLoading && sessions.length === 0 ? (
            <View className="items-center py-14">
              <Dots label="Loading sessions…" />
            </View>
          ) : (
            <EmptyState
              title="No sessions here"
              body="Start an agent on your desktop and it shows up here. Pull to refresh."
            />
          )
        }
        ListFooterComponent={
          <View className="gap-6 p-4">
            <PhoneSection />
            <AutomationsSection />
            <SkillsSection />
          </View>
        }
        contentContainerClassName="pb-10"
      />

      <NewSessionSheet
        open={newOpen}
        onClose={() => setNewOpen(false)}
        onCreate={async (agentId) => {
          const session = await createSession({ agent: agentId })
          setNewOpen(false)
          if (session) openSession(session.id)
        }}
      />
    </SafeAreaView>
  )
}

/** The scrollable part above the session list — control strip, triage, active. */
function ListHeader({
  view,
  desktopName,
  filter,
  setFilter,
  search,
  setSearch,
  onApprove,
  onOpen,
  connection,
}: {
  view: ReturnType<typeof deriveHomeView>
  desktopName: string
  filter: FilterValue
  setFilter: (value: FilterValue) => void
  search: string
  setSearch: (value: string) => void
  onApprove: (sessionId: string) => void
  onOpen: (sessionId: string) => void
  connection: string
}) {
  return (
    <View className="gap-4 p-4">
      {/* Control deck strip */}
      <View className="gap-2">
        <Mono className="text-[10.5px] uppercase tracking-[0.14em] text-ink-3">Control deck</Mono>
        <View className="flex-row items-center gap-2">
          <Text className="flex-1 text-[20px] font-semibold tracking-tight text-ink" numberOfLines={1}>
            {desktopName}
          </Text>
          <View className="flex-row items-center gap-1.5">
            <Dot tone={connection === 'connected' ? 'green' : connection === 'offline' ? 'red' : 'orange'} />
            <Text className="text-[11px] text-ink-3">
              {connection === 'connected' ? 'Live' : 'Offline'}
            </Text>
          </View>
        </View>
        <View className="flex-row flex-wrap items-center gap-2">
          <Chip tone={view.counts.attention > 0 ? 'red' : 'green'} label={`${view.counts.attention} need you`} />
          <Chip tone={view.counts.running > 0 ? 'accent' : 'dim'} label={`${view.counts.running} live`} />
          <Chip label={`${view.counts.total} sessions`} />
          {view.counts.paused > 0 ? <Chip tone="orange" label={`${view.counts.paused} paused`} /> : null}
        </View>
      </View>

      {/* Triage — anything blocked on the human, most urgent first. */}
      {view.attention.length > 0 ? (
        <View className="gap-1">
          <Mono className="text-[10.5px] uppercase tracking-[0.14em] text-ink-3">
            Needs you
          </Mono>
          {view.attention.map((entry) => (
            <View
              key={entry.session.id}
              className="gap-2 rounded-xl border border-line bg-surface p-3"
            >
              <View className="flex-row items-center gap-2">
                <Dot tone={entry.uiState === 'failed' ? 'red' : entry.uiState === 'paused' ? 'dim' : 'orange'} />
                <Text className="min-w-0 flex-1 text-[13px] font-medium text-ink" numberOfLines={1}>
                  {entry.session.name}
                </Text>
                {entry.idleFor ? <Mono className="text-[10.5px]">{entry.idleFor}</Mono> : null}
              </View>
              <Text className="text-[12px] leading-5 text-ink-2" numberOfLines={2}>
                {entry.headline}
              </Text>
              <View className="flex-row items-center gap-2">
                {entry.uiState === 'approval' ? (
                  <Button
                    variant="primary"
                    label="Approve"
                    className="min-h-9 px-3"
                    onPress={() => onApprove(entry.session.id)}
                  />
                ) : null}
                <Button
                  variant="ghost"
                  label="Open"
                  className="min-h-9 px-3"
                  onPress={() => onOpen(entry.session.id)}
                />
              </View>
            </View>
          ))}
        </View>
      ) : null}

      {/* Active — work in flight, with runtime. */}
      {view.active.length > 0 ? (
        <View className="gap-1">
          <Mono className="text-[10.5px] uppercase tracking-[0.14em] text-ink-3">
            Active · {view.active.length} running
          </Mono>
          {view.active.map((entry) => (
            <Pressable
              key={entry.session.id}
              onPress={() => onOpen(entry.session.id)}
              className="flex-row items-center gap-2 rounded-xl border border-line bg-surface px-3 py-2.5 active:bg-hover"
            >
              <Dot tone="accent" pulse />
              <Text className="min-w-0 flex-1 text-[12.5px] text-ink" numberOfLines={1}>
                {entry.task ?? entry.session.name}
              </Text>
              <Mono className="text-[10.5px]">{entry.runtime}</Mono>
            </Pressable>
          ))}
        </View>
      ) : null}

      {/* Workspaces header: filter + search */}
      <View className="gap-2">
        <Mono className="text-[10.5px] uppercase tracking-[0.14em] text-ink-3">
          Workspaces · {view.workspaces.length}
        </Mono>
        <Segmented options={FILTERS} value={filter} onChange={setFilter} />
        <TextField
          value={search}
          onChangeText={setSearch}
          placeholder="Search sessions"
          autoCapitalize="none"
          autoCorrect={false}
          leading={<Search size={14} color="#7e7e86" />}
        />
      </View>
    </View>
  )
}

/** A session row inside a workspace group. */
function SessionRow({
  session,
  onPress,
  starred,
  onToggleStar,
  onArchive,
}: {
  session: Session
  onPress: () => void
  starred: boolean
  onToggleStar: () => void
  onArchive: () => void
}) {
  return (
    <Pressable
      onPress={onPress}
      className="min-h-14 flex-row items-center gap-2 border-b border-line px-4 py-2.5 active:bg-hover"
    >
      <View className="min-w-0 flex-1">
        <Text className="text-[13.5px] text-ink" numberOfLines={1}>
          {session.name}
        </Text>
        <View className="mt-0.5 flex-row items-center gap-1.5">
          <Mono className="text-[11px]" numberOfLines={1}>
            {session.agent}
            {session.project ? ` · ${basename(session.project)}` : ''}
          </Mono>
        </View>
      </View>
      <IconButton label={starred ? 'Unstar' : 'Star'} onPress={onToggleStar} className="size-9">
        <Star size={15} color={starred ? '#db6d28' : '#7e7e86'} fill={starred ? '#db6d28' : 'transparent'} />
      </IconButton>
      <IconButton
        label={session.status === 'archived' ? 'Restore' : 'Archive'}
        onPress={onArchive}
        className="size-9"
      >
        {session.status === 'archived' ? (
          <ArchiveRestore size={15} color="#7e7e86" />
        ) : (
          <Archive size={15} color="#7e7e86" />
        )}
      </IconButton>
      <ChevronRight size={16} color="#7e7e86" />
    </Pressable>
  )
}

/**
 * Phone section — how this device currently reaches the daemon, and the other
 * routes it can fall back to. The desktop's equivalent is the QR card; a phone
 * shows the routes it already holds instead, which is also how it recovers when
 * one stops answering.
 */
function PhoneSection() {
  const connection = useStore((s) => s.connection)
  const routes = deviceRoutes()
  const active = deviceBaseUrl()
  return (
    <View className="gap-3">
      <SectionHeading
        eyebrow="Phone"
        title="Connection"
        description="Routes this device remembers, best first. The app moves to the next one automatically when the active route stops answering."
      />
      <Card>
        <CardHeader title="Routes" right={<Chip tone={connection === 'connected' ? 'green' : 'orange'} label={connection} />} />
        <View className="gap-1 p-3">
          {routes.length === 0 ? (
            <Text className="text-[12px] text-ink-3">Not paired.</Text>
          ) : (
            routes.map((route, index) => (
              <View key={route} className="flex-row items-center gap-2">
                <Dot tone={route === active ? 'green' : 'dim'} />
                <Mono className="min-w-0 flex-1 text-[11.5px] text-ink" numberOfLines={1}>
                  {route}
                </Mono>
                {route === active ? <Chip tone="accent" label="active" /> : <Mono className="text-[10.5px]">#{index + 1}</Mono>}
              </View>
            ))
          )}
        </View>
      </Card>
    </View>
  )
}

/** Quick launch: pick an agent, start a session — the desktop's New task path. */
function NewSessionSheet({
  open,
  onClose,
  onCreate,
}: {
  open: boolean
  onClose: () => void
  onCreate: (agentId: string) => void | Promise<void>
}) {
  const agents = useStore((s) => s.agents)
  const ready = agents.filter((agent) => agent.available)
  return (
    <Modal visible={open} transparent animationType="slide" onRequestClose={onClose}>
      <View className="flex-1 justify-end bg-black/65">
        <View className="max-h-[80%] rounded-t-2xl border border-line bg-surface">
          <View className="flex-row items-center justify-between border-b border-line px-3.5 py-2.5">
            <Text className="text-[13px] font-medium text-ink">New session</Text>
            <IconButton label="Close" onPress={onClose} className="size-9">
              <X size={16} color="#b0b0b6" />
            </IconButton>
          </View>
          <ScrollView contentContainerClassName="p-2">
            {ready.length === 0 ? (
              <EmptyState title="No agents ready" body="Install an agent CLI on the desktop, then re-scan." />
            ) : (
              <>
                <SectionLabel>Ready on your desktop</SectionLabel>
                {ready.map((agent) => (
                  <Pressable
                    key={agent.id}
                    onPress={() => void onCreate(agent.id)}
                    className="min-h-11 flex-row items-center gap-2.5 rounded-control px-2.5 active:bg-hover-2"
                  >
                    <Dot tone="green" />
                    <Text className="min-w-0 flex-1 text-[13px] text-ink" numberOfLines={1}>
                      {agent.name}
                    </Text>
                    <ChevronRight size={16} color="#7e7e86" />
                  </Pressable>
                ))}
              </>
            )}
          </ScrollView>
        </View>
      </View>
    </Modal>
  )
}
