/**
 * Panel tabs that talk to the daemon — Git, Files, Browser, Rooms, Projects,
 * Terminals, the scratchpad and the run trace.
 *
 * QAI SIGNAL DECK — the workbench tools.
 * --------------------------------------
 * Same handlers the desktop calls through `/api/mobile/*`, same structure
 * (Git: branch + changed files + diff + commit; Files: lazy tree + reader
 * with git paths intact; Browser: CDP mirror with tap-to-click; Projects and
 * Rooms as pickers). Deck grammar throughout: signal-ticked PanelHeaders,
 * cut-corner cards, accent radio rings, inline Retry on every failure (a dead
 * end with no way out is a bug), content-sized skeletons so nothing reflows
 * when git/file data lands. Where the desktop hovers, these tap.
 *
 * Git/file/path functions are untouched — only the chrome around them is
 * restyled. Branch checkout/create, commit/push, log, worktrees, dir listing,
 * file reading, serve start/stop, browser goto/click/screenshot, terminal
 * create/close, scratchpad storage, and trace loading all call the same APIs
 * with the same payloads.
 */

import * as React from 'react'
import { ActivityIndicator, Image, Pressable, ScrollView, Text, View } from 'react-native'
import {
  ChevronRight,
  FileText,
  Folder,
  GitBranch,
  GitCommit,
  Layers,
  Play,
  Plus,
  RotateCw,
  Square,
  Terminal as TerminalIcon,
  Trash2,
} from 'lucide-react-native'
import { useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'

import { basename, cn, relativeTime } from '@/lib/format'
import type { Session } from '@/types/session'
import type { RootStackParamList } from '@app/navigation'
import {
  ApiError,
  browserApi,
  gitApi,
  mobileApi,
  roomsApi,
  terminalsApi,
  workspaceApi,
  type DirEntry,
} from '@app/lib/api'
import { storage } from '@app/lib/storage'
import { useStore } from '@app/store'
import { palette } from '@app/design/tokens'
import { rowEnterStyle, staggerDelay, useEnter } from '@app/components/motion'
import {
  Badge,
  Button,
  Card,
  Divider,
  EmptyState,
  ErrorState,
  Eyebrow,
  Field,
  IconButton,
  Mono,
  RowSkeleton,
  ToggleRow,
  Well,
  toast,
} from '@app/components/ui'
import { DiffCard } from '@app/components/chat/rows'
import { PanelHeader } from '@app/screens/SessionPanelScreen'

/* ── Shared bits ────────────────────────────────────────────────────────────── */

function RefreshButton({ onPress, busy }: { onPress: () => void; busy?: boolean }) {
  return (
    <IconButton label="Refresh" size={30} onPress={onPress}>
      <RotateCw size={15} color={busy ? palette.accent : palette.ink3} />
    </IconButton>
  )
}

/* ── Git ─────────────────────────────────────────────────────────────────────
 * The Git panel is three things stacked in the order you use them: what branch
 * you are on, what has changed, and a way to commit it. Each is a labelled
 * block with its own loading and error, so a slow log does not block a fast
 * file list.
 *
 * Branch creation and checkout live in an inline expansion rather than an
 * overlay, because a dropdown that opens over a diff on a phone is a dropdown
 * you cannot read. */

export function GitTab({ session }: { session: Session }) {
  const project = session.project
  const [git, setGit] = React.useState<Awaited<ReturnType<typeof gitApi.branches>> | null>(null)
  const [files, setFiles] = React.useState<Array<{ path: string; status?: string }>>([])
  const [diffs, setDiffs] = React.useState<Record<string, string>>({})
  const [openFile, setOpenFile] = React.useState<string | null>(null)
  const [message, setMessage] = React.useState('')
  const [push, setPush] = React.useState(false)
  const [busy, setBusy] = React.useState(false)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [note, setNote] = React.useState<string | null>(null)

  const [branchOpen, setBranchOpen] = React.useState(false)
  const [newBranch, setNewBranch] = React.useState('')
  const [branchBusy, setBranchBusy] = React.useState(false)

  const [logOpen, setLogOpen] = React.useState(false)
  const [commits, setCommits] = React.useState<
    Array<{ sha: string; message: string; author?: string; date?: string }>
  >([])
  const [logLoading, setLogLoading] = React.useState(false)

  const [worktreesOpen, setWorktreesOpen] = React.useState(false)
  const [worktrees, setWorktrees] = React.useState<Array<{ path: string; branch?: string }>>([])

  const load = React.useCallback(async () => {
    if (!project) {
      setLoading(false)
      return
    }
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
    } finally {
      setLoading(false)
    }
  }, [project, session.id])

  React.useEffect(() => {
    void load()
  }, [load])

  async function checkoutBranch(name: string) {
    if (!project || name === git?.current) return
    setBranchBusy(true)
    setError(null)
    try {
      await gitApi.checkout(project, name)
      setBranchOpen(false)
      await load()
      toast({ message: `Switched to ${name}`, tone: 'ok' })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Checkout failed')
    } finally {
      setBranchBusy(false)
    }
  }

  async function createBranch() {
    if (!project || !newBranch.trim()) return
    setBranchBusy(true)
    setError(null)
    try {
      await gitApi.createBranch(project, newBranch.trim())
      setNewBranch('')
      setBranchOpen(false)
      await load()
      toast({ message: `Created ${newBranch.trim()}`, tone: 'ok' })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Create branch failed')
    } finally {
      setBranchBusy(false)
    }
  }

  async function toggleLog() {
    if (logOpen) {
      setLogOpen(false)
      return
    }
    setLogOpen(true)
    if (!project) return
    setLogLoading(true)
    try {
      setCommits((await gitApi.log(project, 40)).commits ?? [])
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not read the commit log')
    } finally {
      setLogLoading(false)
    }
  }

  async function toggleWorktrees() {
    if (worktreesOpen) {
      setWorktreesOpen(false)
      return
    }
    setWorktreesOpen(true)
    try {
      setWorktrees((await workspaceApi.worktrees()).worktrees ?? [])
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not list worktrees')
    }
  }

  async function selectFile(path: string) {
    if (openFile === path) {
      setOpenFile(null)
      return
    }
    setOpenFile(path)
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
      setNote(result.pushed ? 'Committed and pushed.' : result.ok ? 'Committed.' : 'The commit failed.')
      setMessage('')
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Commit failed')
    } finally {
      setBusy(false)
    }
  }

  if (!project) {
    return (
      <View>
        <PanelHeader eyebrow="Git" />
        <EmptyState
          title="No workspace"
          body="This session has no folder, so there is no repository to diff or commit."
        />
      </View>
    )
  }

  return (
    <View className="gap-4">
      <PanelHeader
        eyebrow={`git · ${basename(project)}`}
        right={<RefreshButton onPress={() => void load()} busy={loading} />}
      />

      {error ? <ErrorState message={error} onRetry={() => void load()} /> : null}

      {/* ── Branch ──────────────────────────────────────────────────── */}
      <View className="gap-2">
        {loading && !git ? (
          <RowSkeleton />
        ) : git ? (
          <>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Branch ${git.current ?? 'detached'}. Tap to switch.`}
              accessibilityState={{ selected: branchOpen }}
              onPress={() => setBranchOpen((value) => !value)}
              hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
              className="h-9 flex-row items-center gap-2 self-start rounded-pill border border-line-strong bg-raised px-3.5 active:bg-hover"
            >
              <GitBranch size={14} color={palette.accent} />
              <Mono className="text-[12.5px] font-semibold text-ink">
                {git.current ?? 'detached'}
              </Mono>
              <ChevronRight
                size={12}
                color={palette.ink3}
                style={{ transform: [{ rotate: branchOpen ? '90deg' : '0deg' }] }}
              />
            </Pressable>

            <View className="flex-row items-center gap-2.5">
              <Mono className="text-[11.5px] text-ink-3" style={{ fontVariant: ['tabular-nums'] }}>
                {git.branches.length} branches
              </Mono>
              <Mono className="text-[11.5px] text-ok" style={{ fontVariant: ['tabular-nums'] }}>
                +{git.added}
              </Mono>
              <Mono className="text-[11.5px] text-danger" style={{ fontVariant: ['tabular-nums'] }}>
                −{git.removed}
              </Mono>
            </View>

            <View className="flex-row flex-wrap gap-2">
              <Button
                size="sm"
                variant="secondary"
                label="Commit history"
                icon={<GitCommit size={14} color={palette.ink2} />}
                onPress={() => void toggleLog()}
              />
              <Button
                size="sm"
                variant="secondary"
                label="Worktrees"
                icon={<Layers size={14} color={palette.ink2} />}
                onPress={() => void toggleWorktrees()}
              />
            </View>

            {branchOpen ? (
              <Card className="gap-3 p-4">
                <Eyebrow>Switch branch</Eyebrow>
                <ScrollView style={{ maxHeight: 200 }} nestedScrollEnabled>
                  <View className="gap-0.5">
                    {git.branches.map((branch) => {
                      const isCurrent = branch.name === git.current
                      return (
                        <Pressable
                          key={branch.name}
                          accessibilityRole="radio"
                          accessibilityLabel={branch.name}
                          accessibilityState={{ selected: isCurrent }}
                          disabled={branchBusy}
                          onPress={() => void checkoutBranch(branch.name)}
                          className="min-h-10 flex-row items-center gap-2.5 rounded-sm px-2"
                          style={({ pressed }) => ({
                            backgroundColor: isCurrent
                              ? palette.accentSoft
                              : pressed
                                ? palette.raised
                                : 'transparent',
                          })}
                        >
                          <View
                            className="size-1.5 rounded-full"
                            style={{ backgroundColor: isCurrent ? palette.accent : palette.ink4 }}
                          />
                          <Mono
                            className={cn('flex-1 text-[12.5px]', isCurrent ? 'text-ink' : 'text-ink-2')}
                            numberOfLines={1}
                          >
                            {branch.name}
                          </Mono>
                        </Pressable>
                      )
                    })}
                  </View>
                </ScrollView>

                <Divider />
                <Eyebrow>New branch</Eyebrow>
                <View className="flex-row items-center gap-2">
                  <Field
                    containerClassName="flex-1"
                    mono
                    value={newBranch}
                    onChangeText={setNewBranch}
                    placeholder="branch-name"
                    accessibilityLabel="New branch name"
                    autoCapitalize="none"
                    autoCorrect={false}
                  />
                  <Button
                    size="md"
                    variant="secondary"
                    label={branchBusy ? '…' : 'Create'}
                    disabled={branchBusy || !newBranch.trim()}
                    onPress={() => void createBranch()}
                  />
                </View>
              </Card>
            ) : null}

            {logOpen ? (
              <Card className="gap-2.5 p-4">
                <Eyebrow>Recent commits</Eyebrow>
                {logLoading ? (
                  <RowSkeleton />
                ) : commits.length === 0 ? (
                  <Text className="text-[13px] leading-[18px] text-ink-3">No commits found.</Text>
                ) : (
                  <View className="gap-1">
                    {commits.map((commitRow) => (
                      <View key={commitRow.sha} className="gap-0.5 rounded-sm px-2 py-1.5">
                        <View className="flex-row items-center gap-2">
                          <Mono className="text-[11px] font-semibold text-accent">
                            {commitRow.sha.slice(0, 7)}
                          </Mono>
                          {commitRow.author ? (
                            <Mono className="text-[10.5px] text-ink-3">{commitRow.author}</Mono>
                          ) : null}
                          <Mono className="ml-auto text-[10.5px] text-ink-3">
                            {commitRow.date?.slice(0, 10) ?? ''}
                          </Mono>
                        </View>
                        <Text className="text-[13px] leading-[18px] text-ink-2" numberOfLines={2}>
                          {commitRow.message}
                        </Text>
                      </View>
                    ))}
                  </View>
                )}
              </Card>
            ) : null}

            {worktreesOpen ? (
              <Card className="gap-2.5 p-4">
                <Eyebrow>Worktrees</Eyebrow>
                {worktrees.length === 0 ? (
                  <Text className="text-[13px] leading-[18px] text-ink-3">No additional worktrees.</Text>
                ) : (
                  worktrees.map((worktree) => (
                    <View key={worktree.path} className="flex-row items-center gap-2.5">
                      <Layers size={13} color={palette.ink3} />
                      <Mono className="min-w-0 flex-1 text-[12px] text-ink" numberOfLines={1}>
                        {worktree.path}
                      </Mono>
                      {worktree.branch ? (
                        <Badge tone="accent" outline>
                          {worktree.branch}
                        </Badge>
                      ) : null}
                    </View>
                  ))
                )}
              </Card>
            ) : null}
          </>
        ) : null}
      </View>

      {/* ── Changed files ───────────────────────────────────────────── */}
      <View className="gap-2">
        <Eyebrow>
          {files.length} changed {files.length === 1 ? 'file' : 'files'}
        </Eyebrow>
        {files.length === 0 ? (
          <View
            className="rounded-md p-3.5"
            style={{
              borderWidth: 1,
              borderStyle: 'dashed',
              borderColor: palette.line,
            }}
          >
            <Text className="text-[13px] leading-[18px] text-ink-3">Working tree clean.</Text>
          </View>
        ) : (
          <View className="gap-1.5">
            {files.map((file, index) => (
              <FileDiffRow
                key={file.path}
                file={file}
                index={index}
                diff={diffs[file.path]}
                open={openFile === file.path}
                onPress={() => void selectFile(file.path)}
              />
            ))}
          </View>
        )}
      </View>

      {/* ── Commit ──────────────────────────────────────────────────── */}
      {files.length > 0 ? (
        <Card className="gap-3 p-4">
          <Eyebrow>Commit</Eyebrow>
          <Field
            value={message}
            onChangeText={setMessage}
            placeholder="Describe what changed…"
            accessibilityLabel="Commit message"
            multiline
            style={{ minHeight: 72, textAlignVertical: 'top' }}
          />
          <ToggleRow label="Push after committing" value={push} onChange={setPush} />
          <Button
            variant="primary"
            label={busy ? 'Committing…' : `Commit ${files.length} ${files.length === 1 ? 'file' : 'files'}`}
            disabled={busy || message.trim().length === 0}
            onPress={() => void commit()}
          />
          {note ? <Text className="text-[12px] leading-[16px] text-ok">{note}</Text> : null}
        </Card>
      ) : null}
    </View>
  )
}

function FileDiffRow({
  file,
  index,
  diff,
  open,
  onPress,
}: {
  file: { path: string; status?: string }
  index: number
  diff?: string
  open: boolean
  onPress: () => void
}) {
  const enter = useEnter(staggerDelay(index), false)
  return (
    <View style={rowEnterStyle(enter)}>
      <View
        className="overflow-hidden rounded-md border bg-surface"
        style={{ borderColor: open ? palette.accentBorder : palette.line }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={file.path}
          accessibilityHint={open ? 'Hides the diff' : 'Shows the diff'}
          accessibilityState={{ expanded: open }}
          onPress={onPress}
          className="min-h-12 flex-row items-center gap-2.5 px-3.5 active:bg-raised"
        >
          {file.status ? (
            <Text
              style={{
                fontFamily: 'Menlo',
                fontSize: 11,
                fontWeight: '700',
                color: STATUS_COLOR[file.status] ?? palette.ink3,
              }}
            >
              {file.status}
            </Text>
          ) : null}
          <Mono className="min-w-0 flex-1 text-[12.5px] text-ink" numberOfLines={1}>
            {file.path}
          </Mono>
          <ChevronRight
            size={13}
            color={palette.ink4}
            style={{ transform: [{ rotate: open ? '90deg' : '0deg' }] }}
          />
        </Pressable>
        {open ? (
          diff ? (
            <DiffCard path={file.path} diff={diff} status={file.status} />
          ) : (
            <Text className="px-3.5 py-3 text-[12px] leading-[16px] text-ink-3">No diff for this file.</Text>
          )
        ) : null}
      </View>
    </View>
  )
}

const STATUS_COLOR: Record<string, string> = {
  M: palette.wait,
  A: palette.ok,
  '??': palette.ok,
  D: palette.danger,
  R: palette.info,
}

/* ── Files ────────────────────────────────────────────────────────────────────
 * A lazy directory browser with a reader. The reader is a *separate* screen
 * state rather than an inline expansion, because at phone width a file with
 * long lines either has to scroll horizontally or wrap; wrapping destroys
 * code, so it scrolls, and it deserves the full width of the panel. */

export function FilesTab({ session }: { session: Session }) {
  const project = session.project
  const [listing, setListing] = React.useState<Awaited<ReturnType<typeof workspaceApi.dirs>> | null>(null)
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)
  const [openFile, setOpenFile] = React.useState<{ path: string; contents: string } | null>(null)

  const load = React.useCallback(
    async (path?: string) => {
      setError(null)
      setLoading(true)
      try {
        setListing(await workspaceApi.dirs(path ?? project ?? undefined, true))
      } catch (cause) {
        setError(cause instanceof Error ? cause.message : 'Could not list the workspace')
      } finally {
        setLoading(false)
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
    const lines = openFile.contents.split('\n')
    return (
      <View className="gap-2.5">
        <PanelHeader
          eyebrow="File"
          right={
            <Button
              size="sm"
              variant="ghost"
              label="Back to list"
              onPress={() => setOpenFile(null)}
            />
          }
        />
        <Mono className="text-[12px] text-ink-2" numberOfLines={1}>
          {openFile.path}
        </Mono>
        <Well className="overflow-hidden rounded-lg border border-line">
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <ScrollView style={{ maxHeight: 460 }} nestedScrollEnabled>
              <View className="flex-row p-2.5">
                <Mono
                  className="pr-3 text-right text-[11px] leading-[18px] text-code-dim"
                  numberOfLines={lines.length}
                >
                  {lines.map((_, index) => String(index + 1)).join('\n')}
                </Mono>
                <Mono className="text-[12.5px] leading-[18px] text-code-ink" numberOfLines={lines.length}>
                  {openFile.contents}
                </Mono>
              </View>
            </ScrollView>
          </ScrollView>
        </Well>
      </View>
    )
  }

  return (
    <View className="gap-3">
      <PanelHeader
        eyebrow={`Files · ${basename(listing?.path ?? project ?? 'workspace')}`}
        right={<RefreshButton onPress={() => void load()} busy={loading} />}
      />

      {error ? <ErrorState message={error} onRetry={() => void load()} /> : null}

      {listing ? (
        <Card className="overflow-hidden">
          {listing.parent ? (
            <>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Go up one directory"
                onPress={() => void load(listing.parent)}
                className="min-h-12 flex-row items-center gap-2.5 px-4 active:bg-raised"
              >
                <Folder size={15} color={palette.ink3} />
                <Mono className="text-[13px] text-ink-2">..</Mono>
              </Pressable>
              <Divider />
            </>
          ) : null}
          {listing.entries.map((entry, index) => (
            <React.Fragment key={entry.path}>
              {index > 0 ? <Divider /> : null}
              <DirRow entry={entry} index={index} onPress={() => (entry.dir ? void load(entry.path) : void readFile(entry))} />
            </React.Fragment>
          ))}
          {listing.entries.length === 0 ? (
            <Text className="px-4 py-4 text-[13px] leading-[18px] text-ink-3">This directory is empty.</Text>
          ) : null}
        </Card>
      ) : loading ? (
        <RowSkeleton />
      ) : null}
    </View>
  )
}

function DirRow({
  entry,
  index,
  onPress,
}: {
  entry: DirEntry
  index: number
  onPress: () => void
}) {
  const enter = useEnter(staggerDelay(Math.min(index, 8)), false)
  return (
    <View style={rowEnterStyle(enter)}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={entry.name}
        accessibilityHint={entry.dir ? 'Opens this folder' : 'Opens this file'}
        onPress={onPress}
        className="min-h-12 flex-row items-center gap-2.5 px-4 active:bg-raised"
      >
        {entry.dir ? <Folder size={15} color={palette.ink3} /> : <FileText size={15} color={palette.ink3} />}
        <Mono className="min-w-0 flex-1 text-[13px] text-ink-2" numberOfLines={1}>
          {entry.name}
        </Mono>
        {entry.dir ? <ChevronRight size={13} color={palette.ink4} /> : null}
      </Pressable>
    </View>
  )
}

/* ── Browser ───────────────────────────────────────────────────────────────────
 * The CDP mirror. The desktop renders the live page as a screenshot and sends
 * clicks in page coordinates; the same works here — tapping the image maps the
 * touch back into the viewport the daemon reports, so manual actions land in
 * the transcript exactly like the agent's own steps.
 *
 * The workspace app server is a separate card rather than a field above the
 * screenshot, because "start a dev server" and "drive the page" are different
 * jobs and putting them in one form makes the first one look like a setting of
 * the second. */

const SCREENSHOT_INTERVAL_MS = 3000

const SERVE_PRESETS = [
  { label: 'npm run dev', command: 'npm run dev -- --port {port} --host 127.0.0.1' },
  { label: 'Vite', command: 'npx vite --port {port} --host 127.0.0.1 --strictPort' },
  { label: 'Next.js', command: 'npx next dev -p {port} -H 127.0.0.1' },
  { label: 'Static', command: '' },
]

export function BrowserTab({ session }: { session: Session }) {
  const project = session.project
  const [state, setState] = React.useState<Awaited<ReturnType<typeof browserApi.state>> | null>(null)
  const [shot, setShot] = React.useState<string | null>(null)
  const [url, setUrl] = React.useState('')
  const [busy, setBusy] = React.useState(false)
  const [error, setError] = React.useState<string | null>(null)
  const [size, setSize] = React.useState({ width: 1, height: 1 })
  const tabId = state?.tabs?.[0]?.id

  const [serveStatus, setServeStatus] = React.useState<{
    running?: boolean
    port?: number
  } | null>(null)
  const [serveCommand, setServeCommand] = React.useState('')
  const [serveBusy, setServeBusy] = React.useState(false)
  const [serveError, setServeError] = React.useState<string | null>(null)

  const refreshServe = React.useCallback(async () => {
    if (!project) return
    try {
      setServeStatus(await workspaceApi.serveStatus(project))
    } catch {
      /* the daemon may not expose this; the card simply stays unknown */
    }
  }, [project])

  React.useEffect(() => {
    void refreshServe()
    const timer = setInterval(() => void refreshServe(), 4000)
    return () => clearInterval(timer)
  }, [refreshServe])

  const refreshState = React.useCallback(async () => {
    try {
      const next = await browserApi.state(session.id)
      setState(next)
      if (next.tabs?.[0]?.url) setUrl((current) => current || next.tabs![0].url)
      setError(null)
      return next
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The browser engine is unavailable')
      return null
    }
  }, [session.id])

  const refreshShot = React.useCallback(async () => {
    if (!state?.ok || !tabId) return
    try {
      setShot(await browserApi.screenshot(session.id, tabId))
    } catch {
      /* a missed frame is not worth surfacing */
    }
  }, [session.id, state, tabId])

  React.useEffect(() => {
    void refreshState()
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

  async function serveStart() {
    if (!project) return
    setServeBusy(true)
    setServeError(null)
    try {
      const result = await workspaceApi.serveStart(project, serveCommand.trim() || undefined)
      if (result.ok && result.port) {
        const appUrl = `http://127.0.0.1:${result.port}`
        setUrl(appUrl)
        await refreshServe()
        if (state?.ok) {
          await browserApi.tool(session.id, 'browser_goto', { tab: tabId, url: appUrl })
        }
        toast({ message: `App server on :${result.port}`, tone: 'ok' })
      } else if (result.error) {
        setServeError(result.error)
      }
    } catch (cause) {
      setServeError(cause instanceof Error ? cause.message : 'Could not start the app server')
    } finally {
      setServeBusy(false)
    }
  }

  async function serveStop() {
    if (!project) return
    setServeBusy(true)
    try {
      await workspaceApi.serveStop(project)
      await refreshServe()
    } catch (cause) {
      setServeError(cause instanceof Error ? cause.message : 'Could not stop the app server')
    } finally {
      setServeBusy(false)
    }
  }

  const running = Boolean(state?.ok)

  return (
    <View className="gap-4">
      <PanelHeader
        eyebrow="Browser"
        right={<Badge tone={running ? 'ok' : 'muted'} outline>{running ? 'live' : 'stopped'}</Badge>}
      />

      {error ? <ErrorState message={error} onRetry={() => void refreshState()} /> : null}

      {project ? (
        <View className="gap-2.5">
          <Eyebrow>Workspace app server</Eyebrow>
          {serveError ? <ErrorState message={serveError} className="mt-1" /> : null}

          {serveStatus?.running ? (
            <Card className="gap-2.5 p-4">
              <Mono className="text-[13px] font-semibold text-ink">
                http://127.0.0.1:{serveStatus.port}
              </Mono>
              <View className="flex-row gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  label="Open in browser"
                  onPress={() => {
                    const target = `http://127.0.0.1:${serveStatus.port}`
                    setUrl(target)
                    if (state?.ok) void browserApi.tool(session.id, 'browser_goto', { tab: tabId, url: target })
                  }}
                />
                <Button
                  size="sm"
                  variant="danger"
                  label={serveBusy ? 'Stopping…' : 'Stop'}
                  disabled={serveBusy}
                  onPress={() => void serveStop()}
                />
              </View>
            </Card>
          ) : (
            <Card className="gap-2.5 p-4">
              <Text className="text-[12px] leading-[16px] text-ink-3">
                Start a local dev server to preview this workspace in the agent's browser.
              </Text>
              <View className="flex-row flex-wrap gap-1.5">
                {SERVE_PRESETS.map((preset) => {
                  const active = serveCommand === preset.command
                  return (
                    <Pressable
                      key={preset.label}
                      accessibilityRole="button"
                      accessibilityLabel={preset.label}
                      accessibilityState={{ selected: active }}
                      onPress={() => setServeCommand(preset.command)}
                      className="h-9 justify-center rounded-pill border px-3.5 active:bg-raised"
                      style={{
                        borderColor: active ? palette.accentBorder : palette.line,
                        backgroundColor: active ? palette.accentSoft : 'transparent',
                      }}
                    >
                      <Text
                        style={{
                          fontSize: 12,
                          lineHeight: 15,
                          fontWeight: active ? '700' : '500',
                          color: active ? palette.accent : palette.ink2,
                        }}
                      >
                        {preset.label}
                      </Text>
                    </Pressable>
                  )
                })}
              </View>
              <Field
                mono
                value={serveCommand}
                onChangeText={setServeCommand}
                placeholder="Command (blank serves static files)"
                accessibilityLabel="App server command"
                autoCapitalize="none"
                autoCorrect={false}
              />
              <Button
                size="sm"
                variant="secondary"
                label={serveBusy ? 'Starting…' : 'Run app'}
                icon={<Play size={14} color={palette.ink2} />}
                disabled={serveBusy}
                onPress={() => void serveStart()}
              />
            </Card>
          )}
        </View>
      ) : null}

      {!running ? (
        <View className="gap-3">
          <Text className="text-[13px] leading-[18px] text-ink-2">
            The built-in browser is not running for this session. Start it to mirror the page here
            and drive it by hand — the agent keeps using the same engine.
          </Text>
          <Button
            variant="primary"
            label={busy ? 'Starting…' : 'Start browser'}
            disabled={busy}
            onPress={() => void run(() => browserApi.start(session.id))}
          />
        </View>
      ) : (
        <View className="gap-2.5">
          <View className="flex-row items-center gap-2">
            <Field
              containerClassName="flex-1"
              value={url}
              onChangeText={setUrl}
              placeholder="https://…"
              accessibilityLabel="Address to navigate to"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
            />
            <Button
              size="md"
              variant="secondary"
              label="Go"
              disabled={busy || url.trim().length === 0}
              onPress={() =>
                void run(() => browserApi.tool(session.id, 'browser_goto', { tab: tabId, url: url.trim() }))
              }
            />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Stop the browser"
              onPress={() => void run(() => browserApi.stop(session.id))}
              className="size-12 items-center justify-center rounded-md border border-danger-border active:bg-danger-soft"
            >
              <Square size={13} color={palette.danger} fill={palette.danger} />
            </Pressable>
          </View>

          {shot ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="The mirrored page. Tap to click there."
              onPress={(event) => {
                const { locationX, locationY } = event.nativeEvent
                tapAt(locationX, locationY, size.width, size.height)
              }}
              onLayout={(event) => {
                const { width, height } = event.nativeEvent.layout
                setSize({ width: width || 1, height: height || 1 })
              }}
            >
              <Well className="overflow-hidden rounded-lg border border-line">
                <Image source={{ uri: shot }} resizeMode="contain" style={{ width: '100%', height: 300 }} />
              </Well>
            </Pressable>
          ) : (
            <Well className="h-[300px] items-center justify-center rounded-lg border border-line">
              <ActivityIndicator color={palette.ink3} />
              <Text className="mt-2 text-[12.5px] text-ink-3">Waiting for a frame…</Text>
            </Well>
          )}

          <View className="flex-row items-center gap-2">
            <Mono className="min-w-0 flex-1 text-[11.5px] text-ink-2" numberOfLines={1}>
              {state?.tabs?.[0]?.title || state?.tabs?.[0]?.url || 'about:blank'}
            </Mono>
            {state?.viewport ? (
              <Mono className="text-[11px] text-ink-3" style={{ fontVariant: ['tabular-nums'] }}>
                {state.viewport.width}×{state.viewport.height}
              </Mono>
            ) : null}
          </View>
          <Text className="text-[12px] leading-[16px] text-ink-3">
            Tap the page to click there. Actions run through the same tools the agent uses, so they
            appear in the transcript.
          </Text>
        </View>
      )}
    </View>
  )
}

