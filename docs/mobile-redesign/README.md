# QAI Mobile — Redesign Proposal

**Status: design only. No app code has been changed.**

This is a complete replacement of the mobile UI/UX. Nothing from the current mobile theme is reused: new navigation, new surfaces, new accent, new geometry, new type, new components, new screens, new states. The data layer (`src/lib/**`, `src/store/**`) is untouched and is the thing the new UI plugs into.

---

## 1 · How to view this

| File | What it shows |
|---|---|
| [`index.html`](index.html) | Landing page linking every board |
| [`1-system.html`](1-system.html) | Palette, type, geometry, signature components, navigation architecture, desktop→mobile mapping |
| [`2-deck.html`](2-deck.html) | Deck (home), Sessions browser, Command sheet, alerts/push |
| [`3-session.html`](3-session.html) | Session: RunBar, transcript, approval card, composer, diff review |
| [`4-panels.html`](4-panels.html) | Model & permissions, workspace panel sheet, Git & worktrees, Terminal, Browser, subagents |
| [`5-machinery.html`](5-machinery.html) | Station, Agents, Usage, MCP, Remote access, Device |
| [`6-states.html`](6-states.html) | New task (2 steps), pairing gate, and every state incl. long-content and keyboard |

Both the `.html` files (interactive, best fidelity) and the rendered `out-*.png` screenshots are in `docs/mobile-redesign/`.

---

## 2 · The direction: “Console”

QAI is a **remote control for AI agents running on your desktop**. The phone is not where you read a transcript — it is where you find out something needs you and act on it in seconds. So the whole design is built around one question, *“does anything need me?”*, and one verb, *resolve it*.

The colour is **the desktop’s own dark theme**, ported 1:1 from `dashboard/src/index.css`; the geometry is a new **instrument console** built on top of it:

| Axis | Old mobile design | This design |
|---|---|---|
| Base | warm charcoal `#131315` | **the desktop’s warm charcoal**, kept verbatim |
| Accent | soft blue `#5B8DEF` | **the desktop’s soft blue `#5B8DEF`**, kept |
| Signals | green / copper / terracotta fills | **no green, yellow or orange in the chrome.** Attention = **inverted paper ink**, live = the accent, failure = the desktop’s red, done = muted grey |
| Geometry | full pills, soft fills, blur/glass | **rectilinear: 10px cards, 8px controls, 4px tags, 1px hairlines, no blur** |
| Type | system sans + system mono | **Space Grotesk** (voice) + **JetBrains Mono** (every readout) + **Inter** (agent prose) |
| Chrome | blurred bars, gradient scrims | flat chrome, hairline borders, shadows only under sheets |
| Home | a dashboard of counts | **the blocker is the hero**, resolvable in place |

**Signature elements**, used everywhere so the app reads as one instrument:

1. **The state rail** — a 3px vertical bar (4px when blocked) on the left edge of every session/tool/agent object. **Paper ink `#F2F2F3` = a human is required**, accent blue = working (pulses), red = failed, grey = idle/done. Attention is the only white rail in the app, so it is unmistakable without spending a hue on it.
2. **The fleet band** — a strip at the top of the Deck where every session is one tick, blocked ones tallest and drawn in paper ink. A glance answers “is anything wrong?”, and every tick is a jump target.
3. **The RunBar** — a 46px readout under the session header: state, a live activity sparkline, elapsed, cost and a context-window ring. The desktop’s floating HUD, folded into one strip.
4. **Mono readouts** — every number, id, path, timestamp, counter and status word is JetBrains Mono with tabular figures, so the app reads in columns like an instrument.

---

## 3 · Design tokens

**Surfaces** — the desktop’s own ramp, verbatim (`dashboard/src/index.css`). Elevation is a lighter surface + hairline, never a shadow:

```
code #161618   well #19191C   canvas #131315   chrome #17171B
field #202024  surface #26262B  raised #2E2E34  hover #39393F
line #34343A   line-strong #42424A
```

**Ink:** `ink #F2F2F3` · `ink-2 #B0B0B6` · `ink-3 #7E7E86` · `ink-4 #5B5B63` (disabled only)

**Signals — no green, no yellow, no orange in the chrome:**

| Token | Value | Job |
|---|---|---|
| `accent` | `#5B8DEF` | primary action, selection, live marks, links, brand |
| `attention` | `#F2F2F3` (paper ink) | a human is blocking the run — delivered by **inversion**, not hue: the only white rail, the only white pill, a lifted card |
| `danger` | `#F85149` | failed, errored, destructive |
| `info` | `#6396CC` | queued, held, paused — a desaturated sky, never a second accent |
| `done` | `#7E7E86` (muted) | completed, ended, archived — finished work recedes |

