/**
 * workspace — the desktop's right rail, page for page, on a phone.
 *
 * The desktop keeps a browser-style panel of pages beside the conversation:
 * plan, agents, git diff, git files, goal, browser, files, projects,
 * sub-sessions, side, rooms, terminal. A phone has no room beside anything, so
 * the whole set opens as a bottom sheet with a page strip on top — the
 * conversation stays where it is and the pages are one tap apart.
 *
 * Every page here is the desktop's, under the desktop's name, so the two
 * surfaces stay learnable together. Each one reads what the phone actually
 * holds — the transcript it already streamed, plus the session list — and says
 * plainly where a page needs something only the desktop has, rather than
 * rendering a spinner for data the device was never sent.
 */

import * as React from 'react'
import { ScrollView, View } from 'react-native'

import type { Conversation, Message } from '@/types/conversation'
import type { Session } from '@/types/session'
import { latestPlanInfo, latestUserPrompt, deriveSubagents } from '@/lib/sessionView'
import { uiStateDisplay } from '@/lib/sessionState'
import { basename, cn } from '@/lib/format'
import { workspaceApi, type WorkspaceOverview } from '@/lib/api'
import { useStore } from '@/store'
import { color } from '../design/tokens'
import { MONO, W_SEMI } from '../design/fonts'
import { Bot, Check, ChevronLeft, ChevronRight, Close, Folder, Panel, Pencil, Plus, Star, Trash } from '../design/icons'
import { Loader, Pill, Tap, Text, haptic } from '../ui'

/* The desktop's registry (`dashboard/src/components/desktop/session/rightTabs.ts`),
   in the same order. */
export type WorkspacePage =
  | 'plan'
  | 'agents'
  | 'git-diff'
  | 'git-files'
  | 'goal'
  | 'browser'
  | 'files'
  | 'projects'
  | 'subsessions'
  | 'side'
  | 'rooms'
  | 'terminal'

export const WORKSPACE_PAGES: WorkspacePage[] = [
  'plan',
  'agents',
  'git-diff',
  'git-files',
  'goal',
  'browser',
  'files',
  'projects',
  'subsessions',
  'side',
  'rooms',
  'terminal',
]

const LABELS: Record<WorkspacePage, string> = {
  plan: 'Plan',
  agents: 'Agents',
  'git-diff': 'Git diff',
  'git-files': 'Git files',
  goal: 'Goal',
  browser: 'Browser',
  files: 'Files',
  projects: 'Projects',
  subsessions: 'Sub-sessions',
  side: 'Side',
  rooms: 'Rooms',
  terminal: 'Terminal',
}

/** The page strip — chips that scroll, matching the home filter strip. */
export function WorkspaceTabs({
  value,
  onChange,
}: {
  value: WorkspacePage
  onChange: (next: WorkspacePage) => void
}) {
  return (
    <ScrollView
      horizontal
      showsHorizontalScrollIndicator={false}
      contentContainerStyle={{ gap: 8, paddingHorizontal: 16, paddingTop: 12, paddingBottom: 10 }}
    >
      {WORKSPACE_PAGES.map((id) => {
        const on = id === value
        return (
          <Tap
            key={id}
            accessibilityRole="tab"
            accessibilityState={{ selected: on }}
            onPress={() => {
              void haptic('select')
              onChange(id)
            }}
            hitSlop={{ top: 6, bottom: 6, left: 2, right: 2 }}
            className={
              on
                ? 'h-chip shrink-0 flex-row items-center rounded-pill bg-white px-3.5'
                : 'h-chip shrink-0 flex-row items-center rounded-pill bg-field px-3.5'
            }
          >
            <Text className={on ? 'text-sub font-semibold text-black' : 'text-sub font-medium text-ink-2'}>{LABELS[id]}</Text>
          </Tap>
        )
      })}
    </ScrollView>
  )
}

