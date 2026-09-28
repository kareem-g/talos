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
import { ActivityIndicator, Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native'
import { ArrowUp, ChevronDown, Paperclip, Pencil, Square, Trash2, Undo2, X } from 'lucide-react-native'
import * as ImagePicker from 'expo-image-picker'
import Svg, { Circle } from 'react-native-svg'

import { cn } from '@/lib/format'
import type { ConfigOption } from '@/types/provider'
import type { UIState } from '@/lib/sessionState'
import { attachmentsApi } from '@app/lib/api'
import { socket } from '@app/lib/socket'
import { getConversation, useStore } from '@app/store'
import type { AttachmentRef, QueuedMessage } from '@/types/conversation'
import { Button, Mono } from '@app/components/ui'

/** Commands each CLI answers, mirroring the desktop's menu. */
const BUILTIN_COMMANDS: Record<string, string[]> = {
  claude: ['init', 'compact', 'review', 'security-review', 'pr-comments', 'release-notes'],
  opencode: ['init', 'compact', 'share', 'unshare', 'help'],
  codex: ['init', 'compact', 'review'],
}
const CUSTOM_COMMANDS = ['orchestrator', 'review', 'plan', 'worker', 'summarize', 'side', 'btw']

/** Options the desktop deliberately keeps out of the chip row. */
const HIDDEN_OPTIONS = new Set(['worktree', 'cwd', 'command'])

/**
 * A stable empty queue. `?? []` inside a zustand selector allocates a new array
 * on every store update, so the snapshot identity changes even when nothing about
 * this session moved.
 */
const NO_QUEUE: QueuedMessage[] = []

export function Composer({ sessionId, uiState }: { sessionId: string; uiState: UIState }) {
  const connection = useStore((state) => state.connection)
  const config = useStore((state) => state.configs[sessionId])
  const queue = useStore((state) => state.queues[sessionId]) ?? NO_QUEUE
  const sendPrompt = useStore((state) => state.sendPrompt)
  const queueMessage = useStore((state) => state.queueMessage)
  const removeQueued = useStore((state) => state.removeQueued)
  const steerQueued = useStore((state) => state.steerQueued)
  const stopSession = useStore((state) => state.stopSession)
  const session = useStore((state) => state.sessions.find((row) => row.id === sessionId))

  const [text, setText] = React.useState('')
  const [menu, setMenu] = React.useState<string | null>(null)
  const [attachments, setAttachments] = React.useState<AttachmentRef[]>([])
  const [uploading, setUploading] = React.useState(false)
  const [attachError, setAttachError] = React.useState<string | null>(null)
  const inputRef = React.useRef<TextInput>(null)

  const busy = uiState === 'working' || uiState === 'starting' || uiState === 'resuming'
  const disabled = connection !== 'connected'
  const canSend = (text.trim().length > 0 || attachments.length > 0) && !disabled

  const options = (config?.options ?? []).filter(
    // `start_only` dimensions cannot change mid-session, so they are not chips.
    (option) => !HIDDEN_OPTIONS.has(option.id) && option.mutability !== 'start_only',
  )

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
        const name = asset.fileName ?? `image-${Date.now()}.jpg`
        const uploaded = await attachmentsApi.upload(sessionId, {
          uri: asset.uri,
          name,
          type: asset.mimeType,
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
    const agentId = session?.agent ?? config?.agent ?? ''
    const all = [...(BUILTIN_COMMANDS[agentId] ?? []), ...CUSTOM_COMMANDS]
    const unique = Array.from(new Set(all))
    const query = slashQuery[2].toLowerCase()
    return unique.filter((command) => command.startsWith(query)).slice(0, 8)
  }, [slashQuery, session?.agent, config?.agent])

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
          <View className="absolute bottom-full left-0 right-0 z-20 mb-2 overflow-hidden rounded-xl border border-line bg-surface">
            <View className="border-b border-line px-2.5 py-1.5">
              <Mono className="text-[10px] uppercase tracking-wider">Commands</Mono>
            </View>
            <View className="py-1">
              {commands.map((command) => (
                <Pressable
                  key={command}
                  onPress={() => insertCommand(command)}
                  className="flex-row items-center gap-2.5 px-3 py-2 active:bg-hover-2"
                >
                  <View className="size-5 items-center justify-center rounded-md bg-orange-tint">
                    <Mono className="text-[10px] font-semibold text-orange">/</Mono>
                  </View>
                  <Mono className="min-w-0 flex-1 text-[12px] text-ink">{command}</Mono>
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}

        <View className={cn('rounded-xl border bg-surface', 'border-line')}>
          {/* Queue */}
          {queue.length > 0 ? (
            <View className="border-b border-line bg-inset px-2 py-1.5">
              <Mono className="px-1 pb-1 text-[9.5px] uppercase tracking-[0.12em]">
                Queued · {queue.length}
              </Mono>
              <View className="gap-1">
                {queue.map((message) => (
                  <View
                    key={message.id}
                    className="flex-row items-center gap-1.5 rounded-lg border border-line bg-surface px-2 py-1.5"
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
                      className="shrink-0 flex-row items-center gap-1 rounded-lg border border-line bg-inset px-2 py-1"
                    >
                      <Undo2 size={12} color="#b0b0b6" />
                      <Text className="text-[11px] font-medium text-ink-2">Steer</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => void editQueued(message)}
                      accessibilityLabel="Edit"
                      className="size-7 items-center justify-center rounded-lg active:bg-hover-2"
                    >
                      <Pencil size={13} color="#7e7e86" />
                    </Pressable>
                    <Pressable
                      onPress={() => removeQueued(sessionId, message.id)}
                      accessibilityLabel="Remove"
                      className="size-7 items-center justify-center rounded-lg active:bg-red-tint"
                    >
                      <Trash2 size={13} color="#7e7e86" />
                    </Pressable>
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
                  className="flex-row items-center gap-1 rounded-lg border border-line bg-inset px-1.5 py-0.5"
                >
                  <Paperclip size={10} color="#b0b0b6" />
                  <Text className="max-w-[160px] text-[10.5px] text-ink-2" numberOfLines={1}>
                    {attachment.fileName}
                  </Text>
                  <Pressable
                    onPress={() =>
                      setAttachments((current) => current.filter((entry) => entry.ref !== attachment.ref))
                    }
                    accessibilityLabel={`Remove ${attachment.fileName}`}
                    className="size-5 items-center justify-center rounded"
                  >
                    <X size={10} color="#7e7e86" />
                  </Pressable>
                </View>
              ))}
            </View>
          ) : null}

          <TextInput
            ref={inputRef}
            value={text}
            onChangeText={setText}
            placeholder={placeholder}
            placeholderTextColor="#7e7e86"
            multiline
            editable={!disabled}
            className="max-h-[168px] min-h-[42px] bg-transparent px-3.5 pt-3 text-[13px] leading-5 text-ink"
          />

          {/* Control row */}
          <View className="flex-row items-center gap-1.5 px-2 pb-2 pt-1.5">
            <Pressable
              onPress={() => void attach()}
              disabled={disabled || uploading}
              accessibilityLabel="Attach images"
              className="size-7 items-center justify-center rounded-lg active:bg-hover-2"
            >
              {uploading ? (
                <ActivityIndicator size="small" color="#7e7e86" />
              ) : (
                <Paperclip size={15} color={disabled ? '#52525b' : '#7e7e86'} />
              )}
            </Pressable>
            <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerClassName="gap-1.5 pr-2">
              {options.map((option) => (
                <OptionChip
                  key={option.id}
                  option={option}
                  onOpen={() => setMenu(option.id)}
                />
              ))}
            </ScrollView>

            <View className="flex-1" />
            <ContextRing sessionId={sessionId} working={busy} />

            {busy ? (
              <Pressable
                onPress={submit}
                disabled={!canSend}
                accessibilityLabel="Queue follow-up"
                className={cn(
                  'size-8 items-center justify-center rounded-lg',
                  canSend ? 'bg-accent' : 'bg-hover',
                )}
              >
                <ArrowUp size={16} color={canSend ? '#0d1322' : '#7e7e86'} />
              </Pressable>
            ) : null}
            {busy ? (
              <Pressable
                onPress={() => void stopSession(sessionId)}
                accessibilityLabel="Stop"
                className="size-8 items-center justify-center rounded-lg bg-red-tint"
              >
                <Square size={13} color="#f85149" fill="#f85149" />
              </Pressable>
            ) : (
              <Pressable
                onPress={submit}
                disabled={!canSend}
                accessibilityLabel="Send"
                className={cn(
                  'size-8 items-center justify-center rounded-lg',
                  canSend ? 'bg-ink' : 'bg-hover',
                )}
              >
                <ArrowUp size={16} color={canSend ? '#131315' : '#7e7e86'} />
              </Pressable>
            )}
          </View>
        </View>
      </View>

      {attachError ? (
        <Text className="mt-1 px-1 text-[11px] leading-4 text-red">{attachError}</Text>
      ) : null}

      <OptionSheet
        sessionId={sessionId}
        options={options}
        openId={menu}
        onClose={() => setMenu(null)}
      />
    </View>
  )
}

/* ── Option chip ─────────────────────────────────────────────────────────── */

function OptionChip({ option, onOpen }: { option: ConfigOption; onOpen: () => void }) {
  const current = option.choices.find((choice) => choice.value === option.currentValue)
  const label = current?.name || option.currentValue || option.name
  return (
    <Pressable
      onPress={onOpen}
      className="min-h-7 flex-row items-center gap-1.5 rounded-lg border border-line bg-surface px-2"
    >
      <Text className="text-[11px] text-ink-3">{option.name}</Text>
      <Text className="max-w-[110px] text-[11px] font-medium text-ink-2" numberOfLines={1}>
        {label}
      </Text>
      <ChevronDown size={10} color="#7e7e86" />
    </Pressable>
  )
}

/** The native stand-in for the desktop's anchored `DropdownList`. */
function OptionSheet({
  sessionId,
  options,
  openId,
  onClose,
}: {
  sessionId: string
  options: ConfigOption[]
  openId: string | null
  onClose: () => void
}) {
  const option = options.find((candidate) => candidate.id === openId) ?? null
  const [custom, setCustom] = React.useState('')

  React.useEffect(() => setCustom(''), [openId])

  function choose(value: string) {
    if (!option) return
    socket.setConfig(sessionId, option.id, value)
    onClose()
  }

  return (
    <Modal visible={option !== null} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable className="flex-1 justify-end bg-black/65" onPress={onClose}>
        <Pressable className="max-h-[80%] rounded-t-2xl border border-line bg-surface" onPress={() => {}}>
          <View className="flex-row items-center justify-between border-b border-line px-3.5 py-2.5">
            <Text className="text-[13px] font-medium text-ink">{option?.name ?? ''}</Text>
            <Pressable onPress={onClose} accessibilityLabel="Close" className="size-9 items-center justify-center rounded-full">
              <X size={16} color="#b0b0b6" />
            </Pressable>
          </View>
          <ScrollView contentContainerClassName="p-1.5">
            {option?.choices.map((choice) => {
              const active = choice.value === option.currentValue
              return (
                <Pressable
                  key={choice.value}
                  onPress={() => choose(choice.value)}
                  className={cn(
                    'min-h-11 flex-row items-center gap-2 rounded-control px-2.5',
                    active && 'bg-hover',
                  )}
                >
                  <Text className="min-w-0 flex-1 text-[12.5px] text-ink" numberOfLines={1}>
                    {choice.name || choice.value}
                  </Text>
                  {active ? <View className="size-1.5 rounded-full bg-green" /> : null}
                </Pressable>
              )
            })}
            {option?.allowsCustomValue ? (
              <View className="flex-row items-center gap-2 px-2.5 py-2">
                <TextInput
                  value={custom}
                  onChangeText={setCustom}
                  placeholder="Custom value…"
                  placeholderTextColor="#7e7e86"
                  autoCapitalize="none"
                  autoCorrect={false}
                  className="min-h-10 flex-1 rounded-lg border border-line bg-field px-2.5 text-[12.5px] text-ink"
                />
                <Button
                  variant="surface"
                  label="Use"
                  disabled={custom.trim().length === 0}
                  onPress={() => choose(custom.trim())}
                />
              </View>
            ) : null}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  )
}

/* ── Context ring ────────────────────────────────────────────────────────── */

const RING_RADIUS = 5.5
const RING_CIRCUMFERENCE = 2 * Math.PI * RING_RADIUS

/**
 * The desktop's context-usage ring: the agent's most recent reported usage
 * against the configured window, amber past 60% and red past 85%. Tapping it
 * opens the same breakdown the desktop shows in its popover.
 */
function ContextRing({ sessionId, working }: { sessionId: string; working: boolean }) {
  // Subscribing to the revision counter is what re-derives usage as turns stream.
  const revision = useStore((state) => state.revisions[sessionId] ?? 0)
  const options = useStore((state) => state.configs[sessionId]?.options)
  const [open, setOpen] = React.useState(false)

  const usage = React.useMemo(() => {
    const messages = getConversation(sessionId).messages
    let found: { inputTokens?: number; outputTokens?: number; cacheReadTokens?: number; costUsd?: number } | undefined
    for (let index = messages.length - 1; index >= 0 && !found; index--) {
      const message = messages[index]
      if (message.role !== 'assistant') continue
      found = message.parts.find(
        (part): part is Extract<typeof part, { kind: 'usage' }> => part.kind === 'usage',
      )
    }
    if (!found || ((found.inputTokens ?? 0) <= 0 && (found.outputTokens ?? 0) <= 0)) return undefined
    const windowTokens = Number.parseInt(
      options?.find((option) => option.id === 'context_window')?.currentValue ?? '',
      10,
    )
    return {
      input: found.inputTokens ?? 0,
      output: found.outputTokens ?? 0,
      cached: found.cacheReadTokens ?? 0,
      cost: found.costUsd ?? 0,
      window: Number.isFinite(windowTokens) && windowTokens > 0 ? windowTokens : undefined,
    }
    // `revision` is a dependency so streaming usage updates the ring.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sessionId, options, revision])

  if (working) {
    return (
      <View className="size-5 items-center justify-center">
        <ActivityIndicator size="small" color="#b0b0b6" />
      </View>
    )
  }
  if (!usage) return <View className="size-5" />

  const pct = usage.window ? Math.min(100, (usage.input / usage.window) * 100) : 0
  const color = pct > 85 ? '#f85149' : pct > 60 ? '#db6d28' : '#57ab5a'

  return (
    <>
      <Pressable
        onPress={() => setOpen(true)}
        accessibilityLabel="Context window"
        className="size-5 items-center justify-center"
      >
        <Svg width={14} height={14} viewBox="0 0 14 14">
          <Circle cx={7} cy={7} r={RING_RADIUS} stroke="#34343a" strokeWidth={2} fill="none" />
          {usage.window ? (
            <Circle
              cx={7}
              cy={7}
              r={RING_RADIUS}
              stroke={color}
              strokeWidth={2}
              fill="none"
              strokeDasharray={`${RING_CIRCUMFERENCE}`}
              strokeDashoffset={RING_CIRCUMFERENCE * (1 - pct / 100)}
              rotation={-90}
              origin={`${7}, ${7}`}
            />
          ) : null}
        </Svg>
      </Pressable>

      <Modal visible={open} transparent animationType="slide" onRequestClose={() => setOpen(false)}>
        <Pressable className="flex-1 justify-end bg-black/65" onPress={() => setOpen(false)}>
          <Pressable className="rounded-t-2xl border border-line bg-surface p-4" onPress={() => {}}>
            <View className="flex-row items-center justify-between">
              <Text className="text-[12px] font-medium text-ink">Context window</Text>
              <Mono className="text-[11px]">
                {formatTokens(usage.input)}
                {usage.window ? ` / ${formatTokens(usage.window)} (${Math.round(pct)}%)` : ' sent'}
              </Mono>
            </View>
            {usage.window ? (
              <View className="mt-2 h-1.5 overflow-hidden rounded-full bg-field">
                <View className="h-full rounded-full" style={{ width: `${Math.max(2, pct)}%`, backgroundColor: color }} />
              </View>
            ) : null}
            <View className="mt-3 gap-1.5">
              <UsageRow label="Context sent" value={formatTokens(usage.input)} />
              <UsageRow label="Last output" value={formatTokens(usage.output)} />
              <UsageRow label="Cache reads" value={formatTokens(usage.cached)} />
              {usage.cost > 0 ? <UsageRow label="Cost" value={`$${usage.cost.toFixed(4)}`} /> : null}
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </>
  )
}

function UsageRow({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row items-center justify-between">
      <Text className="text-[11.5px] text-ink-2">{label}</Text>
      <Mono className="text-[11px] text-ink">{value}</Mono>
    </View>
  )
}

function formatTokens(tokens: number): string {
  if (tokens >= 1_000_000) return `${(tokens / 1_000_000).toFixed(1)}M`
  if (tokens >= 10_000) return `${Math.round(tokens / 1000)}k`
  if (tokens >= 1_000) return `${(tokens / 1000).toFixed(1)}k`
  return String(tokens)
}
