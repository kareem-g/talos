/**
 * Session presentation — the rows and cards a session list is made of.
 *
 * QAI SIGNAL DECK — instrument rows.
 *
 * Shared by the Deck, the Sessions browser, the session switcher and the
 * panel's project picker, so a session looks the same wherever it appears. A
 * user learning "signal stripe on the left means it burns for you" learns it
 * once.
 *
 * THE ROW
 * -------
 * ```
 * ▎ [avatar]  Session name                    [StatusPill]
 * ▎           agent · workspace · 4m ago
 * ```
 *
 * A machined slab — press state brightens with it — floating on its surface,
 * one meta line under a 14.5px title, the status pill on the right. The
 * signal stripe on the left is the load-bearing part: a full-height 3pt edge
 * at the very rim, readable at a glance while scrolling, like the desktop
 * triage card's vertical rule. It never stands alone — the pill repeats the
 * state in words on the same row.
 *
 * SWIPE
 * -----
 * Star, archive and "more" live behind a left swipe instead of sitting in the
 * row as three icon buttons. On the desktop they are hover actions; on a phone
 * the equivalent is a gesture, because a permanently visible trio of 32pt
 * icons on every row of a 200-row list is a wall of chrome that costs more
 * than it explains. A long press opens the same actions as a sheet, for people
 * who do not discover the swipe.
 */

import * as React from 'react'
import { Animated, PanResponder, Pressable, Text, View, type StyleProp, type ViewStyle } from 'react-native'
import {
  Archive,
  ArchiveRestore,
  Check,
  ChevronRight,
  GitFork,
  MoreHorizontal,
  Play,
  Plus,
  Star,
  Trash2,
} from 'lucide-react-native'

import { cn } from '@/lib/format'
import { relativeTime } from '@/lib/format'
import { isInternalSession, sessionUIState, uiStateDisplay } from '@/lib/sessionState'
import type { Session } from '@/types/session'
import { useConversation, useStore } from '@app/store'
import { agentColor, palette, toneColor, type Tone } from '@app/design/tokens'
import { spring } from '@app/design/tokens'
import { LiveHalo, rowEnterStyle, staggerDelay, useDisclosure, useEnter } from '../motion'
import { ActionSheet } from '../Sheet'
import { AgentAvatar, Badge, Button, Card, Eyebrow, IconTile, Mono, Skeleton, StatusPill, haptic } from '../ui'

/** The tone a UI state paints with, mapped to the app's vocabulary. */
export function stateTone(state: string): Tone {
  switch (state) {
    case 'approval':
    case 'input':
    case 'paused':
    case 'resuming':
    case 'reconnecting':
      return 'wait'
    case 'failed':
    case 'offline':
      return 'danger'
    case 'working':
    case 'starting':
      return 'ok'
    case 'archived':
    case 'ended':
      return 'muted'
    default:
      return 'muted'
  }
}

/** States where a human is the bottleneck. Drives the left stripe. */
export function needsHuman(state: string): boolean {
  return state === 'approval' || state === 'input' || state === 'failed' || state === 'reconnecting'
}

/* ── Swipe ────────────────────────────────────────────────────────────────────── */

export interface SwipeAction {
  label: string
  icon: React.ReactNode
  color: string
  onPress: () => void
}

const ACTION_WIDTH = 76

/**
 * A row that reveals actions on a left swipe.
 *
 * Two details make the difference between this feeling right and feeling
 * broken:
 *   - the row tracks the finger 1:1 and only commits past a threshold, so a
 *     short swipe while scrolling does not fire an action;
 *   - a fast flick opens it regardless of distance, which is what makes it
 *     feel responsive rather than sticky.
 */
