/**
 * Rail tabs that talk to the daemon — Git, Files, Browser, Rooms, Projects.
 *
 * These are the desktop right-rail views that need real backend data, so they
 * call the same handlers the desktop calls, through the authenticated
 * `/api/mobile/*` surface. Visual structure follows the desktop: the Git tab is
 * branch + changed files + diff, the Files tab is a lazy directory tree with a
 * line-numbered viewer, the Browser tab is the CDP mirror (a screenshot with
 * manual tool calls), and Projects/Rooms are pickers over sessions.
 *
 * Where the desktop reveals things on hover, these expand on tap — a phone has no
 * hover, and a control that only exists while a cursor is over it does not exist.
 */

import * as React from 'react'
import { ActivityIndicator, Image, Pressable, ScrollView, Text, TextInput, View } from 'react-native'
import { ChevronDown, ChevronRight, FileText, Folder, RefreshCw, Square } from 'lucide-react-native'
import { useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'

import { basename, cn, relativeTime } from '@/lib/format'
import type { Session } from '@/types/session'
import type { RootStackParamList } from '@app/navigation'
import {
  ApiError,
  browserApi,
  gitApi,
  roomsApi,
  workspaceApi,
  type DirEntry,
} from '@app/lib/api'
import { useStore } from '@app/store'
import { Button, EmptyState, Mono, StatusPill } from '@app/components/ui'
import { DiffView } from '@app/components/chat/rows'

function RailHeader({ eyebrow, right }: { eyebrow: string; right?: React.ReactNode }) {
  return (
    <View className="mb-3 flex-row items-center justify-between gap-2 border-b border-line pb-2">
      <Mono className="text-[10px] uppercase tracking-[0.14em] text-ink-3" numberOfLines={1}>
        {eyebrow}
      </Mono>
      {right}
    </View>
  )
}

function LoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <View className="gap-2 rounded-lg border border-red-border bg-red-tint px-3 py-2.5">
      <Text className="text-[11.5px] leading-5 text-ink">{message}</Text>
      <Button variant="ghost" label="Retry" className="min-h-9 self-start px-3" onPress={onRetry} />
    </View>
  )
}

/* ── Git ─────────────────────────────────────────────────────────────────── */

/**
 * Git tab: the branch, the working tree's changed files, and the commit box.
 *
 * `sessionOverview` resolves the project from the session and returns the diffs
 * inline, so opening a file costs no extra round trip; `gitApi.diff` is the
 * fallback for files the overview did not include.
 */
