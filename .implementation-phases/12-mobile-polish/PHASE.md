# Phase 12: Mobile Polish

> **Goal**: Make every feature built so far fully responsive and touch-friendly. This is the final pass — ensuring AgentDeck works beautifully on phones and tablets.

---

## What to Build

A comprehensive responsive design pass over all existing features (original + all phases). This is NOT a new feature — it's making everything work on mobile.

### Breakpoints

Define three tiers:

- **Mobile**: below 768px (portrait phones, small devices)
- **Tablet**: 768px – 1024px (landscape phones, small tablets)
- **Desktop**: above 1024px (laptops, desktops, large tablets)

### Layout Changes by Component

#### App Shell

- Desktop: icon rail + full-height screens (current layout)
- Mobile: bottom tab bar with icon + label for each main screen
- The sidebar becomes a bottom sheet that slides up (swipe gesture to open/close)

#### Sidebar

- Desktop: fixed 280px panel with vertical tab strip
- Mobile: bottom sheet (swipe up from bottom), horizontal icon tab strip at top
- Tab panels scroll vertically within the sheet
- Full-width on mobile (no wasted space)
- Drag handle at top of sheet for discoverability

#### Chat / Session View

- Desktop: two-pane (sidebar + chat)
- Mobile: full-screen chat, hamburger menu to access sidebar
- Composer stays at the bottom, fixed, above the tab bar
- Messages scroll in the middle area

#### Working Agents Tab

- Desktop: cards in a list
- Mobile: full-width cards, larger touch targets (min 44px height)
- Status pills slightly bigger for readability

#### Terminals Tab

- Desktop: expandable mini terminal
- Mobile: full-screen terminal when expanded (takes over everything)
- Virtual keyboard should not obscure the terminal input
- Pinch-to-zoom disabled in terminal area (so scroll gestures work)

#### Browser View Tab

- **Hidden on mobile entirely** (per original requirements)
- The icon does not appear in the mobile tab strip
- A note in the PWA docs explains: "Browser view is desktop-only. Use remote view on mobile."

#### Todos & Goals Tab

- Desktop: list with inline controls
- Mobile: full-width rows, swipe actions (swipe left to delete, swipe right to toggle done)
- Larger checkboxes for touch

#### Git Tab

- Desktop: side-by-side file list + diff viewer
- Mobile: stacked layout (file list on top, diff below)
- Stage/unstage buttons larger for touch
- Diff viewer supports horizontal scroll

#### Automations Page

- Desktop: list of cards
- Mobile: single-column cards, full-width
- Create form becomes a full-screen wizard on mobile
- Touch-friendly schedule picker (use native date/time inputs)

#### Skills Page

- Desktop: 3-column grid
- Mobile: single-column list
- Matrix view becomes a scrollable list (workspaces as sections, skills as toggles within)

#### Bots Page

- Desktop: grid of bot cards
- Mobile: single-column cards
- Wizard form becomes full-screen steps on mobile
- Touch-friendly trigger configuration

#### Settings Page

- Desktop: sidebar navigation + content
- Mobile: collapsible sections with accordion pattern
- All toggles and inputs sized for touch

### Touch Interaction Patterns

- All clickable elements: minimum 44×44px touch target
- Swipe gestures for common actions (delete, toggle)
- Pull-to-refresh on lists
- Long-press for context menus (replaces right-click)
- No hover-only interactions (hover is useless on touch)

### Performance on Mobile

- Lazy-load tab panels (don't render until opened)
- Virtual scrolling for long lists (sessions, todos, runs)
- Debounce WebSocket handlers to avoid excessive re-renders
- Limit animation complexity on mobile (respect prefers-reduced-motion)

### PWA Considerations

- The app is already a PWA — ensure all features work offline where possible
- Service worker caches skill definitions, automations config, bot definitions
- Show offline indicator when connection lost
- Queue actions created offline, sync when reconnected

### Testing

Test with Chrome DevTools device emulation for:
- iPhone SE (375px), iPhone 14 (390px), iPhone 14 Pro Max (430px)
- iPad (768px), iPad Pro (1024px)
- A generic Android device (412px)

---

## Acceptance Criteria

- [ ] All existing + new features work on mobile (375px+)
- [ ] Bottom tab bar navigation on mobile
- [ ] Sidebar becomes swipe-up bottom sheet
- [ ] Browser view hidden on mobile (icon removed)
- [ ] All touch targets ≥ 44px
- [ ] Swipe actions on list items
- [ ] No hover-only interactions
- [ ] Performance: smooth scrolling, no jank
- [ ] PWA offline support for cached data
- [ ] Respected prefers-reduced-motion
