/**
 * Composer — one rounded field on a hairline chrome strip: attach · input ·
 * stop · send. The send control is always a filled circle (blue when it will
 * send, grey while it can't); when the agent is busy it grows a Queue label
 * without ever moving. Queued messages and attachments stack as capsules
 * above the field; typing "/" opens the command menu.
 */

import * as React from 'react'
import { ActivityIndicator, Image, Pressable, TextInput, View } from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import * as ImagePicker from 'expo-image-picker'
import * as ImageManipulator from 'expo-image-manipulator'

import type { AttachmentRef, Conversation, QueuedMessage } from '@/types/conversation'
import type { Session } from '@/types/session'
import type { UIState } from '@/lib/sessionState'
import { attachmentsApi, skillsApi, workspaceApi } from '@/lib/api'
import { cn } from '@/lib/format'
import { TOKEN_TONE, activeToken, hasToken, insertToken, TokenText } from './tokens'
import { useStore } from '@/store'
import { color } from '../design/tokens'
import { MONO, W_SEMI } from '../design/fonts'
import { ArrowUp, Clip, Close, Pencil, Play, Stop, Trash } from '../design/icons'
import { useKeyboardHeight } from '@/lib/keyboard'
import { Chrome, Text, Tap, haptic } from '../ui'

const BUILTIN: Record<string, string[]> = {
  claude: ['init', 'compact', 'review', 'security-review', 'pr-comments', 'release-notes'],
  opencode: ['init', 'compact', 'share', 'unshare', 'help'],
  codex: ['init', 'compact', 'review'],
}
const CUSTOM = ['orchestrator', 'review', 'plan', 'worker', 'summarize', 'side', 'btw']
const DESCRIPTIONS: Record<string, string> = {
  review: 'Ask the agent to review its diff',
  'release-notes': 'Summarise changes since the last tag',
  'security-review': 'Ask the agent to security-review its diff',
  compact: 'Compress the transcript to free context',
  init: 'Write a CLAUDE.md for this project',
  plan: 'Produce a plan before any changes',
  summarize: 'Summarise this session so far',
}

const NO_QUEUE: QueuedMessage[] = []

/** An attachment while it is being composed: upload result + local preview. */
type Staged = AttachmentRef & { localUri?: string }
const MAX_UPLOAD_WIDTH = 1600