The one deliberate exception is **diff plates**: additions stay conventionally green (`#6FBC7F` on `rgba(111,220,158,.11)`) because a unified diff that is not green/red is materially harder to review. That is content on a machine plate, not chrome. Say the word and it becomes blue/red instead.

**Geometry:** tags 4px · controls 8px · cards 10px · sheets 18px (top only). No pills except the status chip, the fleet tick caps and the floating “Latest” control.

**Type scale:** display 27/700 · title 19/700 · heading 15/600 · label 13/500 · prose 13.5/400 (Inter) · mono 12/400 · eyebrow 10/600 uppercase +1.5 tracking.

**Motion:** 90ms press · 170ms state change · 260ms overlay in · spring for anything with mass (sheets, drawers). Sheets dismiss past 900px/s. Staggers cap at 5.

**Agent identity hues** — a cool set, shifted off the desktop’s warm six so nothing in the chrome is green/yellow/orange and nothing competes with the accent: claude `#A78BFA`, codex `#6FAEE8`, opencode `#E08FC0`, gemini `#8FB8E8`, copilot `#C08CF0`, kimi `#7FA6D8`, grok `#8B93A3`. They identify *which* agent, never state, and never read as actionable. (If you want mobile↔desktop parity on identity colour, we keep the desktop six instead — it is one constant.)

---

## 4 · Navigation architecture (item 1 of the brief)

```
Root
├─ Tabs — bottom bar, always present
│  ├─ Deck        triage: blocked first, fleet band, working, recent
│  ├─ Sessions    browse: search · 5 filter facets · workspace groups · archive
│  ├─ ✚ Command   universal action → sheet (new task, search, quick actions)
│  ├─ Station     machinery: agents · browser engines · terminals · rooms ·
│  │              MCP · tunnels · usage · skills · automations · daemon settings
│  └─ Device      this phone: connection & routes · alerts · identity · about · unpair
│
├─ Session        push →, full screen (the desktop centre pane)
│  ├─ RunBar           live state readout
│  ├─ Transcript       every desktop part type, rendered
│  ├─ Composer dock    prompt · attach · queue/steer · stop · config chips
│  ├─ Workspace sheet  Plan│Agents│Goal│Git│Files│Browser│Terminal│Rooms│Projects│Trace│Side
│  ├─ Controls sheet   model & permissions · engine switch
│  ├─ Spawn sheet      one subagent / fan-out
│  └─ Sessions sheet   switch session inside the workspace
│
├─ Workspace      push ↑, full screen — diff · files · terminal · browser
├─ AgentDetail    sheet ↑
├─ Machinery      push ↑ — usage · mcp · tunnels · daemon settings · skills (from Station)
└─ Pairing        fade — the gate
```

**Presentation grammar** (kept from the existing router contract, so deep links and notification routing keep working):

| Kind | Presentation | Examples |
|---|---|---|
| Conversations & workbench | slide from right, full screen | Session, Workspace |
| Reference lookups | rise from bottom, detented sheet | AgentDetail, panel sheet, controls |
| Destinations inside a tab | push ↑ | MCP, Tunnels, Daemon settings, Usage |
| The gate | fade | Pairing |

Deep links keep the `qai://` scheme for every destination; notification taps route to the session (and never silently resolve an approval).

**Desktop → mobile mapping**

| Desktop surface | Mobile home |
|---|---|
| Left sidebar nav | Bottom tab bar (4 destinations) |
| Control Deck home | Deck tab — attention is the hero |
| History page | Sessions tab (day grouping + filters) |
| Centre chat pane | Pushed full-screen Session |
| Right rail, 12 tabs | Session panel sheet + full-screen Workspace |
| Floating HUD | RunBar + panel sheet |
| Session controls / engine menu | Model & permissions sheet |
| Command palette ⌘K | Command sheet (✚) + Sessions search |
| Attention pill | Deck hero + fleet band + pinned banner |
| Dropdown / context menus | Action sheet, long-press, swipe rows |
| Modals / layers | Detented bottom sheets |
| Global shortcuts ⌘N/⌘K/Esc | ✚ button, search field, system back |

---

## 5 · Screen-by-screen spec (brief items 2–15)

Each is shown on the boards; this is the written contract.