export function GitTab({ session }: { session: Session }) {
  const project = session.project
  const [git, setGit] = React.useState<Awaited<ReturnType<typeof gitApi.branches>> | null>(null)
  const [files, setFiles] = React.useState<Array<{ path: string; status?: string }>>([])
  const [diffs, setDiffs] = React.useState<Record<string, string>>({})
  const [open, setOpen] = React.useState<string | null>(null)
  const [message, setMessage] = React.useState('')
  const [push, setPush] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [note, setNote] = React.useState<string | null>(null)

  const load = React.useCallback(async () => {
    if (!project) return
    setError(null)
    try {
      const [state, overview] = await Promise.all([
        gitApi.branches(project),
        workspaceApi.sessionOverview(session.id),
      ])
      setGit(state)
      setFiles(overview.changed_files ?? [])
      setDiffs(overview.diffs ?? {})
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not read git state')
    }
  }, [project, session.id])

  React.useEffect(() => {
    void load()
  }, [load])

  async function openFile(path: string) {
    if (open === path) {
      setOpen(null)
      return
    }
    setOpen(path)
    if (diffs[path] !== undefined || !project) return
    try {
      const result = await gitApi.diff(project, path, session.id)
      setDiffs((current) => ({ ...current, [path]: result.diff }))
    } catch {
      setDiffs((current) => ({ ...current, [path]: '' }))
    }
  }

  async function commit() {
    if (!project || !message.trim()) return
    setBusy(true)
    setError(null)
    setNote(null)
    try {
      const result = await gitApi.commit(project, message.trim(), push)
      setNote(result.pushed ? 'Committed and pushed.' : result.ok ? 'Committed.' : 'Commit failed.')
      setMessage('')
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Commit failed')
    } finally {
      setBusy(false)
    }
  }

  if (!project) {
    return <EmptyState title="No project" body="This session has no workspace, so there is nothing to diff." />
  }

  return (
    <View>
      <RailHeader
        eyebrow={`git · ${basename(project)}`}
        right={
          <Pressable onPress={() => void load()} accessibilityLabel="Refresh" className="size-7 items-center justify-center rounded-md active:bg-hover-2">
            <RefreshCw size={12} color="#7e7e86" />
          </Pressable>
        }
      />

      {error ? <LoadError message={error} onRetry={() => void load()} /> : null}

      {git ? (
        <View className="mb-3 flex-row flex-wrap items-center gap-2">
          <View className="rounded-lg border border-line bg-surface px-2.5 py-1">
            <Mono className="text-[11px] text-ink">{git.current ?? 'detached'}</Mono>
          </View>
          <Mono className="text-[10.5px] text-ink-3">{git.branches.length} branches</Mono>
          <Mono className="text-[10.5px] text-green">+{git.added}</Mono>
          <Mono className="text-[10.5px] text-red">−{git.removed}</Mono>
        </View>
      ) : (
        <ActivityIndicator color="#5b8def" />
      )}

      <Mono className="mb-1 text-[9.5px] uppercase tracking-wider">
        {files.length} changed file{files.length === 1 ? '' : 's'}
      </Mono>
      {files.length === 0 ? (
        <Text className="text-[11.5px] text-ink-3">Working tree clean.</Text>
      ) : (
        <View className="gap-0.5">
          {files.map((file) => (
            <View key={file.path} className="overflow-hidden rounded-md">
              <Pressable
                onPress={() => void openFile(file.path)}
                className="min-h-8 flex-row items-center gap-1.5 rounded-md px-2"
              >
                <ChevronDown
                  size={11}
                  color="#7e7e86"
                  style={{ transform: [{ rotate: open === file.path ? '0deg' : '-90deg' }] }}
                />
                <Mono className="min-w-0 flex-1 text-[11px] text-ink" numberOfLines={1}>
                  {file.path}
                </Mono>
                {file.status ? (
                  <Mono className="shrink-0 text-[9.5px] uppercase text-ink-3">{file.status}</Mono>
                ) : null}
              </Pressable>
              {open === file.path ? (
                diffs[file.path] ? (
                  <DiffView diff={diffs[file.path]} />
                ) : (
                  <Mono className="px-3 py-2 text-[11px]">No diff for this file.</Mono>
                )
              ) : null}
            </View>
          ))}
        </View>
      )}

      <View className="mt-3 gap-2 border-t border-line pt-3">
        <TextInput
          value={message}
          onChangeText={setMessage}
          placeholder="Commit message"
          placeholderTextColor="#7e7e86"
          multiline
          className="min-h-11 rounded-lg border border-line bg-field px-2.5 py-2 text-[12.5px] text-ink"
        />
        <View className="flex-row items-center gap-2">
          <Pressable
            onPress={() => setPush((value) => !value)}
            accessibilityRole="switch"
            accessibilityState={{ checked: push }}
            className={cn(
              'flex-row items-center gap-2 rounded-control border px-2.5 py-1.5',
              push ? 'border-accent bg-accent-tint' : 'border-line bg-surface',
            )}
          >
            <View className={cn('size-3 rounded-sm border', push ? 'border-accent bg-accent' : 'border-line-strong')} />
            <Text className={cn('text-[11.5px]', push ? 'text-ink' : 'text-ink-2')}>Push</Text>
          </Pressable>
          <View className="flex-1" />
          <Button
            variant="primary"
            label={busy ? 'Committing…' : files.length ? `Commit ${files.length} files` : 'Commit'}
            disabled={busy || message.trim().length === 0}
            onPress={() => void commit()}
          />
        </View>
        {note ? <Text className="text-[11.5px] text-green">{note}</Text> : null}
      </View>
    </View>
  )
}

/* ── Files ───────────────────────────────────────────────────────────────── */

