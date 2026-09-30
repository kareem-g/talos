/**
 * Composer — the prompt input.
 *
 * A port of the desktop's `Composer`, with the parts the desktop hides on
 * narrow screens moved into it, because on a phone there is no other place for
 * them: the permission mode, the model, the thought level, the context ring and
 * the slash-command menu all belong *here*, not in a header.
 *
 * THE STATE MACHINE (unchanged, because it is right)
 * -------------------------------------------------
 *   idle    → one Send.
 *   working → that same control becomes Queue, and Stop appears *beside* it.
 *
 * Stop used to occupy the send button's slot, so the primary action jumped
 * horizontally the moment the model started generating, and muscle memory from
 * a thousand sends landed on Stop. The control never moves now; only its label
 * and colour change. Queue is also the honest label: a mid-turn send is a
 * follow-up for the *next* turn, not a drop.
 *
 * THE DOCK
 * --------
 * The dock is a rounded surface card floating on the canvas: the multiline
 * field is integrated directly into it (no nested field chrome), the queue and
 * attachment chips stack above the text, and the 'Run' row — the session's
 * live configuration, scrolling horizontally — folds away beneath it. The
 * context ring stays visible even when the rest is collapsed: it is the one
 * dimension you want to know without asking.
 */

import * as React from 'react'
import { ActivityIndicator, Pressable, ScrollView, Text, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import {
  ArrowUp,
  Brain,
  ChevronDown,
  CornerUpLeft,
  Paperclip,
  Pencil,
  Square,
  Trash2,
  Wand2,
  X,
} from 'lucide-react-native'

import type { UIState } from '@/lib/sessionState'
import { attachmentsApi } from '@app/lib/api'
import { useStore } from '@app/store'
import type { AttachmentRef, QueuedMessage } from '@/types/conversation'
import { palette, radius, shadowOverlay } from '@app/design/tokens'
import { useCollapse } from '@app/components/motion'
import { haptic, Mono, Popover } from '@app/components/ui'
import { ConfigChips, ContextRing } from '@app/components/ConfigChips'
import * as ImagePicker from 'expo-image-picker'
import * as ImageManipulator from 'expo-image-manipulator'

/** Commands each CLI answers, mirroring the desktop's menu. */
const BUILTIN_COMMANDS: Record<string, string[]> = {
  claude: ['init', 'compact', 'review', 'security-review', 'pr-comments', 'release-notes'],
  opencode: ['init', 'compact', 'share', 'unshare', 'help'],
  codex: ['init', 'compact', 'review'],
}
const CUSTOM_COMMANDS = ['orchestrator', 'review', 'plan', 'worker', 'summarize', 'side', 'btw']

/**
 * A stable empty queue. `?? []` inside a zustand selector allocates a new array
 * on every store update, so the snapshot identity changes even when nothing
 * about this session moved.
 */
const NO_QUEUE: QueuedMessage[] = []

/** Wide enough for the transcript, small enough to stay under the daemon's 2MB cap. */
const MAX_UPLOAD_WIDTH = 1600

export function Composer({ sessionId, uiState }: { sessionId: string; uiState: UIState }) {
  const insets = useSafeAreaInsets()
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
  const [dockOpen, setDockOpen] = React.useState(false)
  const inputRef = React.useRef<TextInput>(null)

  const busy = uiState === 'working' || uiState === 'starting' || uiState === 'resuming'
  const disabled = connection !== 'connected'
  const canSend = (text.trim().length > 0 || attachments.length > 0) && !disabled
  const dock = useCollapse(dockOpen)

  function submit() {
    const value = text.trim()
    if ((!value && attachments.length === 0) || disabled) return
    void haptic(busy ? 'medium' : 'light')
    if (busy) queueMessage(sessionId, value, attachments)
    else sendPrompt(sessionId, value, attachments)
    setText('')
    setAttachments([])
  }

  /**
   * Pick images and upload them immediately, so the composer holds references
   * to files the daemon already has. A failed upload leaves the draft untouched
   * and says why rather than silently dropping the file.
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
      ? 'Queue a follow-up for the next turn'
      : 'Message the agent…'

  return (
    <View
      style={{
        backgroundColor: palette.canvas,
        paddingHorizontal: 12,
        paddingTop: 8,
        paddingBottom: Math.max(insets.bottom, 10),
      }}
    >
      <View style={{ position: 'relative' }}>
        {/* Slash-command menu, floating above the card. */}
        {commands.length > 0 ? (
          <View
            style={{
              position: 'absolute',
              bottom: '100%',
              left: 0,
              right: 0,
              zIndex: 20,
              marginBottom: 8,
              borderRadius: radius.lg,
              borderWidth: 1,
              borderColor: palette.lineStrong,
              backgroundColor: palette.raised,
              overflow: 'hidden',
              ...shadowOverlay,
            }}
          >
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 7,
                borderBottomWidth: 1,
                borderBottomColor: palette.line,
                paddingHorizontal: 14,
                paddingVertical: 9,
              }}
            >
              <Wand2 size={13} color={palette.wait} />
              <Mono className="text-[10px] uppercase text-ink-3" style={{ letterSpacing: 1 }}>
                Commands
              </Mono>
            </View>
            <View style={{ paddingVertical: 4 }}>
              {commands.map((command) => (
                <Pressable
                  key={command}
                  accessibilityRole="button"
                  accessibilityLabel={`Insert the /${command} command`}
                  onPress={() => insertCommand(command)}
                  style={({ pressed }) => ({
                    minHeight: 44,
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 11,
                    paddingHorizontal: 14,
                    backgroundColor: pressed ? palette.hover : 'transparent',
                  })}
                >
                  <View
                    style={{
                      width: 24,
                      height: 24,
                      borderRadius: radius.xs,
                      alignItems: 'center',
                      justifyContent: 'center',
                      backgroundColor: palette.waitSoft,
                    }}
                  >
                    <Mono className="text-[11px] font-semibold text-wait">/</Mono>
                  </View>
                  <Mono className="flex-1 text-[13px] text-ink">{command}</Mono>
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}

        <View
          style={{
            borderRadius: 24,
            borderWidth: 1,
            borderColor: palette.lineStrong,
            backgroundColor: palette.surface,
            overflow: 'hidden',
          }}
        >
          {/* ── Queue ───────────────────────────────────────────────────
              Shown *above* the field, not below: the queue is what you are
              about to send, and it has to be read before you type the next
              thing, not after. */}
          {queue.length > 0 ? (
            <View
              style={{
                borderBottomWidth: 1,
                borderBottomColor: palette.line,
                padding: 8,
                gap: 6,
              }}
            >
              <Mono className="px-1 text-[10px] font-semibold uppercase text-ink-3" style={{ letterSpacing: 1 }}>
                Queued · {queue.length}
              </Mono>
              {queue.map((message, index) => (
                <View
                  key={message.id}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 6,
                    borderRadius: radius.pill,
                    borderWidth: 1,
                    borderColor: palette.line,
                    backgroundColor: palette.raised,
                    paddingLeft: 12,
                    paddingRight: 4,
                    paddingVertical: 3,
                  }}
                >
                  <Text className="min-w-0 flex-1 text-[12.5px] leading-[17px] text-ink-2" numberOfLines={1}>
                    {message.text || `${message.attachments.length} attachment(s)`}
                    {message.text && message.attachments.length > 0 ? `  +${message.attachments.length}` : ''}
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Send queued message ${index + 1} of ${queue.length} now`}
                    onPress={() => {
                      void haptic('medium')
                      steerQueued(sessionId, message.id)
                    }}
                    style={({ pressed }) => ({
                      minHeight: 28,
                      flexDirection: 'row',
                      alignItems: 'center',
                      gap: 4,
                      borderRadius: radius.pill,
                      borderWidth: 1,
                      borderColor: palette.line,
                      backgroundColor: pressed ? palette.hover : palette.surface,
                      paddingHorizontal: 10,
                    })}
                  >
                    <CornerUpLeft size={12} color={palette.ink2} />
                    <Text className="text-[11.5px] font-medium text-ink-2">Steer</Text>
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Edit queued message ${index + 1} of ${queue.length}`}
                    onPress={() => void editQueued(message)}
                    hitSlop={8}
                    className="size-8 items-center justify-center rounded-pill active:bg-hover"
                  >
                    <Pencil size={13} color={palette.ink2} />
                  </Pressable>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Remove queued message ${index + 1} of ${queue.length}`}
                    onPress={() => removeQueued(sessionId, message.id)}
                    hitSlop={8}
                    className="size-8 items-center justify-center rounded-pill active:bg-hover"
                  >
                    <Trash2 size={13} color={palette.ink3} />
                  </Pressable>
                </View>
              ))}
            </View>
          ) : null}

          {attachments.length > 0 ? (
            <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 6, paddingHorizontal: 14, paddingTop: 10 }}>
              {attachments.map((attachment) => (
                <View
                  key={attachment.ref}
                  style={{
                    flexDirection: 'row',
                    alignItems: 'center',
                    gap: 5,
                    borderRadius: radius.pill,
                    borderWidth: 1,
                    borderColor: palette.line,
                    backgroundColor: palette.raised,
                    paddingLeft: 9,
                    paddingRight: 2,
                    paddingVertical: 3,
                  }}
                >
                  <Paperclip size={11} color={palette.ink3} />
                  <Text className="max-w-[150px] text-[11.5px] text-ink-2" numberOfLines={1}>
                    {attachment.fileName}
                  </Text>
                  <Pressable
                    accessibilityRole="button"
                    accessibilityLabel={`Remove ${attachment.fileName}`}
                    onPress={() =>
                      setAttachments((current) => current.filter((entry) => entry.ref !== attachment.ref))
                    }
                    hitSlop={8}
                    className="size-7 items-center justify-center rounded-pill active:bg-hover"
                  >
                    <X size={12} color={palette.ink3} />
                  </Pressable>
                </View>
              ))}
            </View>
          ) : null}

          {/* ── The dock: the session's live configuration ─────────────
              Collapsible, because eight agents' worth of dimensions is a
              wall, and the user who needs none of them should not pay for
              it. The toggle lives in the strip below the field; the options
              open ABOVE the text so the caret never jumps. */}
          <View
            {...(dock.measured ? { onLayout: dock.onLayout } : {})}
            style={[dock.style, { borderBottomWidth: dockOpen ? 1 : 0, borderBottomColor: palette.line }]}
          >
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={{ flexDirection: 'row', alignItems: 'center', gap: 6, paddingHorizontal: 12, paddingVertical: 8 }}
            >
              <ConfigChips sessionId={sessionId} />
            </ScrollView>
          </View>

          <TextInput
            ref={inputRef}
            value={text}
            onChangeText={setText}
            placeholder={placeholder}
            placeholderTextColor={palette.ink4}
            multiline
            editable={!disabled}
            accessibilityLabel="Message the agent"
            className="max-h-[132px] min-h-[44px] bg-transparent px-4 pb-1 pt-3 text-[15.5px] leading-[22px] text-ink"
          />

          {/* ── Control strip ───────────────────────────────────────────
              Pinned to the bottom edge of the card, ChatGPT-style: attach
              and the Run toggle on the left, the context ring, then Stop
              beside Send on the right. Because the strip sits *below* the
              growing field instead of after it, the send control stays on
              screen no matter how tall the text gets — the field grows
              upward into the space above it, capped at ~132px. */}
          <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4, paddingLeft: 6, paddingRight: 10, paddingBottom: 10, paddingTop: 4 }}>
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Attach images"
              disabled={disabled || uploading}
              onPress={() => void attach()}
              hitSlop={8}
              style={({ pressed }) => ({
                width: 36,
                height: 36,
                borderRadius: radius.pill,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: pressed ? palette.hover : 'transparent',
                opacity: disabled ? 0.35 : 1,
              })}
            >
              {uploading ? (
                <ActivityIndicator size="small" color={palette.ink3} />
              ) : (
                <Paperclip size={17} color={palette.ink2} />
              )}
            </Pressable>

            <Pressable
              accessibilityRole="button"
              accessibilityLabel={dockOpen ? 'Hide session controls' : 'Show session controls'}
              accessibilityState={{ expanded: dockOpen }}
              onPress={() => setDockOpen((value) => !value)}
              hitSlop={10}
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 5,
                minHeight: 36,
                paddingRight: 4,
              }}
            >
              <Brain size={14} color={dockOpen ? palette.accent : palette.ink3} />
              <Text
                className="text-[11px] font-semibold uppercase"
                style={{ color: dockOpen ? palette.accent : palette.ink3, letterSpacing: 0.9 }}
              >
                Run
              </Text>
              <ChevronDown
                size={12}
                color={palette.ink4}
                style={{ transform: [{ rotate: dockOpen ? '180deg' : '0deg' }] }}
              />
            </Pressable>

            <View style={{ flex: 1 }} />

            <ContextRing sessionId={sessionId} working={busy} />

            {busy ? (
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Stop this session"
                onPress={() => {
                  void haptic('warn')
                  void stopSession(sessionId)
                }}
                style={({ pressed }) => ({
                  width: 36,
                  height: 36,
                  marginLeft: 4,
                  borderRadius: radius.pill,
                  alignItems: 'center',
                  justifyContent: 'center',
                  backgroundColor: pressed ? palette.dangerBorder : palette.dangerSoft,
                })}
              >
                <Square size={13} color={palette.danger} fill={palette.danger} />
              </Pressable>
            ) : null}

            <Pressable
              accessibilityRole="button"
              accessibilityLabel={busy ? 'Queue this follow-up' : 'Send message'}
              accessibilityHint={
                busy
                  ? 'Adds this message to the queue for the next turn'
                  : 'Sends this message to the agent'
              }
              accessibilityState={{ disabled: !canSend }}
              onPress={submit}
              disabled={!canSend}
              style={({ pressed }) => ({
                minWidth: busy ? 46 : 36,
                height: 36,
                marginLeft: 4,
                flexDirection: 'row',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 5,
                borderRadius: radius.pill,
                paddingHorizontal: busy ? 14 : 0,
                backgroundColor: !canSend
                  ? palette.raised
                  : pressed
                    ? palette.accentPressed
                    : palette.accent,
              })}
            >
              <ArrowUp size={18} color={canSend ? palette.accentInk : palette.ink4} strokeWidth={2.6} />
              {busy ? (
                <Text
                  className="text-[13px] font-bold"
                  style={{ color: canSend ? palette.accentInk : palette.ink4 }}
                >
                  Queue
                </Text>
              ) : null}
            </Pressable>
          </View>
        </View>
      </View>

      {attachError ? (
        <Text className="mt-1.5 px-1 text-[11.5px] leading-[16px] text-danger">{attachError}</Text>
      ) : null}
    </View>
  )
}

export { Popover }
