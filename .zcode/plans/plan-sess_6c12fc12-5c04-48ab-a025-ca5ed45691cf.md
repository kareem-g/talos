## Plan: Replace Custom Composer with assistant-ui Base Chat Input + Complete Chat UI/UX Flow

### Current State
- `TaskComposer.tsx` — Custom composer with manually wired `ComposerPrimitive.Input`, attachment chips, model/effort selectors, and send/cancel buttons
- `TaskConversation.tsx` — Uses `MessagePrimitive` + `ThreadPrimitive` but with minimal features
- `taskParts.tsx` — Custom part renderers for tools, data, reasoning

### Target: assistant-ui's "Complete Chat UI" Pattern

I'll rework the task screen to use assistant-ui's standard chat building blocks across three files:

#### 1. `TaskComposer.tsx` — Replace with Base assistant-ui Composer
- Use `ComposerPrimitive.Root` as the form container (auto-handles Enter-to-send, form submit)
- Use `ComposerPrimitive.Input` as the textarea (runtime-controlled, no manual value sync)
- Use `ComposerPrimitive.Send` for the send button (auto-disabled when empty/running)
- Use `ComposerPrimitive.Cancel` for stop (wrapped in `ThreadPrimitive.If running`)
- Use `ComposerPrimitive.Attachments` + `AttachmentPrimitive.Root` for file chips
- Use `ComposerPrimitive.AddAttachment` for the attach button
- Keep the model/effort selectors and context button as action bar companions (outside the composer root, styled to match)

#### 2. `TaskConversation.tsx` — Full assistant-ui Thread + Message Flow
- Use `ThreadPrimitive.Root` → `ThreadPrimitive.Viewport` → `ThreadPrimitive.Messages` for proper scrolling and message list
- Use `ThreadPrimitive.If running` / `ThreadPrimitive.If loading` for status indicators
- Use `ThreadPrimitive.ScrollToBottom` for auto-scroll
- Render messages with `MessagePrimitive.Root` and proper `MessagePrimitive.Content` with custom part renderers
- Add reasoning/thinking **between** message turns using `MessagePrimitive.Content` with a custom reasoning part that renders the `agent-thinking-chip` data
- Add `ActionBarPrimitive` with Copy + Regenerate on completed assistant messages
- Wire `TaskInteractionContext` for approval/question resolution

#### 3. `taskParts.tsx` — Enhanced Part Renderers
- **Text**: Use `MarkdownTextPrimitive` from `@assistant-ui/react-markdown` for rich rendering
- **Reasoning**: New `TaskReasoningPart` that renders `<details>`/`<summary>` expandable reasoning blocks (the `agent-thinking-chip` data parts)
- **Tool calls**: Enhanced `TaskToolCallPart` with expandable args, status indicators, and approval button if the tool has an approval payload
- **Data parts**: Keep existing (diff, plan, activity, system) but wire them as `DataMessagePart` renderers in the `data.by_name` map
- **Approval rendering**: Inline approval buttons in the message flow using `TaskInteractionContext`
- **Edits**: Add a `TaskEditPart` that renders editable text when the backend sends edit suggestions

### What Stays the Same
- The external-store runtime (`useExternalStoreRuntime`) — the backend is custom and streams events, so we keep the manual thread message builder
- The `buildThreadMessages` function in `lib/taskMessages.ts` — already correctly maps events to thread messages
- The WebSocket event flow, session management, and API calls
- The `MobileTaskScreen` parent component

### What Changes
- Three task component files: `TaskComposer.tsx`, `TaskConversation.tsx`, `taskParts.tsx`
- No changes to backend, types, or taskMessages
- Uses only already-installed packages (`@assistant-ui/react`, `@assistant-ui/react-markdown`, `lucide-react`)

### Verification
- TypeScript compiles (`tsc --noEmit`)
- Dev server HMR serves the new code
- Manual browser test: open /mobile/task, verify composer renders, type and send, verify messages render with markdown, reasoning, tool calls, and approval buttons