/** Lazy directory browser with a line-numbered file viewer. */
export function FilesTab({ session }: { session: Session }) {
  const project = session.project
  const [listing, setListing] = React.useState<Awaited<ReturnType<typeof workspaceApi.dirs>> | null>(null)
  const [error, setError] = React.useState<string | null>(null)
  const [openFile, setOpenFile] = React.useState<{ path: string; contents: string } | null>(null)

  const load = React.useCallback(
    async (path?: string) => {
      setError(null)
      try {
        setListing(await workspaceApi.dirs(path ?? project ?? undefined, true))
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Could not list the workspace')
      }
    },
    [project],
  )

  React.useEffect(() => {
    void load()
  }, [load])

  async function readFile(entry: DirEntry) {
    if (!project) return
    try {
      const result = await workspaceApi.file(project, entry.path)
      setOpenFile({ path: entry.path, contents: result.contents ?? '' })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not read that file')
    }
  }

  if (openFile) {
    return (
      <View>
        <View className="mb-3 flex-row items-center gap-2 border-b border-line pb-2">
          <Pressable onPress={() => setOpenFile(null)} className="min-h-8 flex-row items-center gap-1 rounded-md px-2 active:bg-hover-2">
            <ChevronRight size={12} color="#b0b0b6" style={{ transform: [{ rotate: '180deg' }] }} />
            <Text className="text-[11.5px] text-ink-2">Back</Text>
          </Pressable>
          <Mono className="min-w-0 flex-1 text-[10.5px]" numberOfLines={1}>
            {openFile.path}
          </Mono>
        </View>
        <ScrollView horizontal>
          <View className="flex-row">
            <Mono className="pr-3 text-right text-[10px] leading-4 text-ink-3">
              {openFile.contents
                .split('\n')
                .map((_, index) => String(index + 1))
                .join('\n')}
            </Mono>
            <Mono className="text-[11px] leading-4 text-ink-2">{openFile.contents}</Mono>
          </View>
        </ScrollView>
      </View>
    )
  }

  return (
    <View>
      <RailHeader eyebrow={`Files · ${basename(listing?.path ?? project ?? 'workspace')}`} />
      {error ? <LoadError message={error} onRetry={() => void load()} /> : null}
      {listing ? (
        <View className="gap-0.5">
          {listing.parent ? (
            <Pressable
              onPress={() => void load(listing.parent)}
              className="min-h-9 flex-row items-center gap-2 rounded-md px-2 active:bg-hover-2"
            >
              <Folder size={13} color="#7e7e86" />
              <Mono className="text-[11.5px] text-ink-2">..</Mono>
            </Pressable>
          ) : null}
          {listing.entries.map((entry) => (
            <Pressable
              key={entry.path}
              onPress={() => (entry.dir ? void load(entry.path) : void readFile(entry))}
              className="min-h-9 flex-row items-center gap-2 rounded-md px-2 active:bg-hover-2"
            >
              {entry.dir ? <Folder size={13} color="#7e7e86" /> : <FileText size={13} color="#7e7e86" />}
              <Mono className="min-w-0 flex-1 text-[11.5px] text-ink-2" numberOfLines={1}>
                {entry.name}
              </Mono>
              {entry.dir ? <ChevronRight size={12} color="#52525b" /> : null}
            </Pressable>
          ))}
          {listing.entries.length === 0 ? (
            <Text className="px-2 py-3 text-[11.5px] text-ink-3">This directory is empty.</Text>
          ) : null}
        </View>
      ) : (
        <ActivityIndicator color="#5b8def" />
      )}
    </View>
  )
}

/* ── Browser ─────────────────────────────────────────────────────────────── */

const SCREENSHOT_INTERVAL_MS = 3000

/**
 * Browser tab: the CDP mirror.
 *
 * The desktop renders the live page as a screenshot and sends clicks in page
 * coordinates; the same works here — tapping the image maps the touch back to the
 * viewport the daemon reports, so manual actions land in the transcript exactly
 * like the agent's own steps.
 */
