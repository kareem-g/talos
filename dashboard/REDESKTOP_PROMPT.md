# AgentDeck Desktop Redesign — Implementation Prompt

You are implementing three features for the AgentDeck desktop dashboard
(`/home/kareem/Documents/agentdeck-linux/dashboard/`). The app is a React 19 +
Vite + Tailwind + Zustand + React Router v7 project for managing AI coding agent
sessions.

Read these files first for full context:
- `src/App.tsx` — app shell with `useIsDesktop()` and two-screen architecture
- `src/store/index.ts` — Zustand store with sessions, resume, and conversation state
- `src/types/session.ts` — `Session`, `SessionStatus`, `DiscoveredSession` types
- `src/components/desktop/SessionsDashboard.tsx` — Screen 1 (session list)
- `src/components/desktop/SessionWorkspace.tsx` — Screen 2 (active session)
- `src/components/desktop/ManagementSidebar.tsx` — Screen 1 sidebar
- `src/components/TerminalView.tsx` — xterm.js terminal renderer
- `src/components/SessionView.tsx` — shared session view (mobile + desktop)
- `src/components/SyncSessions.tsx` — existing discovery/sync UI (mobile)
- `src/lib/api.ts` — HTTP client with `api.sessions.*` and `api.sync.*`

---

## Feature 1: Fix Resume Across the App

### Problem
Sessions with status `needs_resume` show stale UI. The resume flow is scattered:
- `SessionView.tsx` renders a "Resume" button but the store's `resumeSession()`
  has inconsistent error handling.
- After resuming, the status doesn't always flip back to `running`.
- The `resume_command` field exists on the session but isn't exposed in the
  workspace UX — users see "needs_resume" with no explanation of *how*.

### Requirements

1. **Normalized resume state machine** in `src/store/index.ts`:
   - Add `'resuming'` to `SessionStatus` in `src/types/session.ts`.
   - `resumeSession(sessionId)` must: set status to `'resuming'`, call the backend
     `POST /api/sessions/{id}/resume`, then the existing WebSocket `StateChange`
     handler takes over. On error, revert to `'needs_resume'` and surface a notice.
   - Guard against double-resume: if status is already `'resuming'` or
     `'running'`, no-op.

2. **Resume banner in `SessionWorkspace.tsx`**:
   - When `session.status === 'needs_resume'`, show a non-blocking banner at the
     top of the center column (not a modal):
     - Icon (arrow-clockwise), text: "This session needs attention to continue.",
     - Show `session.resume_command` in a `<code>` block if present.
     - Primary button: "Resume" (calls `resumeSession`).
     - Secondary: "Start new with same prompt" (optional — link to docs or no-op).
   - When status is `'resuming'`, show a subtle spinner + "Resuming…" inline.

3. **Resume from SessionsDashboard.tsx**:
   - Sessions with `needs_resume` get a visual indicator: amber dot + "Needs
     resume" label in the card meta.
   - Clicking the card navigates to the session (same as today), where the banner
     appears.
   - Do **not** auto-resume. Always require the user to click.

4. **Reconnect resilience**:
   - On WebSocket reconnect, the backend re-sends active sessions. If a session
     was `needs_resume` before reconnect and the backend reports `running`, the
     UI must reflect that without a full page reload.

5. **Edge cases**:
   - Resume fails → banner remains, error notice via `setNotice()`, status reverts.
   - Session not found on resume → `setNotice()` with the backend message, status
     becomes `'error'`.

---

## Feature 2: Workspace Discovery (Desktop)

### Problem
Users have existing sessions in Claude Code, Codex, OpenCode CLI storage that
AgentDeck doesn't know about. The backend already exposes:
- `GET /api/sessions/discover` — returns `DiscoverResponse` with
  `sessions: DiscoveredSession[]`, `pending`, `total`, `errors`.
- `POST /api/sessions/sync` — imports selected or all discovered sessions.

The mobile app has a `SyncLayer` in `SyncSessions.tsx`, but the desktop two-screen
architecture has no equivalent.

### Requirements

1. **Discovery panel in `SessionsDashboard.tsx`** (right side of filter bar):
   - Button: "Discover sessions" with a count badge (`pending` from the API).
   - On click, fetch `GET /api/sessions/discover` and open an inline panel
     (not a modal) below the filter bar, or a right-side drawer.
   - List discovered sessions grouped by agent (Claude, Codex, OpenCode):
     - Each row: session title, project (if any), "Updated <relative>",
       checkbox for selective import.
   - Header: "Found X sessions, Y already imported."
   - Actions: "Import selected", "Import all", "Refresh".
   - Errors (provider not installed, permission denied) shown inline as
     warnings, not fatal.

