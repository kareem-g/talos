# Phase 01: Sidebar Infrastructure

> **Goal**: Transform the current sidebar from a simple session list into a tabbed command center shell that all future phases will plug into.

---

## What to Build

The current sidebar (`HomeSidebar.tsx`) only shows sessions grouped by project. We need to evolve it into a multi-tab command center where each tab reveals a different view of your agent fleet.

### The New Sidebar Layout

The sidebar should have a **vertical tab strip** on its left edge (icon-only, like VS Code or Activity Bar). Clicking an icon swaps the main panel content. The tabs, top to bottom:

1. **Sessions** — the current session list (preserve existing functionality)
2. **Agents** — working agents view (Phase 02 fills this)
3. **Terminals** — active PTY terminals (Phase 03 fills this)
4. **Browser** — built-in browser (Phase 04 fills this)
5. **Tasks** — agent todos and goals (Phase 05 fills this)
6. **Git** — git status and operations (Phase 06 fills this)

### Behavior

- The tab strip is ~48px wide, icon-only with tooltips on hover
- The active tab's panel fills the remaining sidebar width
- Sessions tab remains the default/active view
- Each tab panel is independently scrollable
- Empty states for tabs not yet implemented: show a placeholder with the feature name and "Coming soon"
- The sidebar width stays at 280px for now (the tab strip eats into that space)
- On mobile: the sidebar becomes a bottom sheet, tab strip becomes a horizontal icon row at the top of the sheet

### Interaction Details

- Tab state persists in localStorage (remember which tab the user last opened)
- Keyboard shortcut: Ctrl+Shift+1 through 6 to switch tabs
- The "New task" and "Search" buttons stay at the top, above the tab strip
- The "Connect" button at the bottom stays, below the tab panel

### Visual Style

- Match the existing dark theme (#0a0a0c background, zinc text colors)
- Active tab: subtle white/10 background, white icon
- Inactive tab: zinc-500 icon, hover → zinc-300
- Tab panels fade in on switch (animate-fade class already exists)

---

## Acceptance Criteria

- [ ] Sidebar has a vertical icon tab strip with 6 tabs
- [ ] Sessions tab shows the current session list unchanged
- [ ] Other tabs show placeholder content
- [ ] Tab switching works smoothly with localStorage persistence
- [ ] Keyboard shortcuts work
- [ ] Mobile: sidebar becomes bottom sheet with horizontal tab row
- [ ] No existing functionality broken
