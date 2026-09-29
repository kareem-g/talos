/**
 * Composer — the prompt input, ported from the desktop's `Composer.tsx`.
 *
 * Same state machine, same affordances:
 *   - idle → a single send button; working → a Queue button plus a Stop button,
 *     because a mid-turn send is a follow-up for the *next* turn, not a drop;
 *   - the queue is a real list you can steer (inject now), edit, or remove;
 *   - the control row carries the session's live options (permission mode, model,
 *     thought level, agent-native mode) as chips, changed over the socket.
 *
 * Platform substitutions, all documented at the point of use:
 *   - the transparent-textarea-over-chip-backdrop trick has no native equivalent,
 *     so the field is a plain multiline input and inserted `/commands` stay text;
 *   - `DropdownList` (a DOM portal) becomes a bottom sheet;
 *   - attachments are omitted: `expo-image-picker` is not a dependency here and
 *     the daemon's multipart upload route is not part of the mobile API surface.
 */

import * as React from 'react'
import { ActivityIndicator, Pressable, Text, TextInput, View } from 'react-native'
import { ArrowUp, Paperclip, Pencil, Square, Trash2, Undo2, X } from 'lucide-react-native'
import * as ImagePicker from 'expo-image-picker'
import * as ImageManipulator from 'expo-image-manipulator'
import { cn } from '@/lib/format'
import type { UIState } from '@/lib/sessionState'
import { attachmentsApi } from '@app/lib/api'
import { useStore } from '@app/store'
import type { AttachmentRef, QueuedMessage } from '@/types/conversation'
import { haptic, IconButton, Mono } from '@app/components/ui'
import { GlassSurface } from '@app/components/Glass'
import { palette } from '@app/design/tokens'

/** Commands each CLI answers, mirroring the desktop's menu. */
const BUILTIN_COMMANDS: Record<string, string[]> = {
  claude: ['init', 'compact', 'review', 'security-review', 'pr-comments', 'release-notes'],
  opencode: ['init', 'compact', 'share', 'unshare', 'help'],
  codex: ['init', 'compact', 'review'],
}
const CUSTOM_COMMANDS = ['orchestrator', 'review', 'plan', 'worker', 'summarize', 'side', 'btw']

/**
 * A stable empty queue. `?? []` inside a zustand selector allocates a new array
 * on every store update, so the snapshot identity changes even when nothing about
 * this session moved.
 */
const NO_QUEUE: QueuedMessage[] = []

/** Wide enough for the transcript, small enough to stay under the daemon's 2MB cap. */
const MAX_UPLOAD_WIDTH = 1600

