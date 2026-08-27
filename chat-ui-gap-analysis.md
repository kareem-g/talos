# AgentDeck Chat UI vs assistant-ui — Feature Gap Analysis

Generated: 2026-08-27

## What AgentDeck already has (don't need to build)

| Feature | AgentDeck component |
|---------|-------------------|
| Text / markdown streaming | `chat.tsx` → `Prose` (fenced code blocks, inline code/bold) |
| Code blocks with copy | `chat.tsx` → `Code` |
| Reasoning / thinking (collapsible) | `chat.tsx` → `Reasoning` |
| Tool calls (icon + label + expandable) | `chat.tsx` → `Step` |
| File change chips | `chat.tsx` → `FileChips` |
| Task plans with live status | `chat.tsx` → `Plan` |
| Approval / permission cards | `chat.tsx` → `Approval` (multi-select, custom text, always-allow) |
| Token / cost meter | `chat.tsx` → `UsageMeter` |
| End-of-turn summary | `chat.tsx` → `TurnSummary` |
| Error cards | `chat.tsx` → `ErrorCard` |
| Composer with slash commands | `Composer.tsx` (/, @, $, # triggers) |
| @context file browsing | `Composer.tsx` (live workspace listing) |
| Stop / interrupt controls | `Composer.tsx` |
| Conversation scroll + auto-scroll | `Timeline.tsx` |
| Live activity indicator | `Timeline.tsx` → `ActivityLine` |
| Optimistic messages | Store (`addOptimisticUserMessage`) |
| Session header + model chip + connection | `SessionView.tsx` |
| Chat / terminal tabs | `SessionView.tsx` |
| Mutable in-place conversation model | Store (delta appends, no re-fold) |
| Event replay + idempotency | Store (`lastEventId`, `seenEvents`) |

---

## What AgentDeck LACKS (assistant-ui has these)

### Core UX

1. **Branching / BranchPicker** — No way to create or switch between alternative conversation branches. assistant-ui has `MessagePrimitive.BranchPicker` with `n / m` navigation.

2. **ThreadList** — No sidebar/dropdown for switching between conversation threads. AgentDeck has session switching but no persistent thread list component with search and active state.

3. **ActionBar** — No per-message action buttons (copy, retry, edit, regenerate). assistant-ui's `ActionBarPrimitive` provides these with auto-hide and intelligent disabling.

4. **Message editing** — No way to edit a sent user message and re-run from that point.

5. **Retry / regenerate** — No button to retry or regenerate an assistant response.

### Rich content

6. **Attachments** — No file/image attachment UI in messages. assistant-ui has `ComposerAttachments`, `UserMessageAttachments`, `ComposerAddAttachment`, plus `File` and `Image` part renderers.

7. **Diff Viewer** — No built-in syntax-highlighted diff viewer. AgentDeck only has file change chips (path + ok/fail), not full diffs.

8. **Generative UI** — No ability for the model to compose React components at runtime from a shipped vocabulary. assistant-ui has `JSONGenerativeUI` + component toolkits.

9. **Follow-up Suggestions** — No suggested next prompts shown below assistant responses.

### Model & context

10. **Model Selector** — No built-in composable model picker with reasoning effort levels and search. AgentDeck has a config chip but not a dedicated selector component.

11. **Context Display** — No visualization of token usage relative to a model's context window (ring/bar/text with hover popover).

12. **Message Timing** — No streaming performance stats (TTFT, total time, tok/s, chunk count) shown as a badge.

### Voice & input

13. **Voice / dictation** — No realtime voice session controls (connect, mute, status indicator). assistant-ui has a `Voice` component.

14. **Composer Trigger Popover** — AgentDeck has custom slash/@/$/# menus but not a reusable, accessible popover primitive.

### Tooling & integrations

15. **MCP integration** — No MCP config dialog or user-managed MCP servers from the browser. assistant-ui has `MCPConfigDialog` and `@assistant-ui/react-mcp`.

16. **Tool Grouping** — No wrapper for consecutive tool calls with collapsible/styled options. assistant-ui has `ToolGroup`.

17. **Tool Fallback** — No default UI component for tools without dedicated renderers. AgentDeck renders all tools via `Step`.

18. **Multiple backend adapters** — AgentDeck uses its own WebSocket backend. assistant-ui has adapters for Vercel AI SDK, LangGraph, LangChain, AG-UI, A2A, Google ADK, OpenCode, and custom data-streams.

### Surfaces & platforms

19. **AssistantModal** — No floating chat bubble for support widgets / help desks.

20. **AssistantSidebar** — No side-panel chat for co-pilot experiences.

21. **React Native** — No mobile-native chat components.

22. **Terminal (Ink)** — No terminal-based chat UI.

### DX & a11y

23. **Accessibility** — AgentDeck has some a11y but assistant-ui builds it in throughout (ARIA roles, keyboard navigation, focus management).

24. **Keyboard shortcuts** — AgentDeck has limited shortcuts; assistant-ui has a richer set out of the box.

25. **Part grouping** — AgentDeck has fixed part rendering; assistant-ui has flexible `MessagePrimitive.GroupedParts` with custom grouping functions.

26. **Strong TypeScript runtime** — AgentDeck's types are good but assistant-ui has typed runtime APIs, tool schemas, message parts, and adapters end-to-end.

---

## Summary

AgentDeck's chat UI is **strong on agent-specific features** (approvals, plans, reasoning, tool calls, terminal tabs, live activity) but **lacks general chat UX patterns** (branching, editing, retry, attachments, action bars, thread lists) and **platform integrations** (MCP, voice, multiple backends, React Native, terminal).

The gap is mostly in **chat interaction patterns** and **ecosystem integrations**, not in the agent-event rendering that AgentDeck already does well.
