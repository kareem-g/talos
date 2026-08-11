# VARIANTS — coverage confirmation

Beautiful UI exposes each component as a **single** file in which all its variants are
embedded (selected by props / internal state machines / presets). The public "View code" modal
always returns that one combined file, no matter which variant is active in the preview.
Verified live: selecting the `Dots` variant of Loading State returns the exact same file as `Drive`.

Consequence: **no variant code is lost** — every variant lives inside its component file, captured verbatim.

## Per-component variant status

- **Tool Chips** — `components/ToolChips.tsx` — `Tool call rows`, `File-diff chips`, `Expandable rows`
  - How: rows + expandable tool/file-diff chips (+2 more) — all variant code present in the captured file
- **Loading State** — `components/LoadingState.tsx` — `Drive`, `Dots`, `Orbit`
  - How: PATTERNS map + `variant` prop (Drive | Dots | Orbit) — all variant code present in the captured file
- **Thinking** — `components/ThinkingState.tsx` — `Thought for 4s`, `Steps`, `Reasoning`, `Search`, `Coding`
  - How: `variant` prop branches (Steps | Reasoning | Search | Coding); base = Thought-for-4s playthrough — all variant code present in the captured file
- **Streaming Text** — `components/StreamingText.tsx` — `interactive stream (actions, citations, follow-ups)`
  - How: state-machine playthrough (stream → citations → actions → follow-ups) — all variant code present in the captured file
- **Approval Card** — `components/ApprovalCard.tsx` — `Core line (3)`, `Full case (5)`, `Single hero`
  - How: question-count presets (core-line 3 | full 5 | single hero); interactive flow — all variant code present in the captured file
- **Task Rows** — `components/TaskRows.tsx` — `Capsules`, `List`
  - How: `layout` prop (Capsules | List) — all variant code present in the captured file
- **Chat** — `components/ChatComposer.tsx` — `Tabs`, `Reply flow`, `Composer`
  - How: tabs + reply sequence + composer (interactive) — all variant code present in the captured file
- **Prompt Bar** — `components/PromptBar.tsx` — `Rounded`, `Pill`
  - How: `variant` prop (Rounded | Pill) + interactive @ / /command menus — all variant code present in the captured file
- **Recommendation Card** — `components/RecommendationCard.tsx` — `Alternatives drawer`, `Accept`
  - How: Alternatives drawer + Accept (interactive) — all variant code present in the captured file
- **Context Cards** — `components/ContextCards.tsx` — `static chunk cards`
  - How: n/a — all variant code present in the captured file
- **Diff Table** — `components/DiffTable.tsx` — `animated diff`
  - How: n/a — all variant code present in the captured file
- **Records Table** — `components/RecordsTable.tsx` — `CRM grid, calculations`
  - How: columns/categories/links/add-calculation (interactive) — all variant code present in the captured file
- **Filter Table** — `components/FilterTable.tsx` — `Status filter: All/To do/In Progress/Completed`
  - How: status filter chips (All | To do | In Progress | Completed) — all variant code present in the captured file
- **Sidebar Nav** — `components/SidebarNav.tsx` — `Search + direct select`
  - How: inline search + direct select (interactive) — all variant code present in the captured file
- **Search** — `components/SearchList.tsx` — `live filtering`
  - How: live filter as you type (interactive) — all variant code present in the captured file
- **Insight Cards** — `components/InsightCards.tsx` — `carousel autoplay + manual`
  - How: carousel autoplay/manual (‹ ›) — all variant code present in the captured file
- **Code Block** — `components/CodeBlock.tsx` — `streaming lines + live copy`
  - How: streaming lines + live copy (interactive) — all variant code present in the captured file
- **Fine-tune Card** — `components/FineTuneCard.tsx` — `row`, `col`, `grid`
  - How: `layout` prop (row | col | grid) — all variant code present in the captured file
- **Selection Actions** — `components/SelectionActions.tsx` — `contextual AI bar`
  - How: n/a — all variant code present in the captured file

## Note on faithfulness
Because the site does not publish separate per-variant files, splitting them into standalone
before preserving would be recreating rather than collecting. The verbatim files here are the
authoritative public source; variants live inside them and are indexed above.