2. **Empty state discovery prompt**:
   - When the main session list is empty, show a special empty state with
     two CTAs: "New session" and "Discover existing sessions".
   - The discovery CTA triggers the same flow as the filter-bar button.

3. **Optimistic import UX**:
   - On "Import", disable the button, show spinner, call `POST /api/sessions/sync`.
   - On success, refresh the session list, close the discovery panel, show a
     toast: "Imported N sessions".
   - On partial failure (some imported, some failed), keep the panel open,
     show which failed with reasons, let the user retry the failed ones.

4. **Auto-refresh on dashboard mount**:
   - When Screen 1 mounts, fire `GET /api/sessions/discover` in the background
     and update the badge count. Do not open the panel automatically.
   - Refocus/refetch when the user navigates back from Screen 2.

5. **Starring a newly imported session**:
   - If the user starred a discovered session before import, the star must
     persist on the imported session (see Feature 3).

---

## Feature 3: Starring Functionality

### Problem
Sessions in the dashboard can't be pinned/favorited. The
`SessionsDashboard.tsx` already has a `STARRED_KEY` in localStorage and a
`StarIcon` component, but starring is wired to a local `Set<string>` only.
Stars don't sync to the backend, and starred sessions aren't surfaced specially
in the workspace.

### Requirements

1. **Backend star support** (read-only for this task — no backend changes):
   - Stars are **local-only**, persisted in `localStorage` under
     `agentdeck-starred` (already exists).
   - On app load, hydrate from localStorage. On star toggle, write back.
   - Star state is a `Set<string>` of session IDs.