export function SwipeRow({
  children,
  actions,
  style,
}: {
  children: React.ReactNode
  actions: SwipeAction[]
  style?: StyleProp<ViewStyle>
}) {
  const offset = React.useRef(new Animated.Value(0)).current
  const width = actions.length * ACTION_WIDTH
  const [open, setOpen] = React.useState(false)

  const close = React.useCallback(
    (velocity = 0) => {
      setOpen(false)
      Animated.spring(offset, { toValue: 0, velocity, useNativeDriver: true, ...spring.overlay }).start()
    },
    [offset],
  )

  const pan = React.useMemo(
    () =>
      PanResponder.create({
        // Only claim the gesture once it is clearly horizontal: this row lives
        // inside a vertical ScrollView, and a 6pt vertical wobble is not a
        // swipe.
        onMoveShouldSetPanResponder: (_e, gesture) =>
          Math.abs(gesture.dx) > 12 && Math.abs(gesture.dx) > Math.abs(gesture.dy) * 1.6,
        onPanResponderMove: (_e, gesture) => {
          const base = open ? -width : 0
          const next = base + gesture.dx
          // Rubber-band past the end rather than stopping dead, so there is
          // still more than one thing to do.
          offset.setValue(next > 0 ? next * 0.25 : Math.max(next, -width - 24))
        },
        onPanResponderRelease: (_e, gesture) => {
          const base = open ? -width : 0
          const next = base + gesture.dx
          const flick = Math.abs(gesture.vx) > 0.5
          const shouldOpen = flick ? gesture.vx < 0 : next < -width / 2.2
          if (shouldOpen) {
            setOpen(true)
            void haptic('light')
            Animated.spring(offset, { toValue: -width, velocity: gesture.vx, useNativeDriver: true, ...spring.overlay }).start()
          } else {
            close(gesture.vx)
          }
        },
        onPanResponderTerminate: () => close(),
      }),
    [close, offset, open, width],
  )

  return (
    <View style={[{ overflow: 'hidden' }, style]}>
      {/* Actions sit *under* the row and are revealed by the row sliding. */}
      <View
        style={{
          position: 'absolute',
          right: 0,
          top: 0,
          bottom: 0,
          flexDirection: 'row',
        }}
      >
        {actions.map((action) => (
          <Pressable
            key={action.label}
            accessibilityRole="button"
            accessibilityLabel={action.label}
            onPress={() => {
              close()
              action.onPress()
            }}
            style={{
              width: ACTION_WIDTH,
              alignItems: 'center',
              justifyContent: 'center',
              gap: 5,
              backgroundColor: action.color,
            }}
          >
            {action.icon}
            <Text style={{ color: palette.ink, fontSize: 11, fontWeight: '600' }} numberOfLines={1}>
              {action.label}
            </Text>
          </Pressable>
        ))}
      </View>

      <Animated.View
        {...pan.panHandlers}
        style={{
          transform: [{ translateX: offset }],
          backgroundColor: palette.surface,
        }}
      >
        {children}
      </Animated.View>
    </View>
  )
}

/* ── Session row ───────────────────────────────────────────────────────────────── */

export interface SessionRowProps {
  session: Session
  onOpen: () => void
  starred?: boolean
  onToggleStar?: () => void
  onArchive?: () => void
  onMore?: () => void
  /** Overrides the derived status — the switcher knows about internal sessions. */
  state?: string
  providerName?: string
  /** Hide the workspace name when the row is already inside a workspace group. */
  hideWorkspace?: boolean
  showStatus?: boolean
  enterIndex?: number
  style?: StyleProp<ViewStyle>
}