export function WorkspacePageBody({
  page,
  session,
  conversation,
  onOpenSession,
}: {
  page: WorkspacePage
  session: Session
  conversation: Conversation | undefined
  /** Switch to another session from the Sub-sessions page — the desktop's own
   *  way to move between the sessions of one workspace. */
  onOpenSession?: (sessionId: string) => void
}) {
  const messages = React.useMemo(() => conversation?.messages ?? [], [conversation])

  switch (page) {
    case 'plan':
      return <PlanPage messages={messages} />
    case 'agents':
      return <AgentsPage messages={messages} session={session} />
    case 'goal':
      return <GoalPage messages={messages} />
    case 'git-diff':
    case 'git-files':
    case 'files':
      return <FilesPage sessionId={session.id} project={session.project} mode={page} />
    case 'browser':
      return <BrowserPage messages={messages} />
    case 'terminal':
      return <TerminalPage messages={messages} />
    case 'projects':
      return <ProjectsPage session={session} />
    case 'subsessions':
      return <SubsessionsPage session={session} onOpen={onOpenSession} />
    case 'side':
      return (
        <DesktopOnly
          title="Side sessions live on the desktop"
          body="A side session is a parallel conversation you open with /side or /btw. Start one there and it appears here once this device is sent its transcript."
        />
      )
    case 'rooms':
      return (
        <DesktopOnly
          title="Rooms live on the desktop"
          body="Rooms fan a task out to same-config workers. This device is not sent room membership yet, so there is nothing to list."
        />
      )
    default:
      return null
  }
}

/* ── Plan ─────────────────────────────────────────────────────────────────── */

function PlanPage({ messages }: { messages: Message[] }) {
  const plan = React.useMemo(() => latestPlanInfo(messages), [messages])
  if (!plan) {
    return <Note title="No plan yet" body="Plans appear here as the agent publishes them. Ask for one with /plan." />
  }
  return (
    <View className="px-4 pb-2">
      <View className="mb-3 flex-row items-center gap-2">
        <Text className="min-w-0 flex-1 text-body font-semibold text-ink" weight={W_SEMI} numberOfLines={2}>
          {plan.title}
        </Text>
        <View className="h-pill shrink-0 items-center justify-center rounded-pill bg-field px-2.5">
          <Text className="text-pill font-semibold text-ink-2" style={{ fontVariant: ['tabular-nums'] }}>
            {plan.stepCount}
          </Text>
        </View>
      </View>
      {plan.steps.map((step, index) => (
        <View key={`${index}-${step.slice(0, 12)}`} className="flex-row gap-2.5 py-1.5">
          <StepTick state={index === 0 ? 'now' : 'todo'} />
          <Text className="min-w-0 flex-1 text-sub leading-[19px] text-ink">{step}</Text>
        </View>
      ))}
      {plan.relatedFiles.length > 0 ? (
        <View className="mt-3">
          <Eyebrow>Touches</Eyebrow>
          {plan.relatedFiles.slice(0, 8).map((file) => (
            <Text key={file} className="pb-1 text-mono-small text-ink-2" style={{ fontFamily: MONO }} numberOfLines={1}>
              {file}
            </Text>
          ))}
        </View>
      ) : null}
    </View>
  )
}

function StepTick({ state }: { state: 'done' | 'now' | 'todo' }) {
  if (state === 'done') {
    return (
      <View className="mt-0.5 size-[18px] shrink-0 items-center justify-center rounded-full bg-green-tint">
        <Check size={11} color={color.green} stroke={3} />
      </View>
    )
  }
  return (
    <View
      className="mt-0.5 size-[18px] shrink-0 rounded-full"
      style={{ borderWidth: 1.5, borderColor: state === 'now' ? color.accent : color.ink4 }}
    />
  )
}

/* ── Agents ───────────────────────────────────────────────────────────────── */