export function Composer({
  session,
  uiState,
  chromeTarget,
}: {
  session: Session
  conversation: Conversation
  uiState: UIState
  /** What the composer floats over — the transcript, so the blur has a source. */
  chromeTarget?: React.RefObject<View | null>
}) {
  const insets = useSafeAreaInsets()
  // While the keyboard is up the session has already lifted this view by the
  // IME's height, so the home-indicator inset would be dead space under it.
  const keyboard = useKeyboardHeight()
  const connection = useStore((state) => state.connection)
  const queue = useStore((state) => state.queues[session.id]) ?? NO_QUEUE
  const sendPrompt = useStore((state) => state.sendPrompt)
  const queueMessage = useStore((state) => state.queueMessage)
  const removeQueued = useStore((state) => state.removeQueued)
  const steerQueued = useStore((state) => state.steerQueued)
  const stopSession = useStore((state) => state.stopSession)
  const resumeSession = useStore((state) => state.resumeSession)
  const resendLastUserPrompt = useStore((state) => state.resendLastUserPrompt)

  const [text, setText] = React.useState('')
  const [attachments, setAttachments] = React.useState<Staged[]>([])
  const [uploading, setUploading] = React.useState(false)
  const [attachError, setAttachError] = React.useState<string | null>(null)

  const busy = uiState === 'working' || uiState === 'starting' || uiState === 'resuming'
  const needsResume = uiState === 'paused' || uiState === 'failed'
  const disabled = connection !== 'connected'
  const canSend = (text.trim().length > 0 || attachments.length > 0) && !disabled

  function submit() {
    const value = text.trim()
    if ((!value && attachments.length === 0) || disabled) return
    void haptic(busy ? 'medium' : 'light')
    if (busy) queueMessage(session.id, value, attachments)
    else sendPrompt(session.id, value, attachments)
    setText('')
    setAttachments([])
  }

  async function attach() {
    setAttachError(null)
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync()
    if (!permission.granted) {
      setAttachError('Photo access is off. Enable it in Settings to attach images.')
      return
    }
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['images'], allowsMultipleSelection: true, quality: 0.9 })
    if (result.canceled || result.assets.length === 0) return
    setUploading(true)
    try {
      for (const asset of result.assets) {
        const target = await ImageManipulator.manipulateAsync(
          asset.uri,
          [{ resize: { width: Math.min(asset.width || MAX_UPLOAD_WIDTH, MAX_UPLOAD_WIDTH) } }],
          { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG },
        )
        const name = (asset.fileName ?? `image-${Date.now()}`).replace(/\.[^.]+$/, '') + '.jpg'
        const uploaded = await attachmentsApi.upload(session.id, { uri: target.uri, name, type: 'image/jpeg' })
        setAttachments((current) => [
          ...current,
          ...uploaded.map((file) => ({ ref: file.ref, name: file.name, fileName: file.fileName, contentType: file.contentType, size: file.size, path: file.path, localUri: target.uri })),
        ])
      }
    } catch (cause) {
      setAttachError(cause instanceof Error ? cause.message : 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  // The token under the caret — `$skill`, `@file` or `/command` — and what it
  // can be completed to. Sources differ per trigger: commands are the engine's
  // own, skills come from the project's installed set, files from the workspace.
  const [caret, setCaret] = React.useState(0)
  const active = React.useMemo(() => activeToken(text, caret), [text, caret])

  const [skillNames, setSkillNames] = React.useState<Array<{ name: string; description?: string }>>([])
  const [fileNames, setFileNames] = React.useState<string[]>([])

  React.useEffect(() => {
    if (active?.kind !== 'skill') return
    void skillsApi
      .installed(session.project ?? '')
      .then((data) => setSkillNames(data.skills ?? []))
      .catch(() => setSkillNames([]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.kind, session.project])

  React.useEffect(() => {
    if (active?.kind !== 'at') return
    void workspaceApi
      .dirs(session.project ?? undefined, true)
      .then((listing) => {
        const query = active.query.toLowerCase()
        setFileNames(
          (listing.entries ?? [])
            .map((entry) => entry.name)
            .filter((name) => name.toLowerCase().includes(query))
            .slice(0, 8),
        )
      })
      .catch(() => setFileNames([]))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.kind, active?.query, session.project])

  const completions = React.useMemo(() => {
    if (!active) return []
    const query = active.query.toLowerCase()
    if (active.kind === 'slash') {
      const all = [...(BUILTIN[session.agent] ?? []), ...CUSTOM]
      return Array.from(new Set(all))
        .filter((command) => command.startsWith(query))
        .slice(0, 8)
        .map((command) => ({ value: command, hint: DESCRIPTIONS[command] }))
    }
    if (active.kind === 'skill') {
      return skillNames
        .filter((skill) => skill.name.toLowerCase().includes(query))
        .slice(0, 8)
        .map((skill) => ({ value: skill.name, hint: skill.description }))
    }
    return fileNames.map((name) => ({ value: name, hint: undefined }))
  }, [active, session.agent, skillNames, fileNames])

  function insert(value: string) {
    if (!active) return
    setText(insertToken(text, caret, active.kind === 'at' ? '@' : active.kind === 'skill' ? '$' : '/', value))
    void haptic('select')
  }

  const placeholder = disabled
    ? 'Waiting for connection…'
    : busy
      ? 'Queue a follow-up for the next turn'
      : 'Message the agent…'

  return (
    <View
      className="shrink-0"
      style={{
        paddingBottom: keyboard > 0 ? 8 : Math.max(insets.bottom, 10),
        borderTopWidth: 0.5,
        borderTopColor: color.line,
      }}
    >
      <Chrome target={chromeTarget} />

      <View className="px-4 pt-2">
        {/* Trigger menu — the active token's completions, in its own colour */}
        {active && completions.length > 0 ? (
          <View className="mb-2 overflow-hidden rounded-[14px] border border-line bg-raised">
            <View className="border-b border-line px-3.5 py-1.5">
              <Text className="text-[10px] uppercase text-ink-3" style={{ fontFamily: MONO, letterSpacing: 1 }}>
                {active.kind === 'at' ? 'Files' : active.kind === 'skill' ? 'Skills' : 'Commands'}
              </Text>
            </View>
            {completions.map((option) => (
              <Tap
                key={option.value}
                accessibilityRole="button"
                accessibilityLabel={`Insert ${active.kind === 'at' ? '@' : active.kind === 'skill' ? '$' : '/'}${option.value}`}
                onPress={() => insert(option.value)}
                className="min-h-10 flex-row items-center gap-2.5 px-3.5"
              >
                <Text
                  className={cn('shrink-0 text-[13px]', TOKEN_TONE[active.kind].ink)}
                  style={{ fontFamily: MONO }}
                  numberOfLines={1}
                >
                  {active.kind === 'at' ? '@' : active.kind === 'skill' ? '$' : '/'}
                  {option.value}
                </Text>
                {option.hint ? (
                  <Text className="min-w-0 flex-1 text-right text-[11px] text-ink-3" numberOfLines={1}>
                    {option.hint}
                  </Text>
                ) : (
                  <View className="flex-1" />
                )}
              </Tap>
            ))}
          </View>
        ) : null}

        {/* Resume card */}
        {needsResume && !busy ? (
          <Tap
            accessibilityRole="button"
            accessibilityLabel="Resume this session"
            onPress={() => {
              void haptic('medium')
              void resumeSession(session.id).then((ok) => {
                if (ok) resendLastUserPrompt(session.id)
              })
            }}
            className="mb-2 h-11 flex-row items-center justify-center gap-2 rounded-[14px] bg-raised px-4"
          >
            <Play size={14} color={color.green} />
            <Text className="text-[14px] font-semibold text-ink" weight={W_SEMI}>
              Resume session
            </Text>
            <Text className="text-[12.5px] text-ink-3">· continue from where it left off</Text>
          </Tap>
        ) : null}

        {/* Attachment thumbnails — the actual selected images, 56px squares */}
        {attachments.length > 0 ? (
          <View className="mb-2 flex-row flex-wrap gap-2.5">
            {attachments.map((attachment) => (
              <View key={attachment.ref} className="relative">
                {attachment.localUri ? (
                  <Image
                    source={{ uri: attachment.localUri }}
                    accessibilityLabel={`Attached image ${attachment.fileName}`}
                    className="h-14 w-14 rounded-[10px]"
                    style={{ backgroundColor: color.plate }}
                  />
                ) : (
                  <View className="h-14 w-14 items-center justify-center rounded-[10px] bg-field">
                    <Clip size={18} color={color.ink3} />
                  </View>
                )}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel={`Remove ${attachment.fileName}`}
                  onPress={() => setAttachments((current) => current.filter((entry) => entry.ref !== attachment.ref))}
                  hitSlop={6}
                  className="absolute size-[22px] items-center justify-center rounded-full border border-line bg-raised"
                  style={{ position: 'absolute', top: -6, right: -6 }}
                >
                  <Close size={11} color={color.ink2} />
                </Pressable>
              </View>
            ))}
          </View>
        ) : null}

        {/* Queued follow-ups */}
        {queue.length > 0 ? (
          <View className="gap-2">
          {queue.map((message) => (
            <View key={message.id} className="ml-0.5 flex-row items-center gap-2 rounded-full bg-raised py-[5px] pl-[13px] pr-1.5">
              <Text className="min-w-0 flex-1 text-[13px] text-ink" numberOfLines={1}>
                {message.text || `${message.attachments.length} attachment(s)`}
              </Text>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Send this queued message now"
                onPress={() => {
                  void haptic('medium')
                  steerQueued(session.id, message.id)
                }}
                className="h-[26px] items-center justify-center rounded-full bg-field px-[11px]"
              >
                <Text className="text-[11.5px] font-semibold text-ink-2">Steer</Text>
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Edit queued message"
                onPress={() => {
                  removeQueued(session.id, message.id)
                  setText(message.text)
                }}
                hitSlop={6}
                className="size-[26px] items-center justify-center rounded-full"
              >
                <Pencil size={13} color={color.ink3} />
              </Pressable>
              <Pressable
                accessibilityRole="button"
                accessibilityLabel="Remove queued message"
                onPress={() => removeQueued(session.id, message.id)}
                hitSlop={6}
                className="size-[26px] items-center justify-center rounded-full"
              >
                <Trash size={13} color={color.ink3} />
              </Pressable>
            </View>
          ))}
          </View>
        ) : null}
        {(queue.length > 0 || attachments.length > 0) && <View className="h-2" />}

        {/* The field. Its height is the input's (5 + 34 + 5 = 44), the same as
            the mockup's `.composer-field`: a fixed `minHeight` here added slack
            above the controls and pushed the whole row off the field's centre.
            Padding is symmetric so the paperclip and the send sit the same
            distance from the two ends. */}
        <View
          className="flex-row items-end gap-1.5 rounded-[22px] bg-raised"
          style={{ paddingTop: 5, paddingBottom: 5, paddingLeft: 8, paddingRight: 8 }}
        >
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Attach images"
            disabled={disabled || uploading}
            onPress={() => void attach()}
            hitSlop={8}
            className="h-[34px] w-[32px] shrink-0 items-center justify-center rounded-full"
            style={{ opacity: disabled ? 0.35 : 1 }}
          >
            {uploading ? <ActivityIndicator size="small" color={color.ink3} /> : <Clip size={16} color={color.ink3} />}
          </Pressable>
          {/* The draft, with its tokens coloured, drawn behind the input. */}
          {hasToken(text) ? (
            <View pointerEvents="none" className="absolute left-2 right-2 top-0 bottom-0 justify-center px-1.5">
              <TokenText text={text} className="text-[15.5px] leading-[21px]" trailing />
            </View>
          ) : null}
          <TextInput
            value={text}
            onChangeText={setText}
            onSelectionChange={(event) => setCaret(event.nativeEvent.selection.end)}
            // Transparent glyphs when a token is present: the coloured layer
            // behind is what the eye should read, and the caret stays visible
            // because it is drawn from `selectionColor`, not from the text.
            selectionColor={color.accent}
            placeholder={placeholder}
            placeholderTextColor={color.ink3}
            multiline
            editable={!disabled}
            accessibilityLabel="Message the agent"
            className="min-w-0 flex-1 text-[15.5px] leading-[21px] text-ink"
            style={[
              { minHeight: 34, maxHeight: 132, paddingVertical: 8, paddingHorizontal: 6, lineHeight: 21, textAlignVertical: 'top' },
              hasToken(text) ? { color: 'transparent' } : null,
            ]}
          />
          {busy ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Stop this session"
              onPress={() => {
                void haptic('warn')
                void stopSession(session.id)
              }}
              className="size-[34px] shrink-0 items-center justify-center rounded-full bg-red-tint"
            >
              <Stop size={12} color={color.red} />
            </Pressable>
          ) : null}
          {/* The box and the fill are class names, not a style object: on a
              Pressable that also carries `className`, NativeWind owns the style
              prop and an inline `backgroundColor` silently drops — which is why
              the disabled send drew no circle at all. Press feedback stays with
              `Tap` (scale + dim), exactly the mockup's `:active`. */}
          <Tap
            accessibilityRole="button"
            accessibilityLabel={busy ? 'Queue this follow-up' : 'Send message'}
            accessibilityState={{ disabled: !canSend }}
            onPress={submit}
            squeeze={0.92}
            className={cn(
              'h-[34px] shrink-0 flex-row items-center justify-center gap-1 rounded-full',
              busy ? 'px-3.5' : 'w-[34px]',
              canSend ? 'bg-accent' : 'bg-fill',
            )}
          >
            <ArrowUp size={busy ? 13 : 16} color={canSend ? color.accentInk : color.ink3} stroke={2.4} />
            {busy ? (
              <Text className="text-btn-md font-semibold text-accent-ink" weight={W_SEMI}>
                Queue
              </Text>
            ) : null}
          </Tap>
        </View>

        {attachError ? <Text className="mt-1.5 px-1 text-[11px] text-red">{attachError}</Text> : null}
      </View>
    </View>
  )
}