export function SessionRow({
  session,
  onOpen,
  starred,
  onToggleStar,
  onArchive,
  onMore,
  state,
  providerName,
  hideWorkspace,
  showStatus = true,
  enterIndex,
  style,
}: SessionRowProps) {
  const connection = useStore((s) => s.connection)
  // Subscribes to this session's revisions so an approval arriving live flips
  // the row from "Working" to "Needs approval" without a list refresh.
  const conversation = useConversation(session.id)
  const uiState = state ?? sessionUIState(session, conversation, connection)
  const display = uiStateDisplay(uiState as never)
  const tone = stateTone(uiState)
  const human = needsHuman(uiState)
  const enter = useEnter(staggerDelay(enterIndex ?? 0), false)

  const actions: SwipeAction[] = []
  if (onToggleStar) {
    actions.push({
      label: starred ? 'Unstar' : 'Star',
      color: palette.raised,
      icon: (
        <Star
          size={18}
          color={palette.ink}
          fill={starred ? palette.wait : 'transparent'}
          strokeWidth={starred ? 0 : 2}
        />
      ),
      onPress: onToggleStar,
    })
  }
  if (onArchive) {
    actions.push({
      label: session.status === 'archived' ? 'Restore' : 'Archive',
      color: palette.raised,
      icon:
        session.status === 'archived' ? (
          <ArchiveRestore size={18} color={palette.ink} />
        ) : (
          <Archive size={18} color={palette.ink} />
        ),
      onPress: onArchive,
    })
  }
  if (onMore) {
    actions.push({
      label: 'More',
      color: palette.raised,
      icon: <MoreHorizontal size={18} color={palette.ink} />,
      onPress: onMore,
    })
  }

  return (
    <Animated.View style={rowEnterStyle(enter)}>
      <SwipeRow actions={actions} style={style}>
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={session.name}
          accessibilityHint={`${providerName ?? session.agent}${session.project ? `, ${session.project}` : ''}. Opens the session.`}
          onPress={() => {
            void haptic('light')
            onOpen()
          }}
          onLongPress={onMore}
          className="min-h-[60px] flex-row items-center overflow-hidden rounded-lg active:bg-raised"
        >
          {/* The signal stripe: state, readable at a glance while scrolling.
              Clipped to the row's radius so it reads as part of the slab. */}
          <View
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={{
              width: 3,
              alignSelf: 'stretch',
              backgroundColor: human ? toneColor[tone] : 'transparent',
            }}
          />

          <View className="flex-1 flex-row items-center gap-3 py-2.5 pl-3 pr-3">
            <AgentAvatar agent={session.agent} size={34} name={providerName} />
            <View className="min-w-0 flex-1 gap-0.5">
              <View className="flex-row items-center gap-1.5">
                {starred ? <Star size={12} color={palette.wait} fill={palette.wait} strokeWidth={0} /> : null}
                <Text
                  className="min-w-0 flex-1 text-[14.5px] leading-[20px] font-medium text-ink"
                  numberOfLines={1}
                >
                  {session.name}
                </Text>
              </View>
              <Text className="text-[11.5px] leading-[15px] text-ink-3" numberOfLines={1}>
                {[
                  providerName ?? session.agent,
                  !hideWorkspace && session.project ? session.project.split('/').filter(Boolean).pop() : null,
                  relativeTime(session.updated_at),
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </Text>
            </View>
            {showStatus ? (
              <View className="shrink-0">
                <StatusPill tone={tone} label={display.label} pulse={display.pulse} size="sm" />
              </View>
            ) : null}
          </View>
        </Pressable>
      </SwipeRow>
    </Animated.View>
  )
}

/* ── Attention card ─────────────────────────────────────────────────────────────────
 * The most important component on the Deck. It has to say four things without
 * the user reading carefully: a human is blocked, what is being asked, how long
 * it has waited, and what to do about it.
 *
 * It is quieter than a shout and clearer than a whisper: a soft tone fill and
 * hairline (no cap, no boxing-in), the state as a StatusPill beside the name,
 * the ask as one prompt line, and exactly two actions — Approve in place, Open
 * as a ghost beside it. The approve action is inline, one tap from the list,
 * because the situations where a session is waiting on you are exactly the
 * situations where you are doing something else. */

export function AttentionCard({
  session,
  headline,
  uiState,
  idleFor,
  providerName,
  onApprove,
  approveLabel = 'Approve',
  onOpen,
  secondaryAction,
  enterIndex,
}: {
  session: Session
  headline: string
  uiState: string
  idleFor?: string
  providerName?: string
  onApprove?: () => void
  approveLabel?: string
  onOpen: () => void
  /** Replaces the plain "Open" ghost button — Retry for failed, Resume for paused. */
  secondaryAction?: { label: string; onPress: () => void }
  enterIndex?: number
}) {
  const tone = stateTone(uiState)
  const display = uiStateDisplay(uiState as never)
  const enter = useEnter(staggerDelay(enterIndex ?? 0), false)

  return (
    <Animated.View style={rowEnterStyle(enter)}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${session.name}. ${display.label}.`}
        accessibilityHint={headline}
        onPress={() => {
          void haptic('light')
          onOpen()
        }}
        className="rounded-lg active:opacity-85"
      >
        <Card tone={tone} className="gap-3 overflow-hidden p-4">
          {/* Signal edge: lit when it burns for you. */}
          <View style={{ marginHorizontal: -16, marginTop: -16, height: 2, backgroundColor: toneColor[tone] }} />
          <View className="flex-row items-start gap-3">
            <View className="min-w-0 flex-1 gap-0.5">
              <Text
                className="text-[15px] leading-[20px] font-semibold text-ink"
                style={{ letterSpacing: -0.2 }}
                numberOfLines={2}
              >
                {session.name}
              </Text>
              <Text className="text-[12px] leading-[16px] text-ink-2" numberOfLines={1}>
                {providerName ?? session.agent}
                {idleFor ? ` · waiting ${idleFor}` : ''}
              </Text>
            </View>
            <StatusPill tone={tone} label={display.label} size="sm" />
          </View>

          {headline ? (
            <Text className="text-[13px] leading-[18px] text-ink-2" numberOfLines={3}>
              {headline}
            </Text>
          ) : null}

          <View className="flex-row items-center gap-2">
            {onApprove ? (
              <Button
                variant="primary"
                size="sm"
                label={approveLabel}
                accessibilityLabel={`${approveLabel} the pending request in ${session.name}`}
                onPress={() => {
                  void haptic('success')
                  onApprove()
                }}
              />
            ) : null}
            <Button
              variant="ghost"
              size="sm"
              label={secondaryAction?.label ?? (uiState === 'failed' ? 'Retry' : 'Open')}
              accessibilityLabel={secondaryAction?.label ?? `Open ${session.name}`}
              onPress={() => {
                void haptic('light')
                if (secondaryAction) secondaryAction.onPress()
                else onOpen()
              }}
            />
          </View>
        </Card>
      </Pressable>
    </Animated.View>
  )
}

/* ── Live row ──────────────────────────────────────────────────────────────────────
 * Ambient. No actions — a running agent needs attention only when it *changes*
 * state, and when it does it moves itself to "Needs you". So this row carries
 * a live halo and a ticking runtime, and nothing else. */

export function LiveRow({
  session,
  task,
  runtime,
  providerName,
  onOpen,
  enterIndex,
}: {
  session: Session
  task?: string
  runtime: string
  providerName?: string
  onOpen: () => void
  enterIndex?: number
}) {
  const enter = useEnter(staggerDelay(enterIndex ?? 0), false)
  return (
    <Animated.View style={rowEnterStyle(enter)}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={`${task ?? session.name}, running, ${runtime}`}
        accessibilityHint="Opens the session"
        onPress={() => {
          void haptic('light')
          onOpen()
        }}
        className="min-h-14 flex-row items-center gap-3 rounded-md px-4 py-3 active:bg-raised"
      >
        <View style={{ width: 20, alignItems: 'center', justifyContent: 'center' }}>
          <LiveHalo color={agentColor(session.agent)} size={20} />
          <View
            style={{
              width: 8,
              height: 8,
              borderRadius: 4,
              backgroundColor: agentColor(session.agent),
            }}
          />
        </View>
        <View className="min-w-0 flex-1 gap-0.5">
          <Text className="text-[14.5px] leading-[20px] font-medium text-ink" numberOfLines={1}>
            {task ?? session.name}
          </Text>
          <Text className="text-[11.5px] leading-[15px] text-ink-3" numberOfLines={1}>
            {providerName ?? session.agent}
          </Text>
        </View>
        <Mono
          className="shrink-0 text-[11.5px]"
          style={{ fontVariant: ['tabular-nums'] }}
          numberOfLines={1}
        >
          {runtime}
        </Mono>
      </Pressable>
    </Animated.View>
  )
}

/* ── Workspace group ─────────────────────────────────────────────────────────────────
 * A collapsible group of sessions, the desktop's workspace card. The workspace
 * name is an eyebrow — the group is a *label* for the rows under it, not a
 * competing headline — with the project path in mono beneath, counts as outline
 * badges, and the chevron rotating with the collapse. */

export function WorkspaceGroup({
  name,
  project,
  attention,
  running,
  total,
  children,
  defaultOpen,
  onNewTask,
}: {
  name: string
  project: string | null
  attention: number
  running: number
  total: number
  children: React.ReactNode
  defaultOpen?: boolean
  onNewTask?: () => void
}) {
  const [open, setOpen] = React.useState(defaultOpen ?? true)
  // Height is measured rather than clamped to a magic number: a workspace with
  // four sessions and one with forty animate at different speeds otherwise,
  // and a fixed `maxHeight` visibly truncates the second. See `useDisclosure`.
  const disclosure = useDisclosure(open, 220)
  const enter = useEnter(0, false)

  return (
    <Animated.View style={rowEnterStyle(enter)}>
      <View className="overflow-hidden rounded-lg border border-line bg-surface">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={name}
          accessibilityHint={`${total} sessions${attention ? `, ${attention} need you` : ''}`}
          accessibilityState={{ expanded: open }}
          onPress={() => {
            void haptic('light')
            setOpen((value) => !value)
          }}
          className="min-h-14 flex-row items-center gap-2.5 px-4 py-3 active:bg-raised"
        >
          <Animated.View style={disclosure.indicatorStyle}>
            <ChevronRight size={16} color={palette.ink3} />
          </Animated.View>
          <View className="min-w-0 flex-1 gap-1">
            <Eyebrow className="text-ink-2">{name}</Eyebrow>
            {project ? (
              <Mono className="text-[11px]" numberOfLines={1}>
                {project}
              </Mono>
            ) : null}
          </View>
          {attention > 0 ? (
            <Badge tone="wait" outline>
              {attention} need you
            </Badge>
          ) : null}
          {running > 0 ? (
            <Badge tone="accent" outline>
              {running} live
            </Badge>
          ) : null}
          <Badge tone="muted" outline mono>
            {total}
          </Badge>
          {onNewTask ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Start a task in ${name}`}
              onPress={onNewTask}
              hitSlop={12}
              className="size-8 items-center justify-center rounded-pill bg-raised active:bg-hover"
            >
              <Plus size={17} color={palette.ink2} />
            </Pressable>
          ) : null}
        </Pressable>

        {children ? (
          <Animated.View
            {...(disclosure.style.height === undefined ? {} : { onLayout: disclosure.onLayout })}
            style={disclosure.style}
          >
            <View className="gap-0.5 px-1.5 pb-1.5">{children}</View>
          </Animated.View>
        ) : null}
      </View>
    </Animated.View>
  )
}

