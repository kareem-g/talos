# QAI mobile — review log

Every issue raised during the redesign review, in the order it was reported,
with what it meant and how it was resolved. Mockups live in this folder
(`design/`); the implementation lives in `mobile/src`.

---

## Round 1 — direction

| # | Report | Resolution |
|---|---|---|
| 1 | “i dont like most of the design” | Full HTML redesign of all pages produced for approval (`01`–`09` + `index.html`), approved, then implemented in React Native. |
| 2 | “dont forget the left pane design in chat screen, design it first” | Sessions left pane designed (screen 04, frame 1 — pill rows, check on the open session) and implemented as the chat's left pane. |
| 3 | “do not claim its done and it is not… make sure everything is completed” | Every fix below was verified against the live app / measured bounds, and the full `npm run verify` suite (typecheck, tests, API/colors/tokens/motion guards) was run green after each round. |

## Round 2 — first device screenshots

| # | Report | What it meant | Resolution |
|---|---|---|---|
| 4 | “much design flaws/errors … make it pixel-perfect” | Large titles (“Projects”, “Config”) and the “+” rendered **under the Android status bar** | Safe-area top inset added to every tab screen (Home, History, Engines, Usage, Config) |
| 5 | same round | **New Session sheet opened with an empty body** (grabber + title + button only) | Root cause: flex-basis-0 collapse inside an auto-height sheet; body now content-sized with grow/shrink (verified live: WORKSPACE + rows render) |
| 6 | “fix the constract colors” | Dim status pills (“Ready”, “Ended”) illegible on black | Dim tone now uses secondary-label ink (alert tones keep their hue) |
| 7 | “buttons and spacing and colors not the same” | Composer was the old two-row dock; assistant prose ran edge-to-edge; misc spacing | Composer rebuilt to the mockup's single row; prose restored to the 18px gutter (verified by measured bounds on device) |
| 8 | “the home page is different too” | Home chrome/density vs the approved mockup | Safe-area fix + systemic mockup diff pass (chips, cards, section spacing) |
| 9 | same screenshots | Floating blue gear + white capsule | **Not app UI** — the Android accessibility floating button / keyboard UI. Disable under Settings → Accessibility |
| 10 | “same issue remain. fix them completly” | App hadn't picked up the hot-reloaded fixes at screenshot time | Fixes verified live on device afterwards (bounds-measured); Expo restarted with cleared cache |

## Round 3 — mockup-vs-app diff (no emulator)

| # | Report | Resolution |
|---|---|---|
| 11 | “buttons sizing” | Button ramp now the mockup's exact: 30 / 36 / 50 px, padding 14/16/22, labels 12.5/13.5/15.5, all weight 600; Approve/Decline/Confirm at 30px; tab icons 25px |
| 12 | “composer colors” | Placeholder, paperclip, pencil → ink-3; queue chip 13/6/5; Queue pill auto-width (14px side padding); field padding 5/5/8/6 with 6px gaps; hairline at full strength |
| 13 | “chat top bar buttons and spacing” | Glyphs 18px, back chevron 22px, gaps 6px, **inactive icons white** (were gray), bottom hairline added, agent-detail line at 16px left |
| 14 | “chat colors” | 18px transcript gutter; quiet rows 4% wash; options/fields 5%; high-risk card 7% red (was 14%); bubble tail 6px; side panes darker than sheets; “HIGH RISK” uppercase |
| 15 | “the composer sizing is not ok” | Capsule now guaranteed 47px before growth (5 + 37 + 5), input line 21px with 8px padding, text vertically centered like the mockup |
| 16 | “the new task sheet is smaller in height and not good too” | Sheets with a pinned footer present at ≥50% of the screen (mockup step frames); body absorbs extra space so the footer stays pinned; footless pickers stay content-sized like the mockup pickers |

## Found during verification (not reported, fixed anyway)

| # | Bug | Fix |
|---|---|---|
| 17 | **Pairing could never succeed on a fresh device** — the QR payload is a pairing link but the screen `JSON.parse`d it, and the manual path never set the base URL before `POST /api/pair/verify` (request went out relative) | `parsePairingLink` accepts QR links and JSON; `setDeviceBaseUrl` points the client at the daemon before verify |
| 18 | **Splash crash in Expo Go (Android, SDK 53+)** — `expo-notifications` throws at import | Lazily required with graceful degradation (notifications were already non-functional there) |
| 19 | Deprecated `experimentalBlurMethod` warning | → `blurMethod` |
| 20 | Wizard project-path footnote at disabled-ink contrast | → ink-3 |

## Not app issues (for the record)

- **All session dots orange** — same engine → same identity hue (data-driven, by design).
- **“Offline” on the emulator** — socket route for the emulator's `10.0.2.2` pairing; the daemon's REST + WS verified healthy from the host.
- **Pairing resets in Expo Go** — documented in-memory storage fallback (`src/lib/storage.ts`), not the redesign.