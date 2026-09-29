/**
 * Panel tabs that talk to the daemon — Git, Files, Browser, Rooms, Projects,
 * Terminals, the scratchpad and the run trace.
 *
 * These are the desktop right-rail views that need real backend data, so they
 * call the same handlers the desktop calls, through the authenticated
 * `/api/mobile/*` surface. The structure follows the desktop's: Git is branch +
 * changed files + diff + commit, Files is a lazy directory tree with a
 * line-numbered reader, Browser is the CDP mirror, Projects and Rooms are
 * pickers over sessions.
 *
 * Where the desktop reveals things on hover, these expand on tap — a phone has
 * no hover, and a control that only exists while a cursor is over it does not
 * exist.
 *
 * TWO THINGS EVERY ONE OF THESE GETS RIGHT
 * ----------------------------------------
 * 1. **An inline retry.** A failed fetch here is almost always a dropped
 *    connection, and the previous version rendered the error as a coloured
 *    strip with no way out of it. An error the user cannot act on is a dead
 *    end, so every one of these has a Retry that re-runs the load.
 * 2. **Content-sized loading.** A spinner where a list will go means the
 *    layout jumps twice; these show a skeleton in the shape of the content
 *    whenever the shape is knowable, so nothing reflows when the data lands.
 */

import * as React from 'react'
import {
  ActivityIndicator,
  Image,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
} from 'react-native'
import {
  ChevronRight,
  FileText,
  Folder,
  GitBranch,
  GitCommit,
  Layers,
  Play,
  Plus,
  RefreshCw,
  Square,
  Terminal as TerminalIcon,
  Trash2,
} from 'lucide-react-native'
import { useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'

import { basename, relativeTime } from '@/lib/format'
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
import { palette, radius } from '@app/design/tokens'
import { rowEnterStyle, staggerDelay, useEnter } from '@app/components/motion'
import {
  Badge,
  Button,
  EmptyState,
  ErrorState,
  Eyebrow,
  Mono,
  ToggleRow,
  Well,
  toast,
} from '@app/components/ui'
import { DiffCard } from '@app/components/chat/rows'
import { PanelHeader } from '@app/screens/SessionPanelScreen'

/* ── Shared bits ────────────────────────────────────────────────────────────── */

function RefreshButton({ onPress, busy }: { onPress: () => void; busy?: boolean }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel="Refresh"
      onPress={onPress}
      hitSlop={10}
      style={({ pressed }) => ({
        width: 30,
        height: 30,
        alignItems: 'center',
        justifyContent: 'center',
        borderRadius: radius.pill,
        backgroundColor: pressed ? palette.raised : 'transparent',
      })}
    >
      <RefreshCw size={15} color={busy ? palette.accent : palette.ink3} />
    </Pressable>
  )
}

/* ── Git ─────────────────────────────────────────────────────────────────────
 * The Git panel is three things stacked in the order you use them: what branch
 * you are on, what has changed, and a way to commit it. Each is a labelled
 * block with its own loading and error, so a slow log does not block a fast
 * file list.
 *
 * Branch creation and checkout live in a picker rather than an inline
 * dropdown, because a dropdown that opens over a diff on a phone is a dropdown
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
    <View style={{ gap: 16 }}>
      <PanelHeader
        eyebrow={`git · ${basename(project)}`}
        right={<RefreshButton onPress={() => void load()} busy={loading} />}
      />

      {error ? <ErrorState message={error} onRetry={() => void load()} /> : null}

      {/* ── Branch ──────────────────────────────────────────────────── */}
      <View style={{ gap: 8 }}>
        {loading && !git ? (
          <ActivityIndicator color={palette.accent} />
        ) : git ? (
          <>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Branch ${git.current ?? 'detached'}. Tap to switch.`}
              onPress={() => setBranchOpen((value) => !value)}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: 9,
                alignSelf: 'flex-start',
                borderRadius: radius.pill,
                borderWidth: 1,
                borderColor: palette.line,
                backgroundColor: pressed ? palette.raised : palette.well,
                paddingLeft: 11,
                paddingRight: 9,
                paddingVertical: 8,
              })}
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

            <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
              <Mono className="text-[11.5px] text-ink-3">{git.branches.length} branches</Mono>
              <Mono className="text-[11.5px] text-diff-add">+{git.added}</Mono>
              <Mono className="text-[11.5px] text-diff-del">−{git.removed}</Mono>
            </View>

            <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
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
              <View
                style={{
                  gap: 8,
                  borderRadius: radius.md,
                  borderWidth: 1,
                  borderColor: palette.line,
                  backgroundColor: palette.well,
                  padding: 12,
                }}
              >
                <Eyebrow>Switch branch</Eyebrow>
                <ScrollView style={{ maxHeight: 200 }} nestedScrollEnabled>
                  <View style={{ gap: 2 }}>
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
                          style={({ pressed }) => ({
                            flexDirection: 'row',
                            alignItems: 'center',
                            gap: 9,
                            minHeight: 40,
                            borderRadius: radius.sm,
                            paddingHorizontal: 8,
                            backgroundColor: isCurrent ? palette.accentSoft : pressed ? palette.raised : 'transparent',
                          })}
                        >
                          <View
                            style={{
                              width: 6,
                              height: 6,
                              borderRadius: 3,
                              backgroundColor: isCurrent ? palette.accent : palette.ink4,
                            }}
                          />
                          <Mono
                            className="flex-1 text-[12.5px]"
                            style={{ color: isCurrent ? palette.ink : palette.ink2 }}
                            numberOfLines={1}
                          >
                            {branch.name}
                          </Mono>
                        </Pressable>
                      )
                    })}
                  </View>
                </ScrollView>

                <View style={{ height: 1, backgroundColor: palette.line }} />
                <Eyebrow>New branch</Eyebrow>
                <View style={{ flexDirection: 'row', gap: 8 }}>
                  <TextInput
                    value={newBranch}
                    onChangeText={setNewBranch}
                    placeholder="branch-name"
                    placeholderTextColor={palette.ink4}
                    accessibilityLabel="New branch name"
                    autoCapitalize="none"
                    autoCorrect={false}
                    className="min-h-11 flex-1 rounded-md border border-line bg-field px-3 text-[13px] text-ink"
                    style={{ fontFamily: 'Menlo' }}
                  />
                  <Button
                    size="sm"
                    variant="secondary"
                    label={branchBusy ? '…' : 'Create'}
                    disabled={branchBusy || !newBranch.trim()}
                    onPress={() => void createBranch()}
                  />
                </View>
              </View>
            ) : null}

            {logOpen ? (
              <View
                style={{
                  gap: 8,
                  borderRadius: radius.md,
                  borderWidth: 1,
                  borderColor: palette.line,
                  backgroundColor: palette.well,
                  padding: 12,
                }}
              >
                <Eyebrow>Recent commits</Eyebrow>
                {logLoading ? (
                  <ActivityIndicator color={palette.accent} />
                ) : commits.length === 0 ? (
                  <Text className="text-[13px] text-ink-3">No commits found.</Text>
                ) : (
                  <View style={{ gap: 2 }}>
                    {commits.map((commitRow) => (
                      <View
                        key={commitRow.sha}
                        style={{
                          gap: 2,
                          borderRadius: radius.sm,
                          paddingHorizontal: 8,
                          paddingVertical: 7,
                        }}
                      >
                        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
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
              </View>
            ) : null}

            {worktreesOpen ? (
              <View
                style={{
                  gap: 8,
                  borderRadius: radius.md,
                  borderWidth: 1,
                  borderColor: palette.line,
                  backgroundColor: palette.well,
                  padding: 12,
                }}
              >
                <Eyebrow>Worktrees</Eyebrow>
                {worktrees.length === 0 ? (
                  <Text className="text-[13px] text-ink-3">No additional worktrees.</Text>
                ) : (
                  worktrees.map((worktree) => (
                    <View key={worktree.path} style={{ flexDirection: 'row', alignItems: 'center', gap: 9 }}>
                      <Layers size={13} color={palette.ink3} />
                      <Mono className="flex-1 text-[12px] text-ink" numberOfLines={1}>
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
              </View>
            ) : null}
          </>
        ) : null}
      </View>

      {/* ── Changed files ───────────────────────────────────────────── */}
      <View style={{ gap: 8 }}>
        <Eyebrow>
          {files.length} changed {files.length === 1 ? 'file' : 'files'}
        </Eyebrow>
        {files.length === 0 ? (
          <View
            style={{
              borderRadius: radius.md,
              borderWidth: 1,
              borderStyle: 'dashed',
              borderColor: palette.line,
              padding: 14,
            }}
          >
            <Text className="text-[13.5px] text-ink-3">Working tree clean.</Text>
          </View>
        ) : (
          <View style={{ gap: 6 }}>
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
        <View style={{ gap: 8 }}>
          <View style={{ height: 1, backgroundColor: palette.line }} />
          <Eyebrow>Commit</Eyebrow>
          <TextInput
            value={message}
            onChangeText={setMessage}
            placeholder="Describe what changed…"
            placeholderTextColor={palette.ink4}
            accessibilityLabel="Commit message"
            multiline
            className="min-h-[72px] rounded-md border border-line bg-field px-3.5 py-3 text-[14px] leading-[20px] text-ink"
          />
          <ToggleRow label="Push after committing" value={push} onChange={setPush} />
          <Button
            variant="primary"
            label={busy ? 'Committing…' : `Commit ${files.length} ${files.length === 1 ? 'file' : 'files'}`}
            disabled={busy || message.trim().length === 0}
            onPress={() => void commit()}
          />
          {note ? (
            <Text className="text-[12.5px]" style={{ color: palette.ok }}>
              {note}
            </Text>
          ) : null}
        </View>
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
        style={{
          borderRadius: radius.md,
          borderWidth: 1,
          borderColor: open ? palette.accentBorder : palette.line,
          backgroundColor: palette.surface,
          overflow: 'hidden',
        }}
      >
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={file.path}
          accessibilityHint={open ? 'Hides the diff' : 'Shows the diff'}
          accessibilityState={{ expanded: open }}
          onPress={onPress}
          style={({ pressed }) => ({
            flexDirection: 'row',
            alignItems: 'center',
            gap: 9,
            minHeight: 44,
            paddingHorizontal: 12,
            backgroundColor: pressed ? palette.raised : 'transparent',
          })}
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
            <Text className="px-3 py-3 text-[12.5px] text-ink-3">No diff for this file.</Text>
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
      <View style={{ gap: 10 }}>
        <PanelHeader
          eyebrow="File"
          right={
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Back to the file list"
              onPress={() => setOpenFile(null)}
              hitSlop={10}
            >
              <Text className="text-[12.5px] font-semibold text-accent">Back to list</Text>
            </Pressable>
          }
        />
        <Mono className="text-[12px] text-ink-2" numberOfLines={1}>
          {openFile.path}
        </Mono>
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <ScrollView style={{ maxHeight: 460 }} nestedScrollEnabled>
            <View style={{ flexDirection: 'row', padding: 10, borderRadius: radius.md, backgroundColor: palette.code }}>
              <Mono
                className="pr-3 text-right text-[10.5px] leading-[16px] text-ink-4"
                numberOfLines={lines.length}
              >
                {lines.map((_, index) => String(index + 1)).join('\n')}
              </Mono>
              <Mono className="text-[12px] leading-[16px] text-code-ink" numberOfLines={lines.length}>
                {openFile.contents}
              </Mono>
            </View>
          </ScrollView>
        </ScrollView>
      </View>
    )
  }

  return (
    <View style={{ gap: 12 }}>
      <PanelHeader
        eyebrow={`Files · ${basename(listing?.path ?? project ?? 'workspace')}`}
        right={<RefreshButton onPress={() => void load()} busy={loading} />}
      />

      {error ? <ErrorState message={error} onRetry={() => void load()} /> : null}

      {listing ? (
        <View style={{ gap: 1 }}>
          {listing.parent ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Go up one directory"
              onPress={() => void load(listing.parent)}
              style={({ pressed }) => ({
                flexDirection: 'row',
                alignItems: 'center',
                gap: 10,
                minHeight: 44,
                borderRadius: radius.sm,
                paddingHorizontal: 10,
                backgroundColor: pressed ? palette.raised : 'transparent',
              })}
            >
              <Folder size={15} color={palette.ink3} />
              <Mono className="text-[13px] text-ink-2">..</Mono>
            </Pressable>
          ) : null}
          {listing.entries.map((entry, index) => (
            <DirRow key={entry.path} entry={entry} index={index} onPress={() => (entry.dir ? void load(entry.path) : void readFile(entry))} />
          ))}
          {listing.entries.length === 0 ? (
            <Text className="px-2 py-4 text-[13.5px] text-ink-3">This directory is empty.</Text>
          ) : null}
        </View>
      ) : loading ? (
        <ActivityIndicator color={palette.accent} />
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
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
          minHeight: 44,
          borderRadius: radius.sm,
          paddingHorizontal: 10,
          backgroundColor: pressed ? palette.raised : 'transparent',
        })}
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
    <View style={{ gap: 16 }}>
      <PanelHeader
        eyebrow="Browser"
        right={<Badge tone={running ? 'ok' : 'muted'} outline>{running ? 'live' : 'stopped'}</Badge>}
      />

      {error ? <ErrorState message={error} onRetry={() => void refreshState()} /> : null}

      {project ? (
        <View style={{ gap: 9 }}>
          <Eyebrow>Workspace app server</Eyebrow>
          {serveError ? (
            <View
              style={{
                borderRadius: radius.sm,
                borderWidth: 1,
                borderColor: palette.dangerBorder,
                backgroundColor: palette.dangerSoft,
                padding: 10,
              }}
            >
              <Text className="text-[12.5px] leading-[17px] text-danger">{serveError}</Text>
            </View>
          ) : null}

          {serveStatus?.running ? (
            <View
              style={{
                gap: 9,
                borderRadius: radius.md,
                borderWidth: 1,
                borderColor: palette.line,
                backgroundColor: palette.well,
                padding: 12,
              }}
            >
              <Mono className="text-[13px] font-semibold text-ink">
                http://127.0.0.1:{serveStatus.port}
              </Mono>
              <View style={{ flexDirection: 'row', gap: 8 }}>
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
            </View>
          ) : (
            <View
              style={{
                gap: 9,
                borderRadius: radius.md,
                borderWidth: 1,
                borderColor: palette.line,
                backgroundColor: palette.well,
                padding: 12,
              }}
            >
              <Text className="text-[12.5px] leading-[17px] text-ink-3">
                Start a local dev server to preview this workspace in the agent's browser.
              </Text>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6 }}>
                {SERVE_PRESETS.map((preset) => {
                  const active = serveCommand === preset.command
                  return (
                    <Pressable
                      key={preset.label}
                      accessibilityRole="button"
                      accessibilityLabel={preset.label}
                      accessibilityState={{ selected: active }}
                      onPress={() => setServeCommand(preset.command)}
                      style={({ pressed }) => ({
                        minHeight: 34,
                        justifyContent: 'center',
                        borderRadius: radius.sm,
                        borderWidth: 1,
                        borderColor: active ? palette.accent : palette.line,
                        backgroundColor: active ? palette.accentSoft : pressed ? palette.raised : 'transparent',
                        paddingHorizontal: 11,
                      })}
                    >
                      <Text
                        style={{
                          fontSize: 12,
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
              <TextInput
                value={serveCommand}
                onChangeText={setServeCommand}
                placeholder="Command (blank serves static files)"
                placeholderTextColor={palette.ink4}
                accessibilityLabel="App server command"
                autoCapitalize="none"
                autoCorrect={false}
                className="min-h-11 rounded-md border border-line bg-field px-3 text-[12px] text-ink"
                style={{ fontFamily: 'Menlo' }}
              />
              <Button
                size="sm"
                variant="secondary"
                label={serveBusy ? 'Starting…' : 'Run app'}
                icon={<Play size={14} color={palette.ink2} />}
                disabled={serveBusy}
                onPress={() => void serveStart()}
              />
            </View>
          )}
        </View>
      ) : null}

      {!running ? (
        <View style={{ gap: 11 }}>
          <Text className="text-[13.5px] leading-[19px] text-ink-2">
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
        <View style={{ gap: 10 }}>
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <TextInput
              value={url}
              onChangeText={setUrl}
              placeholder="https://…"
              placeholderTextColor={palette.ink4}
              accessibilityLabel="Address to navigate to"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              className="min-h-12 flex-1 rounded-md border border-line bg-field px-3 text-[14px] text-ink"
            />
            <Button
              size="sm"
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
              style={({ pressed }) => ({
                width: 44,
                height: 44,
                alignItems: 'center',
                justifyContent: 'center',
                borderRadius: radius.md,
                borderWidth: 1,
                borderColor: palette.dangerBorder,
                backgroundColor: pressed ? palette.dangerSoft : 'transparent',
              })}
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
              style={{
                borderRadius: radius.md,
                borderWidth: 1,
                borderColor: palette.line,
                overflow: 'hidden',
              }}
            >
              <Well>
                <Image source={{ uri: shot }} resizeMode="contain" style={{ width: '100%', height: 300 }} />
              </Well>
            </Pressable>
          ) : (
            <Well
              className="h-[300px] items-center justify-center border border-line"
              style={{ borderRadius: radius.md }}
            >
              <ActivityIndicator color={palette.ink3} />
              <Text className="mt-2 text-[12.5px] text-ink-3">Waiting for a frame…</Text>
            </Well>
          )}

          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
            <Mono className="min-w-0 flex-1 text-[11.5px] text-ink-2" numberOfLines={1}>
              {state?.tabs?.[0]?.title || state?.tabs?.[0]?.url || 'about:blank'}
            </Mono>
            {state?.viewport ? (
              <Mono className="text-[11px] text-ink-3">
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
    <View style={{ gap: 12 }}>
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
        <View style={{ gap: 6 }}>
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
        style={({ pressed }) => ({
          flexDirection: 'row',
          alignItems: 'center',
          gap: 11,
          borderRadius: radius.md,
          borderWidth: 1,
          borderColor: palette.line,
          backgroundColor: pressed ? palette.raised : palette.well,
          paddingHorizontal: 13,
          paddingVertical: 12,
          minHeight: 52,
        })}
      >
        <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: palette.accent }} />
        <Text className="min-w-0 flex-1 text-[14.5px] text-ink" numberOfLines={1}>
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
    <View style={{ gap: 12 }}>
      <PanelHeader eyebrow={`Projects · ${groups.length}`} />
      {groups.length === 0 ? (
        <EmptyState title="No projects" body="Sessions with a workspace appear here." />
      ) : (
        <View style={{ gap: 6 }}>
          {groups.map(([project, list]) => {
            const expanded = open === project
            return (
              <View
                key={project}
                style={{
                  borderRadius: radius.md,
                  borderWidth: 1,
                  borderColor: expanded ? palette.accentBorder : palette.line,
                  backgroundColor: palette.well,
                  overflow: 'hidden',
                }}
              >
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={project === '__inbox__' ? 'Inbox' : basename(project)}
                  accessibilityHint={`${list.length} sessions`}
                  accessibilityState={{ expanded }}
                  onPress={() => setOpen(expanded ? null : project)}
                  style={({ pressed }) => ({
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 9,
                    minHeight: 50,
                    paddingHorizontal: 12,
                    backgroundColor: pressed ? palette.raised : 'transparent',
                  })}
                >
                  <ChevronRight
                    size={14}
                    color={palette.ink3}
                    style={{ transform: [{ rotate: expanded ? '90deg' : '0deg' }] }}
                  />
                  <Folder size={15} color={palette.ink3} />
                  <Text className="min-w-0 flex-1 text-[14.5px] font-medium text-ink" numberOfLines={1}>
                    {project === '__inbox__' ? 'Inbox' : basename(project)}
                  </Text>
                  <Mono className="text-[11.5px] text-ink-3">{list.length}</Mono>
                </Pressable>
                {expanded ? (
                  <View style={{ borderTopWidth: 1, borderTopColor: palette.line, paddingVertical: 4 }}>
                    {list.map((session) => (
                      <Pressable
                        key={session.id}
                        accessibilityRole="button"
                        accessibilityLabel={session.name}
                        onPress={() => navigation.navigate('Session', { sessionId: session.id })}
                        style={({ pressed }) => ({
                          flexDirection: 'row',
                          alignItems: 'center',
                          gap: 9,
                          minHeight: 42,
                          paddingLeft: 40,
                          paddingRight: 12,
                          backgroundColor: pressed ? palette.raised : 'transparent',
                        })}
                      >
                        <Text className="min-w-0 flex-1 text-[13.5px] text-ink-2" numberOfLines={1}>
                          {session.name}
                        </Text>
                        <Mono className="text-[11px]">{relativeTime(session.updated_at)}</Mono>
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
    <View style={{ gap: 16 }}>
      <PanelHeader
        eyebrow="Standalone terminals"
        right={<RefreshButton onPress={() => void load()} busy={loading} />}
      />
      {error ? <ErrorState message={error} onRetry={() => void load()} /> : null}

      <View
        style={{
          gap: 9,
          borderRadius: radius.md,
          borderWidth: 1,
          borderColor: palette.line,
          backgroundColor: palette.well,
          padding: 12,
        }}
      >
        <Eyebrow>New terminal</Eyebrow>
        <TextInput
          value={newCwd}
          onChangeText={setNewCwd}
          placeholder="Working directory (blank = this workspace)"
          placeholderTextColor={palette.ink4}
          accessibilityLabel="Terminal working directory"
          autoCapitalize="none"
          autoCorrect={false}
          className="min-h-11 rounded-md border border-line bg-field px-3 text-[12.5px] text-ink"
          style={{ fontFamily: 'Menlo' }}
        />
        <Button
          size="sm"
          variant="secondary"
          label={busy ? 'Creating…' : 'Create terminal'}
          icon={<Plus size={14} color={palette.ink2} />}
          disabled={busy}
          onPress={() => void create()}
        />
      </View>

      <View style={{ gap: 8 }}>
        <Eyebrow>Active ({terminals.length})</Eyebrow>
        {terminals.length === 0 ? (
          <Text className="text-[13.5px] text-ink-3">No standalone terminals are open.</Text>
        ) : (
          terminals.map((terminal) => (
            <View
              key={terminal.id}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 11,
                borderRadius: radius.md,
                borderWidth: 1,
                borderColor: palette.line,
                backgroundColor: palette.well,
                paddingLeft: 13,
                paddingRight: 6,
                paddingVertical: 9,
              }}
            >
              <TerminalIcon size={15} color={palette.accent} />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Mono className="text-[12.5px] text-ink" numberOfLines={1}>
                  {terminal.id}
                </Mono>
                {terminal.cwd ? (
                  <Mono className="mt-0.5 text-[11px] text-ink-3" numberOfLines={1}>
                    {terminal.cwd}
                  </Mono>
                ) : null}
              </View>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel={`Close terminal ${terminal.id}`}
                disabled={busy}
                onPress={() => void close(terminal.id)}
                style={({ pressed }) => ({
                  width: 34,
                  height: 34,
                  alignItems: 'center',
                  justifyContent: 'center',
                  borderRadius: radius.pill,
                  backgroundColor: pressed ? palette.dangerSoft : 'transparent',
                })}
              >
                <Trash2 size={15} color={palette.ink3} />
              </Pressable>
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
  const key = `agentdeck-side-${session.project || session.id}`
  const [notes, setNotes] = React.useState<string>(() => storage.getString(key) ?? '')

  function save(text: string) {
    setNotes(text)
    storage.set(key, text)
  }

  return (
    <View style={{ gap: 12 }}>
      <PanelHeader
        eyebrow="Scratchpad"
        right={
          notes ? (
            <Pressable accessibilityRole="button" accessibilityLabel="Clear the scratchpad" onPress={() => save('')} hitSlop={10}>
              <Text className="text-[12px] font-semibold text-danger">Clear</Text>
            </Pressable>
          ) : null
        }
      />
      <Text className="text-[13px] leading-[18px] text-ink-3">
        Notes and a task checklist for this workspace, stored on this device only. Nothing here is
        sent to the desktop.
      </Text>
      <TextInput
        value={notes}
        onChangeText={save}
        placeholder="Notes, snippets, a todo list…"
        placeholderTextColor={palette.ink4}
        accessibilityLabel="Scratchpad notes"
        multiline
        className="min-h-[220px] rounded-md border border-line bg-field px-3.5 py-3 text-[13.5px] leading-[20px] text-ink"
        style={{ fontFamily: 'Menlo', textAlignVertical: 'top' }}
      />
      <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 7 }}>
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
      style={({ pressed }) => ({
        minHeight: 34,
        justifyContent: 'center',
        borderRadius: radius.sm,
        borderWidth: 1,
        borderColor: palette.line,
        backgroundColor: pressed ? palette.raised : palette.well,
        paddingHorizontal: 11,
      })}
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
    <View style={{ gap: 12 }}>
      <PanelHeader
        eyebrow="Run trace"
        right={<RefreshButton onPress={() => void load()} busy={loading} />}
      />
      {error ? <ErrorState message={error} onRetry={() => void load()} /> : null}
      {loading ? (
        <ActivityIndicator color={palette.accent} />
      ) : data.length === 0 ? (
        <EmptyState
          title="No recorded trace"
          body="Recorded timeline events for this run appear here. Older daemons do not record them."
        />
      ) : (
        <View style={{ gap: 6 }}>
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
      <View
        style={{
          gap: 4,
          borderRadius: radius.md,
          borderWidth: 1,
          borderColor: palette.line,
          backgroundColor: palette.well,
          padding: 12,
        }}
      >
        <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
          <Mono className="text-[11px] font-semibold text-accent" numberOfLines={1}>
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
      </View>
    </View>
  )
}
