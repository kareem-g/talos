/**
 * ApprovalCard — renders one pending approval/question and resolves it through
 * the existing WebSocket action, never locally.
 *
 * The notification-security rule the spec insists on lives here: this card is
 * driven by the conversation state (which the session screen re-fetches from the
 * backend on open), and pressing an option sends `approval_response` /
 * `QuestionAnswer` over the socket. The backend validates and the agent continues
 * — a tap on a notification only navigates here; it never decides anything.
 *
 * Once `decision` is set (answered here, elsewhere, expired, or cancelled) the
 * card shows the outcome instead of live buttons, so a stale notification cannot
 * present an approval that is already gone.
 */

import * as React from 'react'
import { Pressable, Text, TextInput, View } from 'react-native'
import type { ApprovalPart } from '@/types/conversation'
import { useStore } from '@app/store'
import { cn } from '@/lib/format'
import { palette } from '@app/design/tokens'

const RISK_TONE: Record<string, string> = {
  low: 'text-ink-3',
  medium: 'text-orange',
  high: 'text-orange',
  critical: 'text-red',
}

export function ApprovalCard({ sessionId, part }: { sessionId: string; part: ApprovalPart }) {
  const respondToApproval = useStore((state) => state.respondToApproval)
  const answerQuestion = useStore((state) => state.answerQuestion)
  const [selected, setSelected] = React.useState<string[]>([])
  const [customText, setCustomText] = React.useState('')

  const resolved = part.decision !== undefined
  const options = part.optionData?.length
    ? part.optionData.map((o) => ({ value: o.value, label: o.label ?? o.value }))
    : part.options.map((value) => ({ value, label: value }))

  function choose(value: string) {
    if (resolved) return
    if (part.isQuestion) {
      // A question is answered with the option id(s); custom text rides along.
      answerQuestion(part.requestId, [value], customText.trim() || undefined)
    } else {
      respondToApproval(sessionId, part.requestId, value, {
        customText: customText.trim() || undefined,
        always: value === 'always',
      })
    }
  }

  function submitMulti() {
    if (resolved || selected.length === 0) return
    if (part.isQuestion) answerQuestion(part.requestId, selected, customText.trim() || undefined)
    else respondToApproval(sessionId, part.requestId, selected.join(', '), { customText: customText.trim() || undefined })
  }

  return (
    <View className="my-2 rounded-card border border-orange-border bg-orange-tint p-3">
      {part.header ? (
        <Text className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-orange">
          {part.header}
        </Text>
      ) : null}
      <View className="mb-2 flex-row items-start justify-between">
        <Text className="flex-1 text-[13px] leading-5 text-ink">{part.prompt}</Text>
        {part.riskLevel ? (
          <Text className={cn('ml-2 text-[10px] font-semibold uppercase', RISK_TONE[part.riskLevel.toLowerCase()] ?? 'text-ink-3')}>
            {part.riskLevel}
          </Text>
        ) : null}
      </View>

      {resolved ? (
        <View className="flex-row items-center rounded-control bg-surface px-3 py-2">
          <Text className="text-xs text-ink-2">
            {part.isQuestion ? 'Answered' : 'Resolved'}
            {part.decision ? ` · ${part.decision}` : ''}
          </Text>
        </View>
      ) : (
        <>
          {part.allowsCustomText ? (
            <TextInput
              value={customText}
              onChangeText={setCustomText}
              placeholder="Add a note (optional)"
              placeholderTextColor={palette.ink3}
              className="mb-2 rounded-control border border-line bg-field px-3 py-2 text-[13px] text-ink"
            />
          ) : null}

          {part.multiSelect ? (
            <View className="gap-1.5">
              {options.map((option) => {
                const on = selected.includes(option.value)
                return (
                  <Pressable
                    key={option.value}
                    onPress={() =>
                      setSelected((prev) =>
                        prev.includes(option.value)
                          ? prev.filter((v) => v !== option.value)
                          : [...prev, option.value],
                      )
                    }
                    className={cn(
                      'flex-row items-center rounded-control border px-3 py-2.5',
                      on ? 'border-accent bg-accent-tint' : 'border-line bg-surface',
                    )}
                  >
                    <View className={cn('mr-2 size-4 rounded border', on ? 'border-accent bg-accent' : 'border-line-strong')} />
                    <Text className="flex-1 text-[13px] text-ink">{option.label}</Text>
                  </Pressable>
                )
              })}
              <Pressable
                onPress={submitMulti}
                disabled={selected.length === 0}
                className={cn('mt-1 items-center rounded-control bg-accent py-2.5', selected.length === 0 && 'opacity-40')}
              >
                <Text className="text-[13px] font-medium text-accent-ink">Submit</Text>
              </Pressable>
            </View>
          ) : (
            <View className="flex-row flex-wrap gap-1.5">
              {options.map((option) => (
                <Pressable
                  key={option.value}
                  onPress={() => choose(option.value)}
                  className="rounded-control border border-line bg-surface px-3 py-2 active:bg-hover"
                >
                  <Text className="text-[13px] font-medium text-ink">{option.label}</Text>
                </Pressable>
              ))}
            </View>
          )}
        </>
      )}
    </View>
  )
}
