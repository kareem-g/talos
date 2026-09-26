/**
 * rightTabs — the registry of tab types for the browser-style right panel.
 *
 * Each tab type maps to a view in `RightRailViews`. Tabs can be opened/closed
 * individually like browser tabs; the "＋ Open tab" picker lists every type.
 * `defaultOpen` drives the initial set for a session (persisted in localStorage).
 */

import type { LucideIcon } from 'lucide-react'
import { Bot, FileDiff, Files, Flag, Folder, Globe2, Map as MapIcon, MessagesSquare, SquareTerminal, Users, Waypoints } from 'lucide-react'

export type RightTabType =
  | 'browser'
  | 'agents'
  | 'plan'
  | 'git-diff'
  | 'git-files'
  | 'goal'
  | 'files'
  | 'projects'
  | 'subsessions'
  | 'side'
  | 'rooms'
  | 'terminal'

export interface RightTabMeta {
  id: RightTabType
  label: string
  description: string
  defaultOpen: boolean
  icon: LucideIcon
}

export const RIGHT_TABS: RightTabMeta[] = [
  { id: 'plan', label: 'Plan', description: 'Todos the agent is working through — plan steps, live.', defaultOpen: true, icon: MapIcon },
  { id: 'agents', label: 'Agents', description: 'Primary agent + subagents the agent spawned, and activity.', defaultOpen: true, icon: Bot },
  { id: 'git-diff', label: 'Git diff', description: 'Working-tree changes with inline diffs and commit.', defaultOpen: true, icon: FileDiff },
  { id: 'git-files', label: 'Git files', description: 'Changed files, statuses and worktrees.', defaultOpen: false, icon: Files },
  { id: 'goal', label: 'Goal', description: 'Session objective and plan progress.', defaultOpen: true, icon: Flag },
  { id: 'browser', label: 'Browser', description: 'Inline webview for a URL.', defaultOpen: false, icon: Globe2 },
  { id: 'files', label: 'Files', description: 'The workspace file tree — pick a file to preview it.', defaultOpen: false, icon: Files },
  { id: 'projects', label: 'Projects', description: 'Every workspace and the sessions in it — switch from here.', defaultOpen: false, icon: Folder },
  { id: 'subsessions', label: 'Sub-sessions', description: 'Other sessions in this workspace — switch here.', defaultOpen: false, icon: Users },
  { id: 'side', label: 'Side', description: 'A side session you chat with in parallel (/side, /btw).', defaultOpen: false, icon: MessagesSquare },
  { id: 'rooms', label: 'Rooms', description: 'Rooms of same-config workers you can fan tasks out to (/orchestrator).', defaultOpen: false, icon: Waypoints },
  { id: 'terminal', label: 'Terminal', description: 'Live terminal for sessions with an interactive shell.', defaultOpen: false, icon: SquareTerminal },
]

export const RIGHT_TAB_BY_ID: Record<RightTabType, RightTabMeta> = Object.fromEntries(
  RIGHT_TABS.map((tab) => [tab.id, tab]),
) as Record<RightTabType, RightTabMeta>

export const DEFAULT_OPEN_TABS: RightTabType[] = RIGHT_TABS.filter((t) => t.defaultOpen).map((t) => t.id)

export const RIGHT_TAB_IDS: RightTabType[] = RIGHT_TABS.map((t) => t.id)

export function isRightTab(value: unknown): value is RightTabType {
  return typeof value === 'string' && (RIGHT_TAB_IDS as string[]).includes(value)
}
