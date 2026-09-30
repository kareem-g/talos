# QAI Mobile — UI Language "Signal Deck"

You are restyling React Native screens in `mobile/src`. The data layer
(`src/lib/**`, `src/store/**`, `src/components/motion.tsx`) is DONE — never edit
files there. The design system (`src/design/tokens.ts`, `src/components/ui.tsx`,
`src/components/Screen.tsx`, `src/components/Sheet.tsx`) is DONE — use it, don't
restate it.

## What QAI is

QAI is the mobile command centre for the AI coding agents running on the user's
desktop. The phone is a **remote control**, not a viewer: start, steer, approve,
switch engines, inspect diffs, drive browsers, commit code. Every control maps
to a real daemon capability (the `/api/mobile/*` surface and the `/ws/mobile`
protocol) — never invent one. `scripts/check-api.mjs` cross-checks every HTTP
call in `src/lib/api.ts` against the routes the backend actually registers.

## Golden rules

1. **Preserve functionality exactly.** Every store call, api call, socket call,
   navigation call, prop, callback, conditional, and export keeps working. You
   are changing *visuals*, not behavior.
2. **Keep exported names and prop signatures identical.** Other files
   import them (`PanelHeader`, `PanelTabId`, `AgentDetailScreen`, stray
   re-exports, etc.). Check `grep -rn "YourFile"` before dropping an export.
3. **No raw hex in components ever** (`scripts/check-colors.mjs` fails the
   build). Colours come from Tailwind classes (`bg-surface text-ink-2`) or
   unquoted token expressions (`color={palette.ink3}`). NEVER
   `color="palette.ink3"` (quoted token = silent render failure;
   `check-token-usage.mjs` fails on it).
4. **No new npm dependencies.** Icons: `lucide-react-native`. Motion: the hooks
   in `components/motion.tsx` (`useEnter`, `enterStyle`, `Touchable`,
   `useCollapse`, `useDisclosure`, `LiveHalo`, `Skeleton`, `staggerDelay`).
5. **Typecheck your files when done:** `npx tsc --noEmit` from `mobile/`.

## The language

- **Dark, cut, dense.** `bg-canvas` (#0A0D12) is the page; cards are
  `rounded-lg border border-line bg-surface`; nested blocks `rounded-md
  bg-raised border border-line-strong`; machine output (code, diffs, terminal,
  tool output) lives on `Well` (`bg-code`) — the darkest surface — with the
  `code-*` ink twins (`text-code-ink`, `text-code-dim`, `text-code-ok`…).
  Elevation is a lighter surface plus a hairline, never a shadow; only overlays
  cast (`shadowOverlay`/`shadowFloating`).
- **The accent (#22D3EE signal cyan) is scarce**: primary buttons, selection,
  links, live marks, progress, the brand. Never decoration. Status colours
  (`ok` green, `wait` amber, `danger` red, `info` blue) carry meaning only —
  always via `Dot`/`Badge`/`StatusPill`/`toneSoft` fills.
- **Type**: dense scale — body 14.5/21, caption 13/18, metadata 11.5/15. Big
  titles bold with tight tracking (`letterSpacing: -0.3..-0.6`). Anything
  copyable/id-like is `Mono`. Uppercase mono eyebrows for section labels
  (`Eyebrow`), each preceded by a 2pt accent signal tick (`Section` does this).
  Line-heights must always be set alongside font sizes for multi-line text.
- **Rhythm**: page gutter 16, card padding `p-4`, list rows `min-h-[52px]`,
  gaps 8/12/16. Dense where it counts (rows, chips, readouts); breathing room
  between sections (`gap-5`/`gap-6`).
- **Pressables**: use `Touchable` (spring scale) for custom pressables,
  `Button`/`IconButton`/`ListRow` otherwise. Every one gets
  `accessibilityRole` + `accessibilityLabel`. 48pt minimum touch target —
  smaller visuals grow with `hitSlop`, never with padding.
- **Status is never colour alone**: pair every `Dot` with a word (`StatusPill`)
  or rely on the existing pill/badge labels. `wait`/`danger` dots draw larger
  than `ok`: the states that need a human must be findable while scrolling.
- **States**: `Loading`, `EmptyState` (icon + title + body + action),
  `ErrorState` (message + retry), `Notice` — never a bare spinner or raw text.
  Every failure path gets a Retry; a dead end is a bug.
- **Sheets/modals**: `Sheet`, `ActionSheet`, `PickerSheet`, `FormSheet`,
  `Dialog`, `ConfirmDialog` from `components/Sheet`. Toasts via
  `toast({ message, tone })` from `components/ui`.
- **Numbers**: `tabular-nums` fontVariant for counters; `formatCount`/
  `formatCost` from ui.
- **Entrances**: sections/lists may use `enterIndex` stagger or
  `enterStyle(useEnter(index), 8)`; cap staggers at ~5.

## Navigation grammar

- Tabs: **Deck** (triage + live + quick launch), **Sessions** (browser: search,
  filters, workspace groups, archive), **System** (machinery: agents, usage,
  MCP, browsers, terminals, rooms, tunnels, daemon settings, skills,
  automations), **Settings** (this device: routes, alerts, pairing, about).
  The centre FAB is New Task — the app's only verb.
- Panes open by kind: conversations and the workbench **slide from the right**;
  reference lookups (agents, usage, MCP, browsers, remote, daemon) **rise from
  the bottom** as deck sheets. Pairing fades — it is a gate.
- Every destination is deep-linkable (`qai://` + path); notifications route via
  `navigateToAction`.

## Cheap wins to apply everywhere

- Replace ad-hoc grey boxes with `Card`/`ListCard`; replace ad-hoc pills with
  `Badge`; replace ad-hoc status dot+text with `StatusPill`.
- Titles: `Section` gives tick+eyebrow+title+action layout — prefer it.
- Rounded corners: controls `rounded-sm/md`, cards `rounded-lg`, sheets
  `rounded-xl`; pills only for chips, FABs and segmented tracks.
- Inputs: `Field` / `SearchField` — never a bare TextInput (except inside
  Composer-like docks and the daemon-settings raw editor).
- Prefer `KeyValue`/`FieldRow` for read-only pairs; `CopyButton` on anything
  the user might read aloud (ids, hosts, routes).