### 5.1 Deck (board 02, frame 01)
Order: app bar (brand · station name · connection pill · alerts) → **fleet band** → **Needs you** hero (up to 2, then “view all”) → **Working** rows → **Recent** peek → tab bar with raised ✚.
Attention cards resolve **in place**: a paper-ink rail, a lifted card, the app’s only inverted white pill, the exact command on a machine plate, the risk badge, waiting time, and `Deny` / `Allow once`. The affirmative button is the same accent primary used everywhere else — the card’s inversion is what makes it loud, not a special colour. A question-type block gets `Answer`. Tapping the row opens the session.
Empty state is a first-class design (“All clear” + an invitation), not a blank screen.

### 5.2 Sessions (board 02, frame 02)
Search field; five filter chips with live counts (All / Attention / Active / Starred / Archived); day-grouped rows with agent avatar, state rail, name, workspace + age, status pill. **Swipe** = star / archive. **Long-press** = fork, resume, copy link, export JSON, delete. Pull to refresh.

### 5.3 Session (board 03, frames 05–08)
Header: back · agent avatar · name + provider/workspace · panel opener · overflow. **RunBar** below it. Transcript renders every desktop part type: user turn slabs (token counts), agent prose with a chip, collapsible reasoning, folded tool groups with per-step verb/path/diffstat/exit, plan cards, approval cards, file chips → diffs, verification cards, subagent/orchestration/progress/search/git-commit/browser/error/image rows, usage + turn-summary footers.
Composer: queue block with **Steer / Edit / Del**, config chips (model · thought · permission), attachments, slash-command menu, send ↔ queue+stop.
Every state the desktop’s `StateZone` covers maps to a RunBar variant plus a banner: working, approval, input, paused, resuming, failed, ended, archived, reconnecting, offline.

### 5.4 Agent controls & model/provider selection (board 04, frame 09)
One sheet: engine row → engine switch sheet (agent radios, optional model, warning notice, “keep current” model); the four permission modes with plain-language consequences; then every `ConfigOption` the daemon reports, each tagged **live** or **next run** so nothing pretends to apply instantly. Custom model ids are enterable.

### 5.5 Chat / prompt interface (board 03, frame 07)
Slash menu = builtin per agent + QAI’s own verbs (`orchestrator, review, plan, worker, summarize, side, btw`). `@` files, `$` skills, `#` rooms. Attachments via picker/camera, resized and uploaded to the same endpoint. Queue while working, steerable.

### 5.6 Tool / event views (board 03 frame 08, board 04 frames 12–13)
Tool runs fold into one card with a footer (`N steps · time · failed · running`); the in-flight step is the only highlighted one. Raw input/output open on the machine plate, clamped with an honest line count. Terminal is a plate reader with a **key strip** (Ctrl-C, Tab, Esc, arrows) because a soft keyboard cannot send those. Browser is a live CDP mirror with tap-to-click, plus the workspace app-server card.

### 5.7 Diff / review (board 03 frame 08, board 04 frame 11)
Changed files collect into a card with status letters (M/A/D/R/?) and ±stats; each opens a unified diff on the plate. Full-screen Workspace gives the diff the whole width, with a sticky filename, hunk count, Next/Prev and copy.

### 5.8 Worktree interface (board 04, frame 11)
Branch switch (checkout / create) and the worktree list with per-row open and session counts. **Read-only, matching both the daemon and the desktop** — neither exposes create/merge/remove for worktrees.

### 5.9 Permissions / approval flows (board 03 frame 06, board 02 frame 04)
In-transcript blocked card: paper-ink rail, inverted header, risk pill, question, exact command, then a radio list of *every* option the daemon returned — single-select, multi-select with confirm, `always` variants, free text, and plan approve/decline/suggest. Resolved state collapses to one row. The push notification carries **Allow / Deny** inline. Composer locks until answered.

### 5.10 Settings (board 05, frames 15/19/20)
Split by ownership. **Station** = the daemon’s world: agents, browser engines, terminals, rooms, MCP servers, tunnels, usage, skills, automations, daemon settings (raw editor with type badges, “modified — was …”, undo, save). **Device** = this phone: route choice with latencies and a preferred pin, alert permission + test, device token, re-pair, about, unpair.

### 5.11 Notifications / status (board 02, frame 04)
Three triggers carry over exactly: approval required, task finished, agent stopped. Each uses the rail colour language; the approval push is actionable. In-app, the same summary is a pinned banner. Connection state is always visible in the app bar (Live / Reconnecting / Offline / Error) with a route-switch escape on error.

### 5.12 Important sheets (boards 02–04)
Command, New Task (2 steps), Model & permissions, Engine switch, Workspace panel, Spawn, Action sheet, Picker, Confirm dialog. All detented, keyboard-avoiding, dismissible by drag or back.