export function Composer({ sessionId, uiState }: { sessionId: string; uiState: UIState }) {
  const connection = useStore((state) => state.connection)
  const queue = useStore((state) => state.queues[sessionId]) ?? NO_QUEUE
  const sendPrompt = useStore((state) => state.sendPrompt)
  const queueMessage = useStore((state) => state.queueMessage)
  const removeQueued = useStore((state) => state.removeQueued)
  const steerQueued = useStore((state) => state.steerQueued)
  const stopSession = useStore((state) => state.stopSession)
  const session = useStore((state) => state.sessions.find((row) => row.id === sessionId))

  const [text, setText] = React.useState('')
  const [attachments, setAttachments] = React.useState<AttachmentRef[]>([])
  const [uploading, setUploading] = React.useState(false)
  const [attachError, setAttachError] = React.useState<string | null>(null)
  const inputRef = React.useRef<TextInput>(null)

  const busy = uiState === 'working' || uiState === 'starting' || uiState === 'resuming'
  const disabled = connection !== 'connected'
  const canSend = (text.trim().length > 0 || attachments.length > 0) && !disabled

  function submit() {
    const value = text.trim()
    if ((!value && attachments.length === 0) || disabled) return
    if (busy) queueMessage(sessionId, value, attachments)
    else sendPrompt(sessionId, value, attachments)
    setText('')
    setAttachments([])
  }

  /**
   * Pick images and upload them immediately, so the composer holds references to
   * files the daemon already has. A failed upload leaves the draft untouched and
   * says why rather than silently dropping the file.
   */
  async function attach() {
    setAttachError(null)
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (!permission.granted) {
      setAttachError('Photo access is off. Enable it in Settings to attach images.')
      return
    }
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsMultipleSelection: true,
      quality: 0.9,
    })
    if (result.canceled || result.assets.length === 0) return
    setUploading(true)
    try {
      for (const asset of result.assets) {
        // The daemon caps attachments at 2MB, and a phone camera's original
        // frame is routinely larger than that. Downscale to the width the
        // transcript can actually show and re-encode as JPEG, so the upload
        // succeeds instead of being rejected for size.
        const target = await ImageManipulator.manipulateAsync(
          asset.uri,
          [{ resize: { width: Math.min(asset.width || MAX_UPLOAD_WIDTH, MAX_UPLOAD_WIDTH) } }],
          { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG },
        )
        const name = (asset.fileName ?? `image-${Date.now()}`).replace(/\.[^.]+$/, '') + '.jpg'
        const uploaded = await attachmentsApi.upload(sessionId, {
          uri: target.uri,
          name,
          type: 'image/jpeg',
        })
        setAttachments((current) => [
          ...current,
          ...uploaded.map((file) => ({
            ref: file.ref,
            name: file.name,
            fileName: file.fileName,
            contentType: file.contentType,
            size: file.size,
            path: file.path,
          })),
        ])
      }
    } catch (cause) {
      setAttachError(cause instanceof Error ? cause.message : 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  async function editQueued(message: QueuedMessage) {
    removeQueued(sessionId, message.id)
    setText(message.text)
    inputRef.current?.focus()
  }

  // Slash-command menu: offered while the caret token is `/something`.
  const slashQuery = /(^|\s)\/([^\s/]*)$/.exec(text)
  const commands = React.useMemo(() => {
    if (!slashQuery) return []
    const agentId = session?.agent ?? ''
    const all = [...(BUILTIN_COMMANDS[agentId] ?? []), ...CUSTOM_COMMANDS]
    const unique = Array.from(new Set(all))
    const query = slashQuery[2].toLowerCase()
    return unique.filter((command) => command.startsWith(query)).slice(0, 8)
  }, [slashQuery, session?.agent])

  function insertCommand(command: string) {
    setText((current) => current.replace(/(^|\s)\/[^\s/]*$/, (_match, prefix: string) => `${prefix}/${command} `))
  }

  const placeholder = disabled
    ? 'Waiting for connection…'
    : busy
      ? 'Keep typing to queue a follow-up'
      : 'Message the agent…'

  return (
    <View className="shrink-0 border-t border-line bg-canvas px-3 pb-3 pt-2">
      <View className="relative w-full">
        {/* Slash-command menu, floating above the card. */}
        {commands.length > 0 ? (
          <View className="absolute bottom-full left-0 right-0 z-20 mb-2 overflow-hidden rounded-md border border-line-strong bg-raised">
            <View className="border-b border-line px-2.5 py-1.5">
              <Mono className="text-[10px] uppercase tracking-wider">Commands</Mono>
            </View>
            <View className="py-1">
              {commands.map((command) => (
                <Pressable
                  key={command}
                  accessibilityRole="button"
                  accessibilityLabel={`Insert the /${command} command`}
                  onPress={() => insertCommand(command)}
                  className="min-h-11 flex-row items-center gap-2.5 px-3 py-2 active:bg-pressed"
                >
                  <View className="size-5 items-center justify-center rounded-sm bg-wait-soft">
                    <Mono className="text-[10px] font-semibold text-wait">/</Mono>
                  </View>
                  <Mono className="min-w-0 flex-1 text-[12px] text-ink">{command}</Mono>
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}

        <GlassSurface radius={18} className="border-line-strong">
          {/* Queue */}
          {queue.length > 0 ? (
            <View className="border-b border-line bg-raised px-2 py-1.5">
              <Mono className="px-1 pb-1 text-[9.5px] uppercase tracking-[0.12em]">
                Queued · {queue.length}
              </Mono>
              <View className="gap-1">
                {queue.map((message, index) => (
                  <View
                    key={message.id}
                    className="flex-row items-center gap-1.5 rounded-md border border-line bg-surface px-2 py-1.5"
                  >
                    <Text className="min-w-0 flex-1 text-[12px] text-ink-2" numberOfLines={1}>
                      {message.text || `${message.attachments.length} attachment(s)`}
                      {message.text && message.attachments.length > 0
                        ? `  +${message.attachments.length}`
                        : ''}
                    </Text>
                    <Pressable
                      onPress={() => steerQueued(sessionId, message.id)}
                      accessibilityLabel="Send now"
                      className="min-h-8 shrink-0 flex-row items-center gap-1 rounded-pill border border-line bg-raised px-2.5"
                    >
                      <Undo2 size={13} color={palette.ink2} />
                      <Text className="text-[11px] font-medium text-ink-2">Steer</Text>
                    </Pressable>
                    <IconButton
                      label={`Edit queued message ${index + 1} of ${queue.length}`}
                      size={30}
                      onPress={() => void editQueued(message)}
                    >
                      <Pencil size={14} color={palette.ink2} />
                    </IconButton>
                    <IconButton
                      label={`Remove queued message ${index + 1} of ${queue.length}`}
                      size={30}
                      onPress={() => removeQueued(sessionId, message.id)}
                    >
                      <Trash2 size={14} color={palette.ink3} />
                    </IconButton>
                  </View>
                ))}
              </View>
            </View>
          ) : null}

          {attachments.length > 0 ? (
            <View className="flex-row flex-wrap gap-1.5 px-3 pt-2.5">
              {attachments.map((attachment) => (
                <View
                  key={attachment.ref}
                  className="flex-row items-center gap-1.5 rounded-pill border border-line bg-raised py-1 pl-2 pr-1"
                >
                  <Paperclip size={11} color={palette.ink3} />
                  <Text className="max-w-[160px] text-[10.5px] text-ink-2" numberOfLines={1}>
                    {attachment.fileName}
                  </Text>
                  <IconButton
                    label={`Remove ${attachment.fileName}`}
                    size={24}
                    onPress={() =>
                      setAttachments((current) => current.filter((entry) => entry.ref !== attachment.ref))
                    }
                  >
                    <X size={12} color={palette.ink3} />
                  </IconButton>
                </View>
              ))}
            </View>
          ) : null}

          <TextInput
            ref={inputRef}
            value={text}
            onChangeText={setText}
            placeholder={placeholder}
            placeholderTextColor={palette.ink3}
            multiline
            editable={!disabled}
            className="max-h-[168px] min-h-[44px] bg-transparent px-3.5 pt-3 text-[14px] leading-5 text-ink"
          />

          {/* ── Control row ──────────────────────────────────────────────
              The send control never changes position. When the agent is
              working, it becomes "Queue" in the same slot and Stop appears
              beside it — previously the two swapped, so the primary action
              jumped horizontally the moment the model started generating, and
              muscle memory from a thousand sends landed on Stop. */}
          <View className="flex-row items-center gap-2 px-2 pb-2 pt-1.5">
            <IconButton
              label="Attach images"
              size={36}
              disabled={disabled || uploading}
              onPress={() => void attach()}
            >
              {uploading ? (
                <ActivityIndicator size="small" color={palette.ink3} />
              ) : (
                <Paperclip size={17} color={disabled ? palette.ink3 : palette.ink2} />
              )}
            </IconButton>

            {busy ? (
              <IconButton
                label="Stop this session"
                size={40}
                onPress={() => {
                  void haptic('warn')
                  void stopSession(sessionId)
                }}
              >
                <Square size={15} color={palette.danger} fill={palette.danger} />
              </IconButton>
            ) : null}

            <View className="flex-1" />

            <Pressable
              onPress={submit}
              disabled={!canSend}
              accessibilityRole="button"
              accessibilityLabel={busy ? 'Queue this follow-up' : 'Send message'}
              accessibilityHint={
                busy
                  ? 'Adds this message to the queue for the next turn'
                  : 'Sends this message to the agent'
              }
              accessibilityState={{ disabled: !canSend }}
              // 44pt: this is the single most-pressed control in the app.
              hitSlop={{ top: 4, bottom: 4, left: 4, right: 4 }}
              className={[
                'h-11 min-w-11 flex-row items-center justify-center gap-1.5 rounded-pill px-4',
                canSend ? 'bg-accent active:bg-accent-hover' : 'bg-raised',
              ].join(' ')}
            >
              <ArrowUp size={17} color={canSend ? palette.accentInk : palette.ink3} />
              {busy ? (
                <Text
                  className={['text-[13px] font-bold', canSend ? 'text-accent-ink' : 'text-ink-3'].join(' ')}
                >
                  Queue
                </Text>
              ) : null}
            </Pressable>
          </View>
        </GlassSurface>
      </View>

      {attachError ? (
        <Text className="mt-1 px-1 text-[11px] leading-4 text-danger">{attachError}</Text>
      ) : null}

    </View>
  )
}