/* ── Rooms ──────────────────────────────────────────────────────────────────── */

export function RoomsTab() {
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const [rooms, setRooms] = React.useState<Awaited<ReturnType<typeof roomsApi.list>>['rooms']>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  const load = React.useCallback(async () => {
    setError(null)
    try {
      setRooms((await roomsApi.list()).rooms ?? [])
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load rooms')
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    void load()
  }, [load])

  return (
    <View className="gap-3">
      <PanelHeader
        eyebrow="Rooms"
        right={<RefreshButton onPress={() => void load()} busy={loading} />}
      />
      {error ? <ErrorState message={error} onRetry={() => void load()} /> : null}
      {rooms.length === 0 && !loading ? (
        <EmptyState
          title="No rooms"
          body="A room is a roster of workers you can fan one task out to. Send /orchestrator inside a session to make one."
        />
      ) : (
        <View className="gap-1.5">
          {rooms.map((room, index) => (
            <RoomCard
              key={room.id}
              room={room}
              index={index}
              onPress={() => {
                if (!room.session_id) {
                  toast({ message: 'That room has no channel session yet', tone: 'muted' })
                  return
                }
                navigation.navigate('Session', { sessionId: room.session_id })
              }}
            />
          ))}
        </View>
      )}
    </View>
  )
}

function RoomCard({
  room,
  index,
  onPress,
}: {
  room: { id: string; name: string; session_id?: string; workers?: unknown }
  index: number
  onPress: () => void
}) {
  const enter = useEnter(staggerDelay(index), false)
  const workers = Array.isArray(room.workers) ? room.workers.length : 0
  return (
    <View style={rowEnterStyle(enter)}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={room.name}
        accessibilityHint={room.session_id ? 'Opens the room channel' : 'This room has no channel session yet'}
        onPress={onPress}
        className="min-h-[56px] flex-row items-center gap-3 rounded-lg border border-line bg-surface px-4 py-3 active:bg-raised"
      >
        <View className="size-2 rounded-full" style={{ backgroundColor: palette.accent }} />
        <Text className="min-w-0 flex-1 text-[14.5px] leading-[20px] text-ink" numberOfLines={1}>
          {room.name}
        </Text>
        {workers > 0 ? (
          <Badge tone="muted" outline>
            {workers} {workers === 1 ? 'worker' : 'workers'}
          </Badge>
        ) : null}
      </Pressable>
    </View>
  )
}

/* ── Projects ───────────────────────────────────────────────────────────────── */

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
    <View className="gap-3">
      <PanelHeader eyebrow={`Projects · ${groups.length}`} />
      {groups.length === 0 ? (
        <EmptyState title="No projects" body="Sessions with a workspace appear here." />
      ) : (
        <View className="gap-1.5">
          {groups.map(([project, list]) => {
            const expanded = open === project
            return (
              <View
                key={project}
                className="overflow-hidden rounded-lg border bg-surface"
                style={{ borderColor: expanded ? palette.accentBorder : palette.line }}
              >
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={project === '__inbox__' ? 'Inbox' : basename(project)}
                  accessibilityHint={`${list.length} sessions`}
                  accessibilityState={{ expanded }}
                  onPress={() => setOpen(expanded ? null : project)}
                  className="min-h-14 flex-row items-center gap-2.5 px-4 active:bg-raised"
                >
                  <ChevronRight
                    size={14}
                    color={palette.ink3}
                    style={{ transform: [{ rotate: expanded ? '90deg' : '0deg' }] }}
                  />
                  <Folder size={15} color={palette.ink3} />
                  <Text
                    className="min-w-0 flex-1 text-[15px] leading-[20px] font-medium text-ink"
                    numberOfLines={1}
                  >
                    {project === '__inbox__' ? 'Inbox' : basename(project)}
                  </Text>
                  <Mono className="text-[11.5px] text-ink-3" style={{ fontVariant: ['tabular-nums'] }}>
                    {list.length}
                  </Mono>
                </Pressable>
                {expanded ? (
                  <View className="border-t border-line py-1">
                    {list.map((session) => (
                      <Pressable
                        key={session.id}
                        accessibilityRole="button"
                        accessibilityLabel={session.name}
                        onPress={() => navigation.navigate('Session', { sessionId: session.id })}
                        className="min-h-11 flex-row items-center gap-2.5 pl-10 pr-4 active:bg-raised"
                      >
                        <Text className="min-w-0 flex-1 text-[13px] leading-[18px] text-ink-2" numberOfLines={1}>
                          {session.name}
                        </Text>
                        <Mono className="text-[11px] text-ink-3">{relativeTime(session.updated_at)}</Mono>
                      </Pressable>
                    ))}
                  </View>
                ) : null}
              </View>
            )
          })}
        </View>
      )}
    </View>
  )
}

