# Phase 13: OpenCode-style Layout Redesign

Goal: Restructure `SessionWorkspace` into a dense, professional agentic IDE layout —
top bar / left sidebar / center chat / always-visible right git panel — while
**preserving** AgentDeck's existing dark theme tokens, UX patterns, chat renderers,
composer, state machine, and all real backend integrations.

The user supplied an exhaustive spec. This plan translates it into concrete
file-level changes. Nothing here invents new backend capabilities — every data
source already exists (git status, branches, diffs, sessions, plans, approvals,
terminal, mode). We are **rearranging and restyling** what's there.

## Layout target (from spec)

```
┌──────────────────────────────────────────────────────────────────────┐
│ TopBar (40px): AgentDeck · New Session · project · Status · timer   │
├──────────┬───────────────────────────────────┬───────────────────────┤
│ Left     │ Center chat                       │ Right Git Panel       │
│ Sidebar  │  Chat|Terminal · Jump to…         │ [icon bar] GIT·PROJ   │
│ 280px    │  ─────────────────────────────    │ branch ▾  +6,034 −708 │
│          │  Thought ▾                        │ CHANGES · 117         │
│ project▾ │  ✓ Search src/...          39ms   │  M path/to/file  diff │
│ branch   │  ✓ Read  file.ts            41ms   │  M another.ts    diff │
│ +6k −708 │  ▸ Write                        │                       │
│ 117 unc. │  ─────────────────────────────    │                       │
│ ───────  │  [response] [copy] [refresh]      │                       │
│ Sessions │  ─────────────────────────────    │                       │
│ + New    │  /  @  Full access ▾ model ▾     │                       │
│ ▸ task 18m│ plan/act ──────────────────►      │                       │
│   task 2h │                                   │                       │
│   …       │                                   │                       │
└──────────┴───────────────────────────────────┴───────────────────────┘
```

## What changes vs. what is preserved

### Preserved (no functional change)
- All chat renderers in `chat.tsx` (Prose, Reasoning, Step, FileChips, Plan, Approval, UsageMeter, TurnSummary, ErrorCard) — the spec's "Thought sections", "tool use displays", "code/file references", "copy and refresh buttons" all already exist here.
- `Composer.tsx` — `/`, `@`, model selector, access level, send/stop all exist.
- `Timeline.tsx` + `ActivityLine` — conversation scroll + live activity.
- `StateZone.tsx` — the state machine surface (working/approval/paused/failed/ended/...).
- `GitToolsCard.tsx` — branch selector, diffstat, commit/push, git graph, changed files with diffs.
- `WorkspaceSwitcher.tsx` — project dropdown, branch list, session list, search.
- `TasksAndExecution.tsx` — ProgressWidget, AutomationsPanel, ComposerControls, PermissionChip.
- All store, API, socket, types, design tokens.

### Changed (rearrangement / restyle)
1. `SessionWorkspace.tsx` — new 4-zone grid scaffold.
2. New `TopBar.tsx` — extracted from the old header, restyled to spec.
3. Restructured left sidebar — merge `WorkspaceSwitcher` content into a single scrollable column matching the spec order (project → branch+stats → uncommitted → sessions → search → new task).
4. Right panel — collapse the 6-tab `RightRail` into a **single always-visible Git panel** with a slim left icon toolbar (chat/git/files/search icons per spec). The other tabs (sessions, agents, terminals, browser, tasks) move into the left sidebar or top bar.
5. Composer controls — add a **Session Mode (plan/act)** selector wired to the existing `conversation.mode` (mode_changed events already populate it).

## File-by-file plan

### 1. `src/components/desktop/SessionWorkspace.tsx` (rewrite scaffold)

Replace the current `header + <aside/> + <main/> + <aside/>` with:

```
<div class="flex h-dvh flex-col bg-canvas text-ink">
  <TopBar session={session} ... />                          // 40px
  <div class="flex min-h-0 flex-1">
    <LeftSidebar session={session} ... />                  // ~280px
    <main class="flex min-w-0 flex-1 flex-col bg-canvas">  // fluid
      <CenterTabs tab={tab} onTab={setTab} outline=... />
      <div class="flex min-h-0 flex-1 flex-col">
        {tab==='chat' ? <ChatSurface/> : <TerminalView/>}
      </div>
    </main>
    <RightGitPanel session={session} ... />                 // ~380px
  </div>
</div>
```

- Remove the old collapsible left/right logic and the mobile bottom sheet
  (mobile is out of scope for this desktop-focused layout; keep it simple).
- Keep all existing state: `tab`, `editingTitle`, `menuOpen`, runtime tick,
  outline computation, scrollToSection, keyboard shortcuts.
- Keep the `Notice` banner above the grid when present.

### 2. New `src/components/desktop/TopBar.tsx`

A 40px single row. Content from spec:
- Left: BrandMark ("AgentDeck") + "New Session" button + current project name
  (monospace, truncated) + branch chip.
- Center/right: StatusPill (Ready/Working) + monospace runtime timer +
  connection dot + settings gear + window-controls placeholder.
- Reuse `StatusPill`, `Dot`, `IconButton` from `ui.tsx`.
- Props: `session`, `uiState`, `runtime`, `connection`, `onNewSession`,
  `onBack`, `onOpenSettings`.

### 3. New `src/components/desktop/LeftSidebar.tsx`

~280px fixed. Single scrollable column, top-to-bottom order per spec:
1. **Project selector dropdown** — reuse the workspace-dropdown logic from
   `WorkspaceSwitcher` (project list with counts, check on active).
2. **Active branch + change stats** — current branch name, `+6,034 −708`
   (green/red monospace), uncommitted file count. Reuse `BranchList` data
   (`gitApi.branches`) but render inline compact (no expand/collapse — always
   show current branch + stats; full branch list lives in the right panel).
3. **Uncommitted changes count** — "117 uncommitted changes" line.
4. **Sessions section** — "+ New task" button at top, then filtered session
   rows (name + relative time + status dot). Reuse `WorkspaceSwitcher`'s
   session-list rendering.
5. **Search bar** — the session search input, pinned at the bottom of the
   header area above sessions.

Props: `session`, `sessions`, `connection`, `onSelect`, `onNewTask`.

### 4. New `src/components/desktop/RightGitPanel.tsx`

~380px fixed. Structure:
- A **60px vertical icon toolbar** on the left edge (per spec: chat, git,
  files, search icons). The active icon highlights. These are quick-nav
  toggles — git is the default/active; the others can cycle the center
  view or expand overlays (wired minimally: chat→focus composer,
  files→(future), search→focus session search).
- Main panel fills the rest:
  - Header: `GIT · {project-name}` (mono uppercase eyebrow).
  - Branch selector dropdown (reuse `GitToolsCard`'s branch-menu logic).
  - Change stats `+6,034 −708` with action icons (commit/push, refresh).
  - `CHANGES · {count}` section header.
  - Scrollable file list: each row = status letter (M/A/D/? in mono colored)
    + full path (mono, truncate) + `diff` link. Clicking diff opens the
    existing `DiffLayer` overlay.
  - Reuse `GitToolsCard` for the branch menu + commit modal + git graph modal.
  - Render the changed-files list inline (pull from `workspaceApi.overview`
    → `changed_files` + `diffs`, which the backend already returns with
    per-file diffs).

Props: `session`, `notify`.

### 5. Composer controls — Session Mode selector

Add to `TasksAndExecution.tsx` `ComposerControls`:
- A new inline chip `SessionModeChip` that reads `conversation.mode`
  (`{ id, modes }` from `mode_changed` events — already handled in
  `events.ts:505`). Default modes: `plan` / `act`.
- Selecting a mode sends `setConfig(sessionId, 'mode', id)` (the backend
  already routes config updates; `mode` is a standard config dimension for
  agents that support it, and a no-op otherwise).
- Renders only when `conversation.mode.modes.length > 0`, else hidden.

### 6. Minor: `index.css` / tokens

The spec's color values (`#0d0d0d`, `#1e1e1e`, `#4ade80`, `#f87171`,
`#60a5fa`) are close to but not identical to the existing tokens
(`--canvas: #09090b`, `--green: #34d399`, `--red: #f87171`,
`--agent-blue: #60a5fa`). **Decision: keep the existing tokens.** They are
already applied consistently and the visual difference is negligible; the
spec explicitly says "preserve my current dark UI theme, color palette".
Add only one new utility if needed for the right-panel icon rail background.

## Out of scope (intentionally)
- New backend endpoints (none needed).
- Mobile layout (the spec is desktop-focused; the existing mobile
  `SessionView` path in `App.tsx` is untouched).
- Voice, MCP, attachments, branching (these are in the gap analysis but
  not part of this layout pass).

## Verification
- `cd dashboard && npx tsc --noEmit` — zero type errors.
- `cd dashboard && npx vite build` — builds clean.
- `cd dashboard && npm run dev` — manual smoke test of the 4 zones.
