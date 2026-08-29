# Composer: message queue + steer + edit + attachments

Implement the composer shown in the image: while the agent is working, Enter **queues** follow-up messages as editable rows above the input; each row has **⬆ Steer** (inject now), **pencil** (edit back into the composer), **trash** (delete), and a **drag grip** (reorder). The input gains **attachments** (`+` file picker → upload chips + count badge). Defaults chosen (user skipped the questions): queued messages **auto-send one-per-turn when the agent goes idle**; **Steer injects immediately without interrupting**.

## 1. Types — `dashboard/src/types/conversation.ts`
```ts
export interface AttachmentRef { ref: string; name: string; fileName: string; contentType?: string; size: number; path: string }
export interface QueuedMessage { id: string; text: string; attachments: AttachmentRef[]; createdAt: string }
```

## 2. API — `dashboard/src/lib/api.ts`
Add `attachmentsApi.upload(sessionId, files): Promise<AttachmentRef[]>` → `POST /api/attachments/upload?session=<id>` (multipart). The shared `request()` hard-sets `Content-Type: application/json`, so this uses its own `fetch` that reuses `deviceToken()` for the `Authorization` header and lets the browser set the multipart boundary. Response shape `{ attachments: [...] }` already exists backend-side (`routes.rs:3091`).

## 3. Store — `dashboard/src/store/index.ts`
- State: `queues: Record<string, QueuedMessage[]>` (init `{}`).
- Actions: `queueMessage(sessionId, text, attachments)`, `removeQueued(sessionId, id)`, `steerQueued(sessionId, id)` (send now via existing `sendPrompt` + drop from queue), `editQueued(sessionId, id)` (pop + return the message for the composer to re-seed), `reorderQueued(sessionId, from, to)`, `flushQueue(sessionId)` (send only the **head** message; the next idle flushes the next).
- Flush hook: in `handleFrame`, after `sealConversation`/`bump` in **both** idle branches (`SessionUpdate` ~:694 and `StateChange` ~:725), call `get().flushQueue(sessionId)`.
- Attachment→agent wiring (no backend change): when sending a message with attachments, append a block to the text so the agent can read them:
  `<attached_files>\n- {path} ({fileName}, {contentType})\n</attached_files>`

## 4. Composer — `dashboard/src/components/Composer.tsx`
New optional props (side-session composer unaffected): `queue`, `onQueue`, `onSteer`, `onEditQueued`, `onRemoveQueued`, `onReorderQueued`, `onUploadFiles`, `draftSeed` (`{text, attachments, nonce}`), and extend `onSend(text, attachments)`.
- **Queue rows** above the field (only when `queue?.length`): grip (HTML5 `draggable` reorder), truncated text, `⬆ Steer` button, `Pencil`, `Trash2` (lucide-react, already used across desktop).
- **Enter while `working`** → `onQueue(value, attachments)` instead of `send()`; placeholder switches to "Keep typing to queue follow-up changes" when `working`.
- **Attachments**: `+` button → hidden `<input type="file" multiple>` → `onUploadFiles` → local `attachments` state → chips row with an image-count badge (the "2"); `x` removes a chip; cleared on send/queue.
- **Edit**: when `draftSeed.nonce` changes, load its text+attachments into the field.

## 5. Wiring — `dashboard/src/components/StateZone.tsx` + `SessionWorkspace.tsx`
- StateZone: read `queues[session.id]` from the store; pass queue props + `onUploadFiles={(files) => attachmentsApi.upload(session.id, files)}` to Composer; `onQueue` → `store.queueMessage`; `onEditQueued` → pop + set a local `draftSeed` state passed to Composer.
- SessionWorkspace `handleSend`: accept `(text, attachments)`, append the `<attached_files>` block, then `sendPrompt` (existing `/side`/`/btw` + `#mention` handling preserved).

## 6. Verification
- `npx tsc --noEmit` clean; `npx vitest run` (no regressions).
- Live in the running app (backend :9120, dashboard :3000): start a claude session, send a long-running prompt, type follow-ups → they queue as rows; Steer one mid-run; edit + delete another; attach 2 files → count badge shows "2"; confirm the agent receives the attachment paths and the queue auto-flushes one-per-turn on idle.

## Notes / risks
- Steer while running relies on the existing unguarded `sendInput` path (already how Enter-mid-run behaves today).
- Auto-flush sends one message per idle transition, so a 3-message queue drains across 3 turns (no flooding).
- No backend changes; attachments reach the agent as readable file paths.