/* ── Session action sheet ───────────────────────────────────────────────────────────
 * One sheet for every destructive or navigational session action, reached by
 * the row's long press or its swipe "more". Destructive actions live here
 * behind an explicit confirm, never as a button in the row: the previous
 * version put a delete one tap from opening a session. */

export function SessionActionsSheet({
  session,
  onClose,
  onDelete,
  onFork,
  onArchive,
  onRestore,
  onResume,
  onStar,
  starred,
  providerName,
}: {
  session?: Session
  onClose: () => void
  onDelete: () => void
  onFork: () => void
  onArchive: () => void
  onRestore: () => void
  onResume?: () => void
  onStar?: () => void
  starred?: boolean
  providerName?: string
}) {
  if (!session) return null
  const archived = session.status === 'archived'
  const canResume =
    session.status === 'needs_resume' || session.status === 'exited' || session.status === 'idle'

  return (
    <ActionSheet
      open
      onClose={onClose}
      title={session.name}
      eyebrow={providerName ?? session.agent}
      actions={[
        ...(onStar
          ? [
              {
                label: starred ? 'Remove star' : 'Star this session',
                hint: 'Stars float a session to the top of every list.',
                icon: <Star size={18} color={palette.ink2} fill={starred ? palette.wait : 'transparent'} strokeWidth={starred ? 0 : 2} />,
                onPress: onStar,
              },
            ]
          : []),
        ...(canResume && onResume
          ? [
              {
                label: 'Resume session',
                hint: 'Continue from where it left off',
                icon: <Play size={18} color={palette.ok} />,
                onPress: onResume,
              },
            ]
          : []),
        {
          label: 'Fork session',
          hint: 'Branch into a new session with the same history',
          icon: <GitFork size={18} color={palette.accent} />,
          onPress: onFork,
        },
        archived
          ? {
              label: 'Restore from archive',
              hint: 'Bring this session back into the list',
              icon: <ArchiveRestore size={18} color={palette.wait} />,
              onPress: onRestore,
            }
          : {
              label: 'Archive session',
              hint: 'Hide it without losing its history',
              icon: <Archive size={18} color={palette.ink2} />,
              onPress: onArchive,
            },
        {
          label: 'Delete session',
          hint: 'Permanently remove it and its history',
          icon: <Trash2 size={18} color={palette.danger} />,
          tone: 'danger' as const,
          onPress: onDelete,
        },
      ]}
    />
  )
}

