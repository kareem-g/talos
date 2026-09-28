# Redesign: unified three-pane shell (reference: muse-style agent workspace)

The brief pins the visual direction with the reference picture: a near-black
workspace, three columns — nav sidebar / chat / tool-output panel — warm-orange
accent on the primary actions (send button, model chip), hairline dividers,
uppercase micro-labels in the sidebar, and a profile card pinned to the
sidebar bottom. Mobile gets two screens: dashboard, then chat.

The existing AgentDeck token system already speaks this language
(`--canvas #131315`, `--surface`, ink ramp, `--orange #db6d28`), so this is a
**structural** redesign: new shell, new nav, new center chat pane, restyled
tool panel, new mobile flow. No palette overhaul.

## Desktop — one unified screen

```
┌──────────┬──────────────────────────────┬────────────┐
│ AppNav   │ SessionChat                  │ ToolPanel  │
│ 224px    │  header: title · Share ·    │ 400px card │
│          │         Browser toggle · ⋯   │ ┌────────┐ │
│ GET      │  transcript (Timeline)       │ │Browser │ │
│ STARTED  │  composer (StateZone)        │ │Files(1)│ │
│  Home    │                              │ ├────────┤ │
│ PRODUCTS │  or nav page when no session │ │ content│ │
│  Agents  │  is open (Home/Agents/      │ └────────┘ │
│  Browsers│  Browsers/History/Usage/     │  RightRail │
│ MANAGE   │  Configuration)              │            │
│  History │                              │            │
│  Usage   │                              │            │
│  Config >│                              │            │
│ ─────── │                              │            │
│ History  │                              │            │
│ session… │                              │            │
│ ─────── │                              │            │
│ Quick    │                              │            │
│ Access   │                              │            │
│ profile  │                              │            │
└──────────┴──────────────────────────────┴────────────┘
```

- `AppShell` owns: `page` (nav page or session), mobile drawer, tool-panel
  visibility. Route `/session/<id>` forces the session view; nav clicks
  `replace('/')` so the URL stays clean; back from a session exits to Home.
- `AppNav` — the reference sidebar. Grouped nav with uppercase micro-labels,
  session History list (store.sessions), Quick Access footer (API Key copies
  the device token, Agent Setup → agents page, Documentation → repo), profile
  card (local device identity).
- `SessionChat` — center pane for a session. Header: title + provider dot,
  Share (copy link), Browser toggle (panel), overflow (star / copy link /
  export JSON / delete). Body: `Timeline` + `FloatingHud`. Bottom:
  `StateZone` composer with the model chip docked right (EngineModelMenu +
  Thought + Permission chips), wired through `createSessionSendHandlers`.
- Nav pages (center, no session open):
  - Home → `StationHome` (control station; anchor strip sticky offset → top-0)
  - Agents → new `AgentsPage` (providers + state + remedies, real data)
  - Browsers → new `BrowsersPage` (browserApi.status + start/stop)
  - History → new `HistoryPage` (sessions grouped by day)
  - Usage → new `UsagePage` (per-session + total tokens/cost from usage parts)
  - Configuration → `SettingsSection` (existing)
- Tool panel: `RightRail` inside a rounded card wrapper (`p-3`,
  `rounded-2xl border`), collapsible via the Browser header button. Tab
  registry gains a **Terminal** tab (for interactive-terminal agents); the
  `file` tab is relabeled **Files** per the reference.

## Mobile — two screens

1. **Dashboard** — top bar (menu button + brand + connection pill) over
   `StationHome`. Menu opens `AppNav` as a left drawer.
2. **Chat** — tapping a session (nav History, Home sessions, Browsers,
   History page) pushes `SessionView` (existing, back button exits to the
   dashboard). Tool panel stays a right sheet there.

`AttentionPill` (approval pager) and the ⌘K palette remain overlays in App.

## File plan

- New: `components/AppShell.tsx`, `components/AppNav.tsx`,
  `components/SessionChat.tsx`, `components/views/AgentsPage.tsx`,
  `components/views/BrowsersPage.tsx`, `components/views/HistoryPage.tsx`,
  `components/views/UsagePage.tsx`
- Edit: `App.tsx` (shell host), `StationHome.tsx` (anchor offset prop),
  `session/rightTabs.ts` (terminal tab, Files label), `session/RightRail.tsx`
  (TerminalView case)
- Left on disk but unimported: `SessionWorkspace`, `LeftSidebar`, `TopBar`,
  `FloatingHud` (still used by SessionChat), `ManagementSidebar`, `HomeSidebar`
  — a later cleanup pass removes them.

## Verify

- `tsc --noEmit`, `vite build`
- Run daemon + dev server; screenshot desktop (home, session with panel),
  mobile (dashboard, chat). Compare against the reference.