### 5.13 Loading / error / empty / long / keyboard (board 06)
Skeletons mirror the real layout. Empty is an invitation with an action. Errors state the code, the route that failed, a retry, and the alternative that works. Offline keeps the cached transcript readable and locks the composer *with a reason*. Reconnecting shows attempt N and elapsed. Long paths ellipsise keeping the tail; long tool output clamps with a line count; long sessions stop auto-follow and offer “Latest”; with the keyboard open the composer lifts rather than being covered.

### 5.14 Overall component direction (board 01)
One kit: `Card`, `ListRow`, `StateRail`, `StatusPill`, `Badge`, `Chip`/`FilterChip`, `ConfigChip`, `Field`/`SearchField`, `Well` (machine plate), `Button`/`IconButton`, `Segmented`, `Toggle`, `Stat`/`ProgressBar`/`KeyValue`, `Section` (tick + eyebrow + title + action), `EmptyState`/`ErrorState`/`Notice`/`Loading`, and the sheet family. Every pressable gets a role + label and a ≥48pt target (visuals grow with `hitSlop`, never with padding).

---

## 6 · Desktop feature parity (brief items 3, 8)

Every desktop capability and where it lives on mobile. **No feature is dropped.**

| # | Desktop capability | Mobile |
|---|---|---|
| 1 | Session list / Control Deck triage | Deck tab |
| 2 | Session chat + state machine | Session screen + RunBar |
| 3 | Create session (workspace/agent/model/prompt) | Command → New Task, 2 steps |
| 4 | Resume / stop / interrupt / delete / archive / restore | Session overflow + swipe + long-press |
| 5 | Fork session | Session overflow |
| 6 | Switch engine / model mid-session | Model & permissions → Engine switch |
| 7 | Permission modes (ask / auto-edit / plan / full) | Model & permissions |
| 8 | Prompt input, streaming, queue, steer, stop | Composer |
| 9 | Prompt history / resend last | Overflow → Retry last prompt |
| 10 | Tool activity, commands, exit codes, durations | Tool group card |
| 11 | Reasoning blocks | Collapsible “Thought for Ns” |
| 12 | Plans (proposed/approved/declined/completed, steps) | Plan tab + transcript plan card |
| 13 | Goals / todos / progress | Goal tab + ProgressRow |
| 14 | Approvals (single, multi, always, custom, plan) | Approval card + push actions |
| 15 | Questions (AskUserQuestion) | Approval card question variant |
| 16 | Subagents + orchestration fan-out/merge | Spawn sheet |
| 17 | Rooms (list, roster, open channel) | Station › Rooms + Rooms tab |
| 18 | Git branches / checkout / create | Git tab + full-screen Git |
| 19 | Git log / graph | Git tab commit history |
| 20 | Git diff (file + inline + full) | Diff card → Workspace |
| 21 | Git commit + push + generated message | Git tab commit composer |
| 22 | Changed files, statuses, ±stats | Files/Git lists |
| 23 | Worktrees (list, overview) | Git tab worktrees |
| 24 | Files tree + file preview | Files tab |
| 25 | Terminals (list, create, close, input, resize) | Terminal tab + Station |
| 26 | Browser: app-server presets, run/stop/open | Browser tab |
| 27 | Browser CDP: state, screenshot, click/type/press/scroll/nav | Browser tab + tool calls |
| 28 | MCP servers (list, add, remove) | Station › MCP |
| 29 | Skills (installed, available, install, toggle, content, uninstall) | Station › Skills |
| 30 | Automations | Station › Automations |
| 31 | Usage ledger (tokens, cost, cache) | Station › Usage |
| 32 | Context-window meter + breakdown | RunBar ring → sheet |
| 33 | Agents page (readiness, remedy, re-scan, launch) | Station › Agents |
| 34 | Custom API providers (add/edit/test/discover models) | ⚠️ see gap A |
| 35 | Built-in agent engines (summarizer/planner/reviewer/worker) | Daemon settings (raw) + Station › Agents |
| 36 | Context-window overrides per provider | Daemon settings |
| 37 | Cloudflare tunnel token/hostname/test | Station › Tunnels |
| 38 | Tailscale tunnel start/stop | Station › Tunnels |
| 39 | Endpoints / reachability / latency | Device › Connection, Station › Tunnels |
| 40 | Paired devices + revoke | Station › Remote access |
| 41 | Pair a device (QR + manual) | Pairing gate |
| 42 | Workspace memory toggle | Station/Session action “Save to memory” |
| 43 | Sync sessions from CLI history | Sessions tab / New Task (wire existing `syncApi`) |
| 44 | Notifications (3 triggers) + deep link | Push + banner |
| 45 | Attention pill | Fleet band + Deck hero + banner |
| 46 | In-session notices + “Restart now” | Session banner |
| 47 | Toasts | Toast host |
| 48 | Timeline simple/detailed toggle | Session overflow |
| 49 | Copy transcript / export JSON / copy link | Session overflow |
| 50 | Star / archive / restore | Swipe + long-press |
| 51 | Command palette / ⌘K search incl. transcript hits | Command sheet + Sessions search |
| 52 | Keyboard shortcuts ⌘N / ⌘K / Esc | ✚ button · search · system back |
| 53 | Connection states (7) | App-bar pill + banners |
| 54 | Appearance: light/dark + accent presets | ⚠️ see gap C |