/* ── A compact "all clear" panel ─────────────────────────────────────────────────── */

/**
 * The empty case for the triage section.
 *
 * It is rendered rather than omitted, because "nothing needs you" is
 * information: it is the difference between the app working and the app being
 * disconnected, and the connection strip is the only other thing on screen that
 * could explain the silence.
 */
export function AllClear({ count, onOpenActivity }: { count: number; onOpenActivity?: () => void }) {
  return (
    <View className="flex-row items-center gap-3 rounded-lg border border-line bg-surface px-4 py-3.5">
      <IconTile tone="ok" size={34} icon={<Check size={17} color={palette.ok} strokeWidth={2.6} />} />
      <View className="min-w-0 flex-1">
        <Text className="text-[14.5px] leading-[20px] font-medium text-ink">All clear</Text>
        <Text className="mt-0.5 text-[12px] leading-[16px] text-ink-3" numberOfLines={2}>
          {count > 0
            ? `${count} ${count === 1 ? 'session is' : 'sessions are'} running. Nothing is waiting on you.`
            : 'No sessions need you right now.'}
        </Text>
      </View>
      {onOpenActivity ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Open the activity log"
          onPress={onOpenActivity}
          hitSlop={10}
        >
          <ChevronRight size={18} color={palette.ink4} />
        </Pressable>
      ) : null}
    </View>
  )
}

/* ── A loading list that occupies the shape the list will have ──────────────────── */

export function SessionListSkeleton({ count = 4 }: { count?: number }) {
  return (
    <View className="overflow-hidden rounded-lg border border-line bg-surface">
      {Array.from({ length: count }).map((_, index) => (
        <View key={index}>
          {index > 0 ? <View className="h-px bg-line" style={{ marginLeft: 16 }} /> : null}
          <SkeletonRow />
        </View>
      ))}
    </View>
  )
}

function SkeletonRow() {
  const enter = useEnter(0, false)
  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      className="min-h-16 flex-row items-center gap-3 px-4 py-3"
      style={rowEnterStyle(enter)}
    >
      <Skeleton width={36} height={36} radius={18} />
      <View style={{ flex: 1, gap: 7 }}>
        <Skeleton width="58%" height={13} />
        <Skeleton width="36%" height={10} />
      </View>
      <Skeleton width={62} height={20} radius={10} />
    </Animated.View>
  )
}

/* ── Helpers shared with the Activity screen ────────────────────────────────────── */

export function visibleSessions(sessions: Session[]): Session[] {
  return sessions.filter((session) => !isInternalSession(session) && session.status !== 'archived')
}

export { cn }