2. **Dashboard starring UX** (`SessionsDashboard.tsx`):
   - Each session card/row has a star toggle (top-right on cards, left of name
     in list view).
   - Starred sessions float to the top of their sort group (after "Last
     modified" sort, starred ones first; same for other sorts).
   - Filter chip "Starred" shows only starred sessions.
   - Empty star state (no stars, "Starred" filter active): "Star a session to
     keep it at the top."

3. **Workspace starring** (`SessionWorkspace.tsx`):
   - Top bar next to the session title: star toggle button.
   - Keyboard shortcut: `Ctrl/Cmd+D` toggles star on the active session.
   - A starred session in the left-panel navigator shows a star icon.

4. **Starred across screens**:
   - Navigating Screen 1 → Screen 2 preserves star state (same store).
   - Imported sessions (Feature 2) that were starred in discovery pre-check
     their checkbox as starred.

5. **Persistence contract**:
   ```
   localStorage['agentdeck-starred'] = JSON.stringify(['id-1', 'id-2'])
   ```
   - Validate on load: if any id isn't in the active session list, keep it
     anyway (session may return later).

---

## Feature 4: Terminal View on Desktop

### Problem
The `TerminalView.tsx` component exists and works (xterm.js with FitAddon,
WebSocket transport), but `SessionWorkspace.tsx` currently **doesn't render it**
on desktop — it's only visible in the mobile `SessionView`. Power users expect
direct terminal access from the desktop workspace.

### Requirements

1. **Terminal as a third panel in `SessionWorkspace.tsx`**:
   - Layout becomes: `[260px navigator] [flexible center] [300-360px right]`.
   - The right panel has **two tabs**: "Context" (existing — metadata, notes,
     references) and "Terminal" (new).
   - Default tab: remember last choice per session in
     `localStorage['agentdeck-terminal-tab-<id>']`.
   - If the session has no running terminal (ACP session, no PTY), the Terminal
     tab shows the same message `TerminalView` already renders: "This session has
     no running terminal to accept input."

2. **Terminal toolbar** (above the xterm container):
   - Session name badge.
   - Terminal controls: "Clear" (sends no-op; just clears the xterm buffer),
     "Copy all" (copies buffer text to clipboard), "Font size − / +".
   - Fit/re-fit button (re-runs `fitAddon.fit()`).
   - Connection indicator: green dot when socket connected, red when
     disconnected (xterm may buffer locally).

3. **Terminal sizing & lifecycle**:
   - Mount xterm when the Terminal tab becomes active (lazy init) — don't
     render hidden terminals.
   - On tab switch away, keep the xterm instance alive but disconnect the
     `ResizeObserver`. On switch back, re-fit.
   - On workspace unmount, dispose of xterm + socket listeners cleanly (no leaks
     — see existing `useEffect` cleanup in `TerminalView.tsx`).
   - Terminal height: fill the panel below the toolbar. Use
     `react-resizable-panels` if it improves the UX, but a flex-column fill is
     acceptable.

4. **Keyboard** (desktop only):
   - `Ctrl+`` ` (backtick) toggles the Terminal tab on the right panel.
   - Terminal-focused keys must not conflict with chat composer (e.g.,
     composer's Enter to send still works when terminal is focused, terminal
     arrow keys don't bubble to the app).

5. **Terminal in `SessionsDashboard.tsx`? No.** Terminal only appears in the
   workspace (Screen 2), never in the session list.

---

## Cross-Cutting Concerns

- **State store**: Keep resume state, star state, and terminal tab preference
  in the Zustand store or localStorage as noted. Don't prop-drain.
- **Styling**: Match the existing design system — see `src/index.css` for CSS
  variables (`--ink`, `--canvas`, `--line`, `--accent-*`, `--field`, `--surface`,
  `--hover`, `--hover-2`). Use Tailwind utility classes consistent with existing
  components. Dark mode must work (the app already supports it via `dark:` classes
  or CSS variables).
- **TypeScript**: No `any`. Strict mode is on. All props typed.
- **Testing**: Add a vitest case for the resume state machine
  (`resumeSession` double-call guard) and the star sort ordering. Tests live
  alongside source: `src/store/resume.test.ts`, `src/components/desktop/star.test.ts`.
- **i18n**: Don't hardcode user-facing strings in a new module — add to the
  existing strings pattern if one exists; otherwise plain English literals are
  fine for this iteration.
- **No breaking mobile changes**: The mobile `App.tsx` branch (under `lg`
  breakpoint) must continue to work. Desktop-only components must not render on
  mobile.

---

## Acceptance Criteria

- [ ] A session with `needs_resume` shows a clear banner in the workspace with
  a Resume button. Clicking it transitions status `needs_resume → resuming → running`.
- [ ] Double-clicking Resume does not fire two requests.
- [ ] Failed resume shows an error notice and keeps the banner visible.
- [ ] Dashboard shows "Discover sessions" with a pending count badge.
- [ ] Discovery panel lists found sessions grouped by agent, allows selective
  import, and surfaces errors per provider.
- [ ] Empty session list shows a "Discover existing sessions" CTA.
- [ ] Starred sessions sort to the top in the dashboard and persist across
  reloads.
- [ ] Star toggle in workspace top bar works; `Ctrl/Cmd+D` shortcut toggles star.
- [ ] Right panel in workspace has Context / Terminal tabs.
- [ ] Terminal tab renders xterm when active, disposes on unmount, re-fits on
  resize.
- [ ] Sessions with no PTY show the "no terminal" message in the Terminal tab.
- [ ] No regressions: mobile layout, existing sync flow, chat composer, and
  config controls all still pass their existing tests.

---

## Suggested Order of Work

1. Starring (Feature 3) — smallest blast radius, no shared state conflicts.
2. Resume fix (Feature 1) — touches the store, do before terminal work so the
   workspace can show resume state.
3. Terminal view (Feature 4) — depends on workspace layout, do after resume.
4. Workspace discovery (Feature 2) — largest UI, reuse the star and sync
   infrastructure from 1 and the dashboard layout from 3.

---

## Key File Map

```
dashboard/
├── src/
│   ├── App.tsx                          ← shell, isDesktop gate, routing
│   ├── store/
│   │   ├── index.ts                     ← Zustand store: sessions, resume, notices
│   │   └── resume.test.ts               ← NEW: resume state machine tests
│   ├── types/
│   │   └── session.ts                   ← SessionStatus, DiscoveredSession
│   ├── lib/
│   │   ├── api.ts                       ← api.sessions, api.sync
│   │   └── format.ts                    ← cn(), relativeTime(), basename()
│   └── components/
│       ├── desktop/
│       │   ├── SessionsDashboard.tsx    ← Screen 1: list + filters + star UI
│       │   ├── SessionWorkspace.tsx     ← Screen 2: nav + center + right panel
│       │   ├── ManagementSidebar.tsx    ← Screen 1 sidebar
│       │   └── star.test.ts             ← NEW: star sort tests
│       ├── TerminalView.tsx             ← xterm renderer (reuse as-is or wrap)
│       ├── SyncSessions.tsx             ← mobile discovery/sync (reference)
│       ├── SessionView.tsx              ← shared session view (mobile + desktop)
│       └── ui.tsx                       ← Button, Chip, Search, Layer, etc.
└── package.json
```

---

## Non-Goals

- Do **not** build mobile discovery UI. Mobile has its own `SyncLayer`; reuse
  logic but don't touch the mobile layout.
- Do **not** implement backend API changes. All endpoints used already exist.
- Do **not** add cloud sync of stars. localStorage only.
- Do **not** build terminal multiplexing (multiple shells). One terminal per
  session.