export function BrowserTab({ session }: { session: Session }) {
  const [state, setState] = React.useState<Awaited<ReturnType<typeof browserApi.state>> | null>(null)
  const [shot, setShot] = React.useState<string | null>(null)
  const [url, setUrl] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [size, setSize] = React.useState({ width: 1, height: 1 })
  const tabId = state?.tabs?.[0]?.id

  const refreshState = React.useCallback(async () => {
    try {
      const next = await browserApi.state(session.id)
      setState(next)
      if (next.tabs?.[0]?.url) setUrl((current) => current || next.tabs![0].url)
      setError(null)
      return next
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Browser unavailable')
      return null
    }
  }, [session.id])

  const refreshShot = React.useCallback(async () => {
    const current = state
    const tab = current?.tabs?.[0]?.id
    if (!current?.ok || !tab) return
    try {
      setShot(await browserApi.screenshot(session.id, tab))
    } catch {
      /* a missed frame is not worth surfacing */
    }
  }, [session.id, state])

  React.useEffect(() => {
    void refreshState()
  }, [refreshState])

  // Poll state while mounted, and the frame on a slower cadence once running.
  React.useEffect(() => {
    const timer = setInterval(() => void refreshState(), 2500)
    return () => clearInterval(timer)
  }, [refreshState])

  React.useEffect(() => {
    if (!state?.ok) return
    void refreshShot()
    const timer = setInterval(() => void refreshShot(), SCREENSHOT_INTERVAL_MS)
    return () => clearInterval(timer)
  }, [state?.ok, refreshShot])

  async function run(action: () => Promise<unknown>) {
    setBusy(true)
    setError(null)
    try {
      await action()
      await refreshState()
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : 'That action failed')
    } finally {
      setBusy(false)
    }
  }

  /** Map a touch on the rendered image back into page coordinates. */
  function tapAt(x: number, y: number, renderedWidth: number, renderedHeight: number) {
    if (!state?.viewport) return
    const pageX = Math.round((x / renderedWidth) * state.viewport.width)
    const pageY = Math.round((y / renderedHeight) * state.viewport.height)
    void run(() =>
      browserApi.tool(session.id, 'browser_cua_click', { tab: tabId, x: pageX, y: pageY }),
    )
  }

  const running = Boolean(state?.ok)

  return (
    <View>
      <RailHeader
        eyebrow="Browser"
        right={
          <StatusPill tone={running ? 'green' : 'dim'} label={running ? 'live' : 'stopped'} />
        }
      />

      {error ? <LoadError message={error} onRetry={() => void refreshState()} /> : null}

      {!running ? (
        <View className="gap-3">
          <Text className="text-[11.5px] leading-5 text-ink-2">
            The built-in browser is not running for this session. Start it to mirror the page here and
            drive it by hand; the agent keeps using the same engine.
          </Text>
          <Button
            variant="primary"
            label={busy ? 'Starting…' : 'Start browser'}
            disabled={busy}
            onPress={() => void run(() => browserApi.start(session.id))}
          />
        </View>
      ) : (
        <View className="gap-2">
          <View className="flex-row items-center gap-2">
            <TextInput
              value={url}
              onChangeText={setUrl}
              placeholder="https://…"
              placeholderTextColor="#7e7e86"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              className="min-h-10 flex-1 rounded-lg border border-line bg-field px-2.5 text-[12px] text-ink"
            />
            <Button
              variant="surface"
              label="Go"
              disabled={busy || url.trim().length === 0}
              onPress={() => void run(() => browserApi.tool(session.id, 'browser_goto', { tab: tabId, url: url.trim() }))}
            />
            <Pressable
              onPress={() => void run(() => browserApi.stop(session.id))}
              accessibilityLabel="Stop browser"
              className="size-10 items-center justify-center rounded-lg bg-red-tint"
            >
              <Square size={13} color="#f85149" fill="#f85149" />
            </Pressable>
          </View>

          {shot ? (
            <Pressable
              onPress={(event) => {
                const { locationX, locationY } = event.nativeEvent
                tapAt(locationX, locationY, size.width, size.height)
              }}
              onLayout={(event) => {
                const { width, height } = event.nativeEvent.layout
                setSize({ width: width || 1, height: height || 1 })
              }}
            >
              <Image source={{ uri: shot }} resizeMode="contain" style={{ width: '100%', height: 280 }} />
            </Pressable>
          ) : (
            <View className="h-[280px] items-center justify-center rounded-lg border border-line bg-inset">
              <Mono className="text-[11px]">Waiting for a frame…</Mono>
            </View>
          )}

          <View className="flex-row items-center gap-2">
            <Mono className="min-w-0 flex-1 text-[10px]" numberOfLines={1}>
              {state?.tabs?.[0]?.title || state?.tabs?.[0]?.url || 'about:blank'}
            </Mono>
            {state?.viewport ? (
              <Mono className="text-[10px]">
                {state.viewport.width}×{state.viewport.height}
              </Mono>
            ) : null}
          </View>
          <Text className="text-[10.5px] leading-4 text-ink-3">
            Tap the page to click there. Actions run through the same tools the agent uses, so they
            appear in the transcript.
          </Text>
        </View>
      )}
    </View>
  )
}

/* ── Rooms ───────────────────────────────────────────────────────────────── */

export function RoomsTab() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const [rooms, setRooms] = React.useState<Awaited<ReturnType<typeof roomsApi.list>>['rooms']>([])
  const [error, setError] = React.useState<string | null>(null)

  const load = React.useCallback(async () => {
    try {
      setRooms((await roomsApi.list()).rooms ?? [])
      setError(null)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load rooms')
    }
  }, [])

  React.useEffect(() => {
    void load()
  }, [load])

  return (
    <View>
      <RailHeader eyebrow="Rooms" right={<Mono className="text-[10px]">{rooms.length}</Mono>} />
      {error ? <LoadError message={error} onRetry={() => void load()} /> : null}
      {rooms.length === 0 ? (
        <EmptyState title="No rooms" body="Rooms are rosters of workers you can fan a task out to." />
      ) : (
        <View className="gap-1">
          {rooms.map((room) => (
            <Pressable
              key={room.id}
              onPress={() => room.session_id && navigation.navigate('Session', { sessionId: room.session_id })}
              className="min-h-11 flex-row items-center gap-2 rounded-control px-2 active:bg-hover-2"
            >
              <View className="size-1.5 rounded-full bg-accent" />
              <Text className="min-w-0 flex-1 text-[12.5px] text-ink" numberOfLines={1}>
                {room.name}
              </Text>
              <Mono className="text-[9.5px] uppercase">
                {Array.isArray(room.workers) ? `${room.workers.length} workers` : 'room'}
              </Mono>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  )
}

/* ── Projects ────────────────────────────────────────────────────────────── */

export function ProjectsTab() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const sessions = useStore((state) => state.sessions)
  const [open, setOpen] = React.useState<string | null>(null)

  const groups = React.useMemo(() => {
    const byProject = new Map<string, Session[]>()
    for (const session of sessions) {
      if (session.status === 'archived') continue
      const key = session.project ?? '__inbox__'
      const list = byProject.get(key)
      if (list) list.push(session)
      else byProject.set(key, [session])
    }
    return [...byProject.entries()].sort((a, b) => b[1].length - a[1].length)
  }, [sessions])

  return (
    <View>
      <RailHeader eyebrow="Projects" right={<Mono className="text-[10px]">{groups.length}</Mono>} />
      <View className="gap-0.5">
        {groups.map(([project, list]) => {
          const expanded = open === project
          return (
            <View key={project}>
              <Pressable
                onPress={() => setOpen(expanded ? null : project)}
                className="min-h-10 flex-row items-center gap-2 rounded-lg px-2 active:bg-hover-2"
              >
                <ChevronRight
                  size={13}
                  color="#7e7e86"
                  style={{ transform: [{ rotate: expanded ? '90deg' : '0deg' }] }}
                />
                <Folder size={13} color="#7e7e86" />
                <Text className="min-w-0 flex-1 text-[12px] font-medium text-ink" numberOfLines={1}>
                  {project === '__inbox__' ? 'Inbox' : basename(project)}
                </Text>
                <Mono className="text-[10px]">{list.length}</Mono>
              </Pressable>
              {expanded ? (
                <View className="ml-[22px] border-l border-line pl-2">
                  {list.map((session) => (
                    <Pressable
                      key={session.id}
                      onPress={() => navigation.navigate('Session', { sessionId: session.id })}
                      className="min-h-9 flex-row items-center gap-2 px-1 active:bg-hover-2"
                    >
                      <Text className="min-w-0 flex-1 text-[11.5px] text-ink-2" numberOfLines={1}>
                        {session.name}
                      </Text>
                      <Mono className="text-[9.5px]">{relativeTime(session.updated_at)}</Mono>
                    </Pressable>
                  ))}
                </View>
              ) : null}
            </View>
          )
        })}
      </View>
      {groups.length === 0 ? <EmptyState title="No projects" body="Sessions with a workspace appear here." /> : null}
    </View>
  )
}
