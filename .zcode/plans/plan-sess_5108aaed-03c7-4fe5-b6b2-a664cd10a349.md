# Plan: Mobile-Responsive CLI + Tmux-Inspired Command Bar

## Scope (focused)
The only interactive terminal in the app is the mobile `RawDebugView` (xterm.js). Desktop uses a read-only `<pre>` raw-output view, which the task says to preserve as-is. This plan overhauls the **mobile terminal screen** into a responsive, touch-friendly CLI with a tmux-inspired command bar — and leaves desktop untouched.

## New components

### 1. `src/components/MobileTerminal.tsx` — the responsive terminal screen
Replaces the inline `RawDebugView` usage in `MobileApp`. Layout (mobile-first):
```
┌──────────────────────────┐
│ Back  SessionName  ● Chat│  ← compact safe-area header
├──────────────────────────┤
│                          │
│      xterm viewport      │  ← flex-1, fills available height
│      (raw output)        │
│                          │
├──────────────────────────┤
│ [command input      ] ↑  │  ← text input, sends on Enter
├──────────────────────────┤
│ [⌘][↑][↓][Tab][Ctrl] →   │  ← horizontally scrollable quick actions
└──────────────────────────┘
```
- Uses existing `XtermTerminal` for rendering.
- Connection state dot (Connected/Connecting/Reconnecting/Disconnected) in header.
- Respects `env(safe-area-inset-*)`.

### 2. `src/components/TerminalCommandBar.tsx` — tmux-inspired toolbar
Sends **real keystrokes** through the existing `onData` path (never fakes terminal text):

| Button | Sends |
|--------|-------|
| Ctrl+C | `\x03` |
| Ctrl+D | `\x04` |
| Ctrl+Z | `\x1a` |
| Ctrl+L | `\x0c` |
| Tab | `\t` |
| Esc | `\x1b` |
| Enter | `\r` |
| ↑ ↓ ← → | `\x1b[A` / `\x1b[B` / `\x1b[D` / `\x1b[C` |
| Clear | `\x0c` (Ctrl+L) |
| More → | opens popover with Home/End/PageUp/PageDown |

- Touch targets ≥ 40px, visible `active:scale-95` pressed state, `aria-label` on every button.
- Horizontally scrollable on mobile (`overflow-x-auto`, no wrap); wraps naturally on desktop.
- "More" popover uses native `<dialog>` or a simple absolutely-positioned menu (no new deps).

### 3. `src/components/TerminalInput.tsx` — command input
A single text input above the command bar. On Enter, sends the line + `\r` via `onData` and clears. Preserves local input history (↑/↓ through the input's own history buffer for repeated commands).

### 4. `src/hooks/useTerminalResize.ts` — mobile-aware resize
Wraps the existing `ResizeObserver` + `FitAddon.fit()` with mobile corrections:
- Uses `window.visualViewport` to detect mobile keyboard open/close.
- Recalculates xterm cols/rows from the container's CSS pixel size and calls `fit()`.
- Listens to `orientationchange` and `resize`.
- Dispatches a backend `TerminalResize` message `{ cols, rows }` when dimensions change (best-effort; only if the backend supports it — the WS send path already exists).

## Wiring changes

### `src/components/MobileApp.tsx`
- Import `MobileTerminal`, replace the `debug ? <RawDebugView .../> : ...` block with `<MobileTerminal rawOutput={rawOutput} onData={...} onBack={...} />`.
- Remove the now-unused `RawDebugView` (or keep exported; delete to avoid dead code).

## Out of scope (intentionally)
- Desktop debug view (read-only, task says preserve).
- Backend tmux session/pane multiplexing (not supported by backend) — buttons map to keystrokes only.
- Quick-command preset buttons (`ls`, `git status`) — the task lists these as "examples that the architecture should define"; the command input + history covers them without hardcoding.
- Persisting quick-command sets.

## Verification
- `tsc` + `pnpm build` pass.
- Browser: open a task, tap CLI tab → see responsive terminal + header + input + scrollable command bar. Resize viewport/orientation → terminal reflows. Tap Ctrl+C / arrows → sent as real input.