### Known gaps — three, and how I propose to close them

**A. Custom API provider CRUD.** The desktop uses `/api/providers/api` (list, create, delete, test); the mobile surface (`/api/mobile/*`) does not expose it. Option: add four `/api/mobile/providers/api*` routes (small backend addition), or edit providers through the raw daemon-settings editor initially. **Recommend the backend routes** — this is the only real capability the phone currently cannot reach.

**B. Room management.** Mobile has `/api/mobile/rooms` (list) only; desktop has create/update/delete + run-task + worker editing. Option: extend the mobile surface, or keep rooms read-only + open-channel on mobile. This is a genuine decision for you.

**C. Appearance / light theme.** The desktop offers light/dark and accent presets (a desktop-client preference stored locally, not a daemon setting). This design is **dark-only, one accent, deliberately** — the visual language depends on it. My recommendation is to leave mobile dark-only and not port the accent picker; if you want it, it becomes a token override and costs the identity.

Also noted: `memoryApi`, `syncApi`, `providersApi.list` and `remoteApi.status` already exist in the mobile client but are unused — the new design puts them to work rather than adding surface.

---

## 7 · Interaction rules

- **Gestures:** swipe row = star/archive; long-press = full action sheet; pull = refresh; swipe-down on header = search; drag sheet = dismiss; system back = pop, and pops a sheet before a screen.
- **Destructive actions** always take two taps (remove MCP, revoke device, delete session, unpair) and state the consequence.
- **Keyboard:** composer is keyboard-avoiding and lifts with the keyboard; slash/picker menus render above the field; the field never hides behind the keys.
- **Safe areas:** every screen honours top/bottom insets; the tab bar owns the bottom inset; sheets inset their pinned actions.
- **Targets:** ≥48pt; icon buttons use `hitSlop` to reach it without drawing big.
- **Status is never colour alone** — every signal pairs a dot/rail with a word.
- **Every failure path gets a retry**; a dead end is a bug.
- **Motion** only explains a transition or shows state; no decorative animation, and reduced-motion is respected.

---

## 8 · Implementation plan (after your approval)

1. Replace `src/design/tokens.ts` with the Console token set — the desktop’s palette verbatim, the teal/amber/green status hues retired — and regenerate `tailwind.config.js` from it (the existing “tokens are the single source” discipline is kept — `check-colors` / `check-token-usage` scripts keep working).
2. Build the new primitive kit (`Card`, `StateRail`, `StatusPill`, `Chip`, `Well`, `RunBar`, `FleetBand`, `Section`, states) and delete the pill-era primitives that no longer have a consumer.
3. Rebuild navigation: 4 tabs + ✚ Command, the Session stack, the panel/controls/spawn sheets, the Workspace screen. Keep the existing deep-link and notification-routing contract intact.
4. Rebuild screens in order: Deck → Sessions → Session (transcript, composer, approval) → panels/Git/Terminal/Browser → Station/Agents/Usage/MCP/Remote → Device → New Task → Pairing → states.
5. Wire to the **existing** `src/lib/api.ts`, `src/lib/socket.ts`, `src/store` — no new client state model, no parallel UI system left behind. Delete obsolete components rather than leaving both.
6. `npx tsc --noEmit` + the existing jest suites must pass at each step.

**Risk controls:** the data layer is untouched, so a screen can be swapped one at a time behind the same navigation contract. The `check-api.mjs`, `check-colors.mjs` and `check-token-usage.mjs` scripts stay in the loop.

---

## 9 · What I need from you

1. **Approve the direction** (the desktop’s dark palette + rectilinear instrument geometry + mono readouts) — or name what to change.
2. **Gap A** — add the four `/api/mobile/providers/api*` routes so custom providers work on the phone?
3. **Gap B** — rooms: full management on mobile, or read-only + open channel?
4. **Gap C** — confirm mobile stays dark-only with one accent.
5. **Naming** — I propose the tabs read **Deck · Sessions · Station · Device** with the raised ✚ as Command. Say if you want different words.

Nothing gets built until you answer.