function AgentsPage({ messages, session }: { messages: Message[]; session: Session }) {
  const subagents = React.useMemo(() => deriveSubagents(messages), [messages])
  const tone = (status: string) => (status === 'completed' ? 'green' : status === 'failed' ? 'red' : 'orange')
  return (
    <View className="px-4 pb-2">
      <Eyebrow>Primary</Eyebrow>
      <View className="mb-4 flex-row items-center gap-3 rounded-card bg-option px-3.5 py-3">
        <Bot size={18} color={color.ink2} />
        <View className="min-w-0 flex-1">
          <Text className="text-body text-ink" numberOfLines={1}>
            {session.name}
          </Text>
          <Text className="mt-0.5 text-mono-cap text-ink-3" style={{ fontFamily: MONO }} numberOfLines={1}>
            {session.agent}
          </Text>
        </View>
      </View>
      <Eyebrow>Subagents</Eyebrow>
      {subagents.length === 0 ? (
        <Text className="text-sub leading-[19px] text-ink-3">
          None spawned yet. A subagent appears here the moment the session delegates work to one.
        </Text>
      ) : (
        subagents.map((agent) => (
          <View key={agent.id} className="flex-row items-center gap-3 border-b py-2.5" style={{ borderColor: color.lineSoft }}>
            <View className="size-[9px] shrink-0 rounded-full" style={{ backgroundColor: color[tone(agent.status)] }} />
            <View className="min-w-0 flex-1">
              <Text className="text-body text-ink" numberOfLines={1}>
                {agent.name}
              </Text>
              <Text className="mt-0.5 text-mono-cap text-ink-3" style={{ fontFamily: MONO }} numberOfLines={1}>
                {agent.kind || 'subagent'}
              </Text>
            </View>
            <Text className="shrink-0 text-cap capitalize text-ink-3">{agent.status}</Text>
          </View>
        ))
      )}
    </View>
  )
}

/* ── Goal ─────────────────────────────────────────────────────────────────── */

function GoalPage({ messages }: { messages: Message[] }) {
  const prompt = React.useMemo(() => latestUserPrompt(messages), [messages])
  const plan = React.useMemo(() => latestPlanInfo(messages), [messages])
  if (!prompt) {
    return <Note title="No objective yet" body="Once you send a prompt, it becomes this session's goal." />
  }
  return (
    <View className="px-4 pb-2">
      <View className="mb-2 flex-row items-center gap-2">
        <Star size={15} color={color.ink2} />
        <Eyebrow>Objective</Eyebrow>
      </View>
      <View className="rounded-card bg-option px-3.5 py-3">
        <Text className="text-body leading-[22px] text-ink">{prompt}</Text>
      </View>
      <View className="mt-4 rounded-card bg-card px-3.5 py-3">
        <Eyebrow>Plan progress</Eyebrow>
        <Text className="mt-1 text-body text-ink" style={{ fontVariant: ['tabular-nums'] }}>
          {plan ? `${plan.stepCount} steps published` : 'No plan published yet'}
        </Text>
        {plan ? (
          <Text className="mt-1 text-meta leading-[18px] text-ink-2" numberOfLines={2}>
            {plan.title}
          </Text>
        ) : null}
      </View>
    </View>
  )
}

/* ── Files · Git files · Git diff ─────────────────────────────────────────── */

/**
 * The workspace's own files, from the daemon — not the paths the transcript
 * happened to mention. `workspace/overview` answers with every file that
 * differs from HEAD plus its patch, and `workspace/file` reads one file's
 * contents, so a tap can actually open what it lists (the desktop's Git tab
 * does exactly this).
 */
function FilesPage({
  sessionId,
  project,
  mode,
}: {
  sessionId: string
  project: string | null
  mode: 'files' | 'git-files' | 'git-diff'
}) {
  const [overview, setOverview] = React.useState<WorkspaceOverview | null>(null)
  const [error, setError] = React.useState<string | undefined>(undefined)
  const [loading, setLoading] = React.useState(false)
  const [open, setOpen] = React.useState<string | null>(null)

  const load = React.useCallback(async () => {
    setLoading(true)
    setError(undefined)
    try {
      // Ask for the project when the sheet knows it — that is the thing being
      // listed — and fall back to the session so the daemon resolves it.
      const next = project ? await workspaceApi.overview(project) : await workspaceApi.sessionOverview(sessionId)
      setOverview(next)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not read the workspace.')
    } finally {
      setLoading(false)
    }
  }, [sessionId, project])

  React.useEffect(() => {
    void load()
  }, [load])

  if (open) {
    return <FileViewer sessionId={sessionId} project={project} path={open} onBack={() => setOpen(null)} />
  }

  const files = overview?.files ?? []

  if (loading && !overview) return <Loading label="Reading the workspace…" />

  if (error) {
    return <Note title="Could not read the workspace" body={error} />
  }

  if (files.length === 0) {
    return (
      <Note
        title={mode === 'files' ? 'No files changed' : 'Nothing to show'}
        body={
          mode === 'files'
            ? 'This project has no working-tree changes right now — the tree is clean.'
            : 'Changed files and their diffs appear here once the agent touches the working tree.'
        }
      />
    )
  }

  return (
    <View className="pb-2">
      {overview?.branch ? (
        <View className="mx-4 mb-2 flex-row items-center gap-2">
          <Text className="min-w-0 flex-1 text-mono-small text-ink-2" style={{ fontFamily: MONO }} numberOfLines={1}>
            {overview.branch}
          </Text>
          <Text className="shrink-0 text-cap text-ink-3" style={{ fontVariant: ['tabular-nums'] }}>
            {files.length} {files.length === 1 ? 'file' : 'files'}
          </Text>
        </View>
      ) : null}
      {files.map((file) => (
        <Tap
          key={file.path}
          accessibilityRole="button"
          accessibilityLabel={`Open ${file.path}`}
          onPress={() => {
            void haptic('select')
            setOpen(file.path)
          }}
          className="min-h-[52px] w-full flex-row items-center gap-3 px-4 py-2.5"
        >
          <View className="size-[30px] shrink-0 items-center justify-center rounded-lg bg-field">
            <FileStatusGlyph status={file.status} />
          </View>
          <View className="min-w-0 flex-1">
            <Text className="text-sub text-ink" numberOfLines={1}>
              {basename(file.path)}
            </Text>
            <Text className="mt-0.5 text-mono-cap text-ink-3" style={{ fontFamily: MONO }} numberOfLines={1}>
              {dirOf(file.path)}
            </Text>
          </View>
          <Text className="shrink-0 text-mono-cap" style={{ fontFamily: MONO, color: statusTone(file.status) }}>
            {file.status ?? 'M'}
          </Text>
          <ChevronRight size={14} color={color.ink3} />
        </Tap>
      ))}
    </View>
  )
}

/** `M` / `A` / `D` / `??` — the letter git would print, in its colour. */
function statusTone(status?: string) {
  if (status === 'A' || status === '??') return color.green
  if (status === 'D') return color.red
  return color.orange
}

function FileStatusGlyph({ status }: { status?: string }) {
  if (status === 'D') return <Trash size={15} color={statusTone(status)} />
  if (status === 'A' || status === '??') return <Plus size={15} color={statusTone(status)} />
  return <Pencil size={14} color={statusTone(status)} />
}

function dirOf(path: string) {
  const index = path.lastIndexOf('/')
  return index === -1 ? '.' : path.slice(0, index)
}

/**
 * One file, open. A diff when the daemon has one (a changed file always does),
 * otherwise the file's own contents — the same two reads the desktop's Git and
 * Files tabs make.
 */
function FileViewer({
  sessionId,
  project,
  path,
  onBack,
}: {
  sessionId: string
  project: string | null
  path: string
  onBack: () => void
}) {
  const [body, setBody] = React.useState<string | null>(null)
  const [kind, setKind] = React.useState<'diff' | 'contents'>('contents')
  const [error, setError] = React.useState<string | undefined>(undefined)
  const [loading, setLoading] = React.useState(false)

  React.useEffect(() => {
    let cancelled = false
    void (async () => {
      setLoading(true)
      setError(undefined)
      try {
        const overview = project ? await workspaceApi.overview(project) : await workspaceApi.sessionOverview(sessionId)
        const entry = (overview.files ?? []).find((file) => file.path === path)
        if (cancelled) return
        if (entry?.diff) {
          setKind('diff')
          setBody(entry.diff)
          return
        }
        const root = project ?? overview.project
        if (!root) throw new Error('This session has no project folder to read from.')
        const file = await workspaceApi.file(root, path)
        if (cancelled) return
        setKind('contents')
        setBody(file.contents ?? '')
      } catch (cause) {
        if (!cancelled) setError(cause instanceof Error ? cause.message : 'Could not open that file.')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [sessionId, project, path])

  return (
    <View className="pb-4">
      <View className="mx-4 mb-2 flex-row items-center gap-2">
        <Tap
          accessibilityRole="button"
          accessibilityLabel="Back to the file list"
          onPress={onBack}
          hitSlop={8}
          className="shrink-0 flex-row items-center gap-1 pr-1"
        >
          <ChevronLeft size={14} color={color.accent} />
          <Text className="text-btn-md font-semibold text-accent">Files</Text>
        </Tap>
        <Text className="min-w-0 flex-1 text-right text-mono-cap text-ink-3" style={{ fontFamily: MONO }} numberOfLines={1}>
          {kind === 'diff' ? 'diff' : 'contents'} · {basename(path)}
        </Text>
      </View>

      <Text className="mx-4 mb-2 text-mono-small text-ink-2" style={{ fontFamily: MONO }} numberOfLines={2}>
        {path}
      </Text>

      {loading ? (
        <Loading label="Opening…" />
      ) : error ? (
        <Note title="Could not open that file" body={error} />
      ) : (
        <View className="mx-4 overflow-hidden rounded-control" style={{ backgroundColor: color.plate }}>
          <DiffBody text={body ?? ''} diff={kind === 'diff'} />
        </View>
      )}
    </View>
  )
}

/** The patch or the file, colouring added and removed lines as git does. */
function DiffBody({ text, diff }: { text: string; diff: boolean }) {
  const lines = text.replace(/\n$/, '').split('\n')
  return (
    <View className="px-3 py-3">
      {lines.map((line, index) => {
        const added = diff && line.startsWith('+') && !line.startsWith('+++')
        const removed = diff && line.startsWith('-') && !line.startsWith('---')
        const meta = diff && (line.startsWith('+++') || line.startsWith('---') || line.startsWith('@@') || line.startsWith('diff ') || line.startsWith('index '))
        return (
          <Text
            key={index}
            className="text-mono-cap"
            style={{
              fontFamily: MONO,
              lineHeight: 16,
              color: added ? color.green : removed ? color.red : meta ? color.ink3 : color.ink,
            }}
          >
            {line || ' '}
          </Text>
        )
      })}
    </View>
  )
}

function Loading({ label }: { label: string }) {
  return (
    <View className="mx-4 my-4 flex-row items-center gap-2 rounded-card bg-option px-4 py-3">
      <Loader label={label} />
    </View>
  )
}

/* ── Browser ──────────────────────────────────────────────────────────────── */

function BrowserPage({ messages }: { messages: Message[] }) {
  const steps = React.useMemo(() => {
    const out: Array<{ id: string; action: string; target: string; status?: string }> = []
    for (const message of messages) {
      for (const part of message.parts) {
        if (part.kind !== 'browser') continue
        const step = part as { id: string; action: string; target: string; status?: string }
        out.push({ id: step.id, action: step.action, target: step.target, status: step.status })
      }
    }
    return out
  }, [messages])

  if (steps.length === 0) {
    return (
      <Note
        title="No browser activity"
        body="Page steps appear here for sessions driving a browser. The live view itself is on the desktop."
      />
    )
  }
  return (
    <View className="pb-2">
      {steps.map((step) => (
        <View key={step.id} className="flex-row items-center gap-3 px-4 py-3">
          <Panel size={16} color={color.ink3} />
          <View className="min-w-0 flex-1">
            <Text className="text-sub text-ink" numberOfLines={1}>
              {step.target || step.action}
            </Text>
            <Text className="mt-0.5 text-mono-cap uppercase text-ink-3" style={{ fontFamily: MONO, letterSpacing: 0.5 }}>
              {step.action}
            </Text>
          </View>
          {step.status ? <Text className="shrink-0 text-cap capitalize text-ink-3">{step.status}</Text> : null}
        </View>
      ))}
    </View>
  )
}

/* ── Terminal ─────────────────────────────────────────────────────────────── */

function TerminalPage({ messages }: { messages: Message[] }) {
  const commands = React.useMemo(() => {
    const out: Array<{ id: string; command: string; output?: string; exitCode?: number }> = []
    for (const message of messages) {
      for (const part of message.parts) {
        if (part.kind !== 'command') continue
        const row = part as { toolId: string; command: string; output?: string; exitCode?: number }
        out.push({ id: row.toolId, command: row.command, output: row.output, exitCode: row.exitCode })
      }
    }
    return out.slice(-40)
  }, [messages])

  if (commands.length === 0) {
    return (
      <Note
        title="No commands yet"
        body="Commands this session ran appear here with their output. An interactive shell stays on the desktop."
      />
    )
  }
  return (
    <View className="pb-2">
      {commands.map((row) => (
        <View key={row.id} className="mx-4 mb-2.5 overflow-hidden rounded-control" style={{ backgroundColor: color.plate }}>
          <View className="flex-row items-center gap-2 px-3 py-2.5">
            <Text className="shrink-0 text-mono-small" style={{ fontFamily: MONO, color: color.green }}>
              $
            </Text>
            <Text className="min-w-0 flex-1 text-mono-small text-ink" style={{ fontFamily: MONO }} numberOfLines={3}>
              {row.command}
            </Text>
            {row.exitCode !== undefined ? (
              <Text
                className="shrink-0 text-mono-cap"
                style={{ fontFamily: MONO, color: row.exitCode === 0 ? color.ink3 : color.red }}
              >
                {row.exitCode}
              </Text>
            ) : null}
          </View>
          {row.output ? (
            <Text
              className="border-t px-3 py-2.5 text-mono-cap text-ink-2"
              style={{ fontFamily: MONO, borderColor: color.lineSoft, lineHeight: 16 }}
              numberOfLines={12}
            >
              {row.output}
            </Text>
          ) : null}
        </View>
      ))}
    </View>
  )
}

/* ── Projects · Sub-sessions ──────────────────────────────────────────────── */

function ProjectsPage({ session }: { session: Session }) {
  const sessions = useStore((s) => s.sessions)
  const groups = React.useMemo(() => {
    const map = new Map<string, Session[]>()
    for (const row of sessions) {
      if (row.status === 'archived') continue
      const key = row.project ?? 'Inbox'
      map.set(key, [...(map.get(key) ?? []), row])
    }
    return Array.from(map.entries()).sort((a, b) => b[1].length - a[1].length)
  }, [sessions])

  return (
    <View className="pb-2">
      {groups.map(([project, rows]) => (
        <View key={project} className="mb-3">
          <View className="mx-4 mb-1 flex-row items-center gap-2">
            <Folder size={14} color={color.ink3} />
            <Text className="min-w-0 flex-1 text-sub font-semibold text-ink-2" weight={W_SEMI} numberOfLines={1}>
              {project === 'Inbox' ? 'Inbox — no folder' : basename(project)}
            </Text>
            <Text className="shrink-0 text-cap text-ink-3" style={{ fontVariant: ['tabular-nums'] }}>
              {rows.length}
            </Text>
          </View>
          {rows.map((row) => (
            <SessionLine key={row.id} session={row} current={row.id === session.id} />
          ))}
        </View>
      ))}
    </View>
  )
}

function SubsessionsPage({ session, onOpen }: { session: Session; onOpen?: (id: string) => void }) {
  const sessions = useStore((s) => s.sessions)
  const siblings = React.useMemo(
    () =>
      sessions
        .filter((row) => row.id !== session.id && row.status !== 'archived' && (row.project ?? null) === (session.project ?? null))
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at)),
    [sessions, session],
  )

  if (siblings.length === 0) {
    return (
      <Note
        title="No other sessions in this workspace"
        body={session.project ? `Nothing else is running in ${basename(session.project)}.` : 'This session has no project folder.'}
      />
    )
  }
  return (
    <View className="pb-2">
      {siblings.map((row) => (
        <SessionLine key={row.id} session={row} onOpen={onOpen} />
      ))}
    </View>
  )
}

function SessionLine({
  session,
  current,
  onOpen,
}: {
  session: Session
  current?: boolean
  onOpen?: (id: string) => void
}) {
  const connection = useStore((s) => s.connection)
  const active = connection === 'connected' && (session.status === 'running' || session.status === 'needs_resume')
  const display = uiStateDisplay(
    session.status === 'running' ? 'working' : session.status === 'needs_resume' ? 'paused' : (session.status as never),
  )
  const body = (
    <View className={cn('flex-row items-center gap-3 px-4 py-2.5', current && 'bg-accent-tint')}>
      <Text className="min-w-0 flex-1 text-sub text-ink" numberOfLines={1}>
        {session.name}
      </Text>
      {active ? <Pill label={display.label} tone={display.tone} className="h-5 px-2" /> : null}
      <ChevronRight size={14} color={color.ink3} />
    </View>
  )
  if (!onOpen || current) return body
  return (
    <Tap
      accessibilityRole="button"
      accessibilityLabel={`Open ${session.name}`}
      onPress={() => {
        void haptic('select')
        onOpen(session.id)
      }}
      className="min-h-[52px] w-full"
    >
      {body}
    </Tap>
  )
}

/* ── Shared bits ──────────────────────────────────────────────────────────── */

function Eyebrow({ children }: { children: React.ReactNode }) {
  return (
    <Text className="mb-1.5 text-cap font-semibold uppercase text-ink-3" style={{ letterSpacing: 0.5 }}>
      {children}
    </Text>
  )
}

function Note({ title, body }: { title: string; body: string }) {
  return (
    <View className="mx-4 my-4 rounded-card border-[1.5px] border-dashed px-5 py-8" style={{ borderColor: color.edge }}>
      <Text className="text-center text-body font-semibold text-ink-2" weight={W_SEMI}>
        {title}
      </Text>
      <Text className="mt-1.5 text-center text-meta leading-[19px] text-ink-3">{body}</Text>
    </View>
  )
}

/** A page whose data only the desktop has — say so, and say why. */
function DesktopOnly({ title, body }: { title: string; body: string }) {
  return (
    <View className="mx-4 my-4 rounded-card px-5 py-8" style={{ backgroundColor: color.card }}>
      <View className="mb-2 items-center">
        <Close size={20} color={color.ink3} />
      </View>
      <Text className="text-center text-body font-semibold text-ink-2" weight={W_SEMI}>
        {title}
      </Text>
      <Text className="mt-1.5 text-center text-meta leading-[19px] text-ink-3">{body}</Text>
    </View>
  )
}