/* ── Standalone terminals ────────────────────────────────────────────────────── */

export function TerminalsTab({ session }: { session: Session }) {
  const [terminals, setTerminals] = React.useState<Array<{ id: string; cwd?: string }>>([])
  const [busy, setBusy] = React.useState(false)
  const [newCwd, setNewCwd] = React.useState(session.project ?? '')
  const [error, setError] = React.useState<string | null>(null)
  const [loading, setLoading] = React.useState(true)

  const load = React.useCallback(async () => {
    setError(null)
    try {
      setTerminals((await terminalsApi.list()).terminals ?? [])
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not list terminals')
    } finally {
      setLoading(false)
    }
  }, [])

  React.useEffect(() => {
    void load()
  }, [load])

  async function create() {
    setBusy(true)
    try {
      await terminalsApi.create(newCwd.trim() || undefined)
      await load()
      toast({ message: 'Terminal created', tone: 'ok' })
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not create a terminal')
    } finally {
      setBusy(false)
    }
  }

  async function close(id: string) {
    setBusy(true)
    try {
      await terminalsApi.close(id)
      await load()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not close that terminal')
    } finally {
      setBusy(false)
    }
  }

  return (
    <View className="gap-4">
      <PanelHeader
        eyebrow="Standalone terminals"
        right={<RefreshButton onPress={() => void load()} busy={loading} />}
      />
      {error ? <ErrorState message={error} onRetry={() => void load()} /> : null}

      <Card className="gap-2.5 p-4">
        <Eyebrow>New terminal</Eyebrow>
        <Field
          mono
          value={newCwd}
          onChangeText={setNewCwd}
          placeholder="Working directory (blank = this workspace)"
          accessibilityLabel="Terminal working directory"
          autoCapitalize="none"
          autoCorrect={false}
        />
        <Button
          size="sm"
          variant="secondary"
          label={busy ? 'Creating…' : 'Create terminal'}
          icon={<Plus size={14} color={palette.ink2} />}
          disabled={busy}
          onPress={() => void create()}
        />
      </Card>

      <View className="gap-2">
        <Eyebrow>Active ({terminals.length})</Eyebrow>
        {terminals.length === 0 ? (
          <Text className="text-[13px] leading-[18px] text-ink-3">No standalone terminals are open.</Text>
        ) : (
          terminals.map((terminal) => (
            <View
              key={terminal.id}
              className="flex-row items-center gap-3 rounded-lg border border-line bg-surface py-2.5 pl-4 pr-2"
            >
              <TerminalIcon size={16} color={palette.accent} />
              <View className="min-w-0 flex-1">
                <Mono className="text-[12.5px] text-ink" numberOfLines={1}>
                  {terminal.id}
                </Mono>
                {terminal.cwd ? (
                  <Mono className="mt-0.5 text-[11px] text-ink-3" numberOfLines={1}>
                    {terminal.cwd}
                  </Mono>
                ) : null}
              </View>
              <IconButton
                label={`Close terminal ${terminal.id}`}
                size={34}
                disabled={busy}
                onPress={() => void close(terminal.id)}
              >
                <Trash2 size={15} color={palette.ink3} />
              </IconButton>
            </View>
          ))
        )}
      </View>
    </View>
  )
}

