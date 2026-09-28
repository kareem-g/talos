/**
 * Composer — the message input for a session.
 *
 * Sends through the store (which writes an optimistic user message and pushes the
 * prompt over the socket). While the agent is mid-turn, a send is queued instead
 * of dropped — the store flushes the queue when the turn ends — and a Stop button
 * is offered. The full composer (slash-command chips, @-mention completion,
 * drag-reorderable queue, image/file attach, context meter) is Phase D; this is
 * the working core.
 */

import * as React from 'react'
import { Pressable, TextInput, View } from 'react-native'
import { ArrowUp, Square } from 'lucide-react-native'
import type { UIState } from '@/lib/sessionState'
import { useStore } from '@app/store'

export function Composer({ sessionId, uiState }: { sessionId: string; uiState: UIState }) {
  const sendPrompt = useStore((state) => state.sendPrompt)
  const queueMessage = useStore((state) => state.queueMessage)
  const stopSession = useStore((state) => state.stopSession)
  const [text, setText] = React.useState('')

  const busy = uiState === 'working' || uiState === 'starting' || uiState === 'resuming'
  const canSend = text.trim().length > 0

  function submit() {
    const value = text.trim()
    if (!value) return
    if (busy) queueMessage(sessionId, value)
    else sendPrompt(sessionId, value)
    setText('')
  }

  return (
    <View className="flex-row items-end gap-2 border-t border-line bg-canvas px-3 pb-3 pt-2">
      <TextInput
        value={text}
        onChangeText={setText}
        placeholder={busy ? 'Queue a follow-up…' : 'Message the agent…'}
        placeholderTextColor="#7e7e86"
        multiline
        className="max-h-32 min-h-[42px] flex-1 rounded-control border border-line bg-field px-3 py-2.5 text-[14px] text-ink"
      />
      {busy ? (
        <Pressable
          onPress={() => void stopSession(sessionId)}
          accessibilityLabel="Stop"
          className="size-[42px] items-center justify-center rounded-control border border-red-border bg-red-tint active:opacity-80"
        >
          <Square size={16} color="#f85149" fill="#f85149" />
        </Pressable>
      ) : null}
      <Pressable
        onPress={submit}
        disabled={!canSend}
        accessibilityLabel="Send"
        className={
          canSend
            ? 'size-[42px] items-center justify-center rounded-control bg-accent active:bg-accent-hover'
            : 'size-[42px] items-center justify-center rounded-control bg-surface opacity-40'
        }
      >
        <ArrowUp size={18} color={canSend ? '#0d1322' : '#7e7e86'} />
      </Pressable>
    </View>
  )
}
