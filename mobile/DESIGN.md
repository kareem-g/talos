# V3 UI Language — "Midnight Studio" (rewrite spec)

You are restyling React Native screens in `mobile/src`. The data layer
(`src/lib/**`, `src/store/**`, `src/components/motion.tsx`) is DONE — never edit
files there. The design system (`src/design/tokens.ts`, `src/components/ui.tsx`,
`src/components/Screen.tsx`, `src/components/Sheet.tsx`) is DONE — use it, don't
restate it.

## Golden rules

1. **Preserve functionality exactly.** Every store call, api call, socket call,
   navigation call, prop, callback, conditional, and export keeps working. You
   are changing *visuals*, not behavior.
2. **Keep exported names and prop signatures identical.** Other files and tests
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
5. **Typecheck your files when done:** `npx tsc --noEmit` from `mobile/` — fix
   any error in files YOU touched (ignore errors in files another agent owns).

## The language

- **Canvas** `bg-canvas` is the page. **Cards** are `rounded-lg border border-line
  bg-surface` (use `Card` / `ListCard`). Inner/nested blocks: `rounded-md
  bg-raised border border-line-strong`. Wells (code/terminal/diffs):
  `Well` (`bg-code`).
- **The accent (#7A9BFF) is scarce**: primary buttons, selection, links, live
  marks, progress. Never decoration. Status colours (`ok` green, `wait` amber,
  `danger` red, `info` blue) carry meaning only — always via `Dot`/`Badge`/
  `StatusPill`/`toneSoft` fills.
- **Type**: big titles are bold with tight tracking (`letterSpacing: -0.3..-0.8`).
  Body 15.5/22 (`Txt as="body"` or `text-[15.5px] leading-[22px]`). Metadata
  12px `text-ink-3`. Anything copyable/id-like is `Mono`. Uppercase eyebrows for
  section labels (`Eyebrow`). Line-heights must always be set alongside font
  sizes for multi-line text.
- **Rhythm**: page gutter 16–18 (`px-4`), card padding `p-4`, row height
  `min-h-14`, gaps 8/12/16. Generous vertical breathing room between sections
  (`gap-5`/`gap-6`); the look is calm, not dense.
- **Pressables**: use `Touchable` (spring scale) for custom pressables,
  `Button`/`IconButton`/`ListRow` otherwise. Every one gets
  `accessibilityRole` + `accessibilityLabel`.
- **Status is never colour alone**: pair every `Dot` with a word (`StatusPill`)
  or rely on the existing pill/badge labels.
- **States**: `Loading`, `EmptyState` (icon + title + body + action),
  `ErrorState` (message + retry), `Notice` — never a bare spinner or raw text.
- **Sheets/modals**: `Sheet`, `ActionSheet`, `PickerSheet`, `FormSheet`,
  `Dialog`, `ConfirmDialog` from `components/Sheet`. Toasts via
  `toast({ message, tone })` from `components/ui`.
- **Numbers**: `tabular-nums` fontVariant for counters; `formatCount`/
  `formatCost` from ui.
- **Entrances**: sections/lists may use `enterIndex` stagger or
  `enterStyle(useEnter(index), 8)`; cap staggers at ~5.

## Cheap wins to apply everywhere

- Replace ad-hoc grey boxes with `Card`/`ListCard`; replace ad-hoc pills with
  `Badge`; replace ad-hoc status dot+text with `StatusPill`.
- Titles: `Section` gives eyebrow+title+action layout — prefer it.
- Rounded corners: controls `rounded-md`, cards `rounded-lg`, chips/pills
  `rounded-pill`.
- Inputs: `Field` / `SearchField` — never a bare TextInput (except inside
  Composer-like docks).
- Prefer `keyValue`-style label rows (`KeyValue`) for read-only pairs.