/* ── Scratchpad ─────────────────────────────────────────────────────────────────
 * Local, private, per-workspace. It lives on the *device*, not the desktop,
 * and it says so — a notes field that silently lives somewhere else is worse
 * than no notes field, because you will come back looking for what you wrote. */

export function SideTab({ session }: { session: Session }) {
  const key = `qai-side-${session.project || session.id}`
  const [notes, setNotes] = React.useState<string>(() => storage.getString(key) ?? '')

  function save(text: string) {
    setNotes(text)
    storage.set(key, text)
  }

  return (
    <View className="gap-3">
      <PanelHeader
        eyebrow="Scratchpad"
        right={
          notes ? (
            <Button
              size="sm"
              variant="danger"
              label="Clear"
              accessibilityLabel="Clear the scratchpad"
              onPress={() => save('')}
            />
          ) : null
        }
      />
      <Text className="text-[13px] leading-[18px] text-ink-3">
        Notes and a task checklist for this workspace, stored on this device only. Nothing here is
        sent to the desktop.
      </Text>
      <Field
        mono
        value={notes}
        onChangeText={save}
        placeholder="Notes, snippets, a todo list…"
        accessibilityLabel="Scratchpad notes"
        multiline
        style={{ minHeight: 220, lineHeight: 20, textAlignVertical: 'top' }}
      />
      <View className="flex-row flex-wrap gap-2">
        <ScratchpadInsert
          label="+ Todo list"
          onPress={() => save((notes ? `${notes}\n\n` : '') + '### Next steps\n- [ ] ')}
        />
        <ScratchpadInsert
          label="+ Bug report"
          onPress={() =>
            save((notes ? `${notes}\n\n` : '') + '### Bug reproduction\n- Steps:\n- Expected:\n- Actual:\n')
          }
        />
      </View>
    </View>
  )
}

