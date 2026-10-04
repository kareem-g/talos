# QAI Mobile — the approved iOS design ("black glass")

You are restyling React Native screens in `mobile/src`. The data layer
(`src/lib/**`, `src/store/**`, dashboard code under the `@/` alias) is DONE —
never edit files there. The design system (`src/design/tokens.ts`,
`src/components/ui.tsx` if present, `src/ui.tsx`) is the shipped one — use it,
don't restate it.

## What QAI is

QAI is the mobile command centre for the AI coding agents running on the user's
desktop. The phone is a **remote control**, not a viewer: start, steer, approve,
switch engines, inspect diffs, drive browsers, commit code. Every control maps
to a real daemon capability (the `/api/mobile/*` surface and the `/ws/mobile`
protocol) — never invent one. `scripts/check-api.mjs` cross-checks every HTTP
call in `src/lib/api.ts` against the routes the backend actually registers.

## The reference

The approved HTML mockups in `design/` ARE the design: true black canvas,
elevated grouped cards (`#1c1c1e` on `#000000`), capsule controls, tint status
pills, the SF-style type ramp on the system font with JetBrains Mono reserved
for machine text, one iOS blue accent (`#0A84FF`), and the traffic-light states
(green alive, orange needs-you, red failed, sky held). `design/shared.css`
tokens map name-for-name onto `src/design/tokens.ts` — `bg-surface` there is
`.card` here. The blur chrome in the mockups renders as `expo-blur` (tab bar,
session header) with the `chromeOverlay` dimming layer.

## Golden rules

1. **Preserve functionality exactly.** Every store call, api call, socket call,
   navigation call, prop, callback, conditional, and export keeps working. You
   are changing *visuals*, not behavior.
2. **Keep exported names and prop signatures identical.** Other files
   import them (`PageShell`, `EnginesScreen`, stray re-exports, etc.). Check
   `grep -rn "YourFile"` before dropping an export.
3. **No raw hex in components ever** (`scripts/check-colors.mjs` fails the
   build). Colours come from Tailwind classes (`bg-surface text-ink-2`) or
   unquoted token expressions (`color={palette.ink3}`). NEVER
   `color="palette.ink3"` (quoted token = silent render failure;
   `check-token-usage.mjs` fails on it).
4. **No new npm dependencies.** Icons: the locally drawn lucide-equivalent
   glyphs in `src/screens/glyphs.tsx` (react-native-svg). Blur:
   `expo-blur`. Motion: the hooks/Animated patterns already in the tree.
5. **Typecheck your files when done:** `npx tsc --noEmit` from `mobile/`, then
   `npm run verify` (typecheck + tests + api/colors/tokens/motion guards).

## The language

- **True black, elevated greys, capsules.** `bg-canvas` (#000000) is the
  page; cards and rows sit on `bg-surface` (#1C1C1E), nested controls on
  `bg-raised` (#2C2C2E), fields and chips recess to `bg-field`
  (rgba white 8%). Machine output (code, diffs, terminal) lives on `bg-code`.
  Elevation is a lighter surface, never a shadow; only overlays cast
  (`shadowOverlay`).
- **Buttons are capsules.** `IconButton` is a circle (`bg-field` fill, accent
  tint when active) — the round chrome buttons. Labelled actions are capsules
  (`Button`, rounded-full); the primary action is the **blue fill**
  (`bg-accent`, white ink) — Allow, Resume, Start Session, Confirm. Secondary
  actions take `bg-raised`; destructive takes the red tint.
- **One accent — iOS blue (#0A84FF)**: links, selection, live marks, the
  brand, blue leading icons in sheets. State colours: green alive, orange
  needs-you, red failed, sky held — always via `Dot`/`StatusPill`
  (`toneTint` fills, no borders).
- **Type**: the system face (SF on iOS, Roboto on Android) via the
  `resolveFont` weight map — never name a sans family. Sizes: large title 33
  bold (-0.5 tracking), row primary 15-15.5, secondary 12.5, captions 11-11.5,
  metadata in `MONO` for anything copyable/id-like.
- **Rhythm**: page gutter 16, card rows `min-h-[52px]` with inset separators
  (0.5px, from 36px under the leading dot), gaps 8/12/16, section heads 13px
  semibold. Scroll content clears the floating tab bar with ~110px bottom
  padding.
- **Pressables**: use `Touchable` (spring scale) for custom pressables,
  `Button`/`IconButton` otherwise. Every one gets `accessibilityRole` +
  `accessibilityLabel`. 44pt minimum touch target — smaller visuals grow with
  `hitSlop`, never with padding.
- **Status is never colour alone**: pair every `Dot` with a word
  (`StatusPill`); pulsing dots mark live/working states.
- **States**: `Dots` loader, skeleton blocks in final geometry (`HomeSkeleton`
  pattern), `EmptyState` (dashed card + title + body + action), `Notice`
  strips. Every failure path gets a Retry; a dead end is a bug.
- **Sheets/panes**: `Layer` — bottom sheets rise with a grabber, pinned
  footer actions; side panes (sessions left, model & permissions right) at
  82% width. One modal at a time; chain with `useLayerChain`.
- **Numbers**: `tabular-nums` fontVariant for counters and costs.

## Navigation grammar

**Five tabs, one stack.**

- **Tabs** (blurred bar): Home · History · Agents · Usage · Config. The tab
  bar is `expo-blur` over scrolling content.
- **Home** (`Main`) — the large-titled projects screen: connection truth,
  filter chips, the needs-you triage with inline Allow/Resume/Retry, Active,
  and the collapsible project groups. The "New Session" wizard opens from the
  header plus, every project header, and the empty state.
- **Agents** (`Engines`) — one screen, two segments: Agents (the provider
  fleet, re-scan) | Browsers (the CDP engines, start/stop). The Browsers
  route (`qai://browsers`) pushes the same screen on its Browsers segment.
- **Session** — pushes from the right: translucent compact header (back ·
  title + status + project · model & permissions · sessions · detail toggle),
  the timeline, the composer. The sessions pane slides from the left and
  replaces the route on switch (the back stack never grows).

The **new-task wizard** (`NewTaskLayer`) is a bottom sheet mounted at the app
root and opened from anywhere via `useShell().openNewTask(project?)`.
Navigation goes through `navigationRef` (never `useNavigation` above the
container). Panes open by kind: conversations push from the right; sheets rise
from the bottom. Pairing fades — it is a gate, and it resets the root to
`Tabs` on success. Every destination is deep-linkable (`qai://` + path);
notifications route via `navigateToAction`.

## Cheap wins to apply everywhere

- Replace ad-hoc grey boxes with grouped `bg-surface` cards; replace ad-hoc
  pills with `StatusPill`; replace ad-hoc status dot+text with `Dot` + word.
- Round chrome: header controls are `IconButton` circles; the primary verb is
  the blue capsule `Button`; searches are field-filled `TextField`s.
- Titles: large titles (33 bold) scroll with content; section heads are 13px
  semibold, never heroes.
- Rounded corners: controls are PILLS, cards `rounded-card` (16), sheets
  `rounded-sheet` (22), tags `rounded-sm` (6).
- Inputs: `TextField` — never a bare TextInput (except inside the composer
  dock).
- Prefer `Segmented` for sibling lists (Agents | Browsers); `SectionLabel`
  for layer sections; mono values in rows for anything id-like.