function ScratchpadInsert({ label, onPress }: { label: string; onPress: () => void }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={onPress}
      hitSlop={8}
      className="h-9 items-center justify-center rounded-pill border border-line px-3.5 active:bg-raised"
    >
      <Mono className="text-[11.5px] text-ink-2">{label}</Mono>
    </Pressable>
  )
}

/* ── Run trace ──────────────────────────────────────────────────────────────────
 * Recorded timeline events for this run. Useful after the fact — "what did it
 * actually do while it said it was thinking" is the question a trace answers and
 * a transcript does not, because the transcript only shows what was reported. */

export function TrajectoriesTab({ session }: { session: Session }) {
  const [data, setData] = React.useState<Array<{ event?: string; timestamp?: string; summary?: string }>>([])
  const [loading, setLoading] = React.useState(true)
  const [error, setError] = React.useState<string | null>(null)

  const load = React.useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await mobileApi.trajectories(session.id)
      const list = (res.transcripts ?? res.events ?? []) as Array<Record<string, unknown>>
      setData(
        list.map((item, index) => ({
          event: String(item.kind ?? item.type ?? item.event ?? `step-${index + 1}`),
          timestamp: typeof item.timestamp === 'string' ? item.timestamp : undefined,
          summary:
            typeof item.content === 'string' ? item.content : JSON.stringify(item).slice(0, 160),
        })),
      )
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not load the run trace')
    } finally {
      setLoading(false)
    }
  }, [session.id])

  React.useEffect(() => {
    void load()
  }, [load])

  return (
    <View className="gap-3">
      <PanelHeader
        eyebrow="Run trace"
        right={<RefreshButton onPress={() => void load()} busy={loading} />}
      />
      {error ? <ErrorState message={error} onRetry={() => void load()} /> : null}
      {loading ? (
        <RowSkeleton />
      ) : data.length === 0 ? (
        <EmptyState
          title="No recorded trace"
          body="Recorded timeline events for this run appear here. Older daemons do not record them."
        />
      ) : (
        <View className="gap-1.5">
          {data.map((item, index) => (
            <TraceRow key={index} item={item} index={index} />
          ))}
        </View>
      )}
    </View>
  )
}

function TraceRow({
  item,
  index,
}: {
  item: { event?: string; timestamp?: string; summary?: string }
  index: number
}) {
  const enter = useEnter(staggerDelay(Math.min(index, 8)), false)
  return (
    <View style={rowEnterStyle(enter)}>
      <Card className="gap-1 p-4">
        <View className="flex-row items-center justify-between gap-2">
          <Mono className="text-[11.5px] font-semibold text-accent" numberOfLines={1}>
            {item.event}
          </Mono>
          {item.timestamp ? (
            <Mono className="shrink-0 text-[10.5px] text-ink-3">{relativeTime(item.timestamp)}</Mono>
          ) : null}
        </View>
        {item.summary ? (
          <Text className="text-[13px] leading-[18px] text-ink-2" numberOfLines={3}>
            {item.summary}
          </Text>
        ) : null}
      </Card>
    </View>
  )
}
