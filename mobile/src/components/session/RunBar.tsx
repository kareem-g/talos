/**
 * The RunBar — the session's instrument readout.
 *
 * The desktop keeps a floating HUD over the transcript (git tools, plans,
 * progress, agents) and a separate state zone at the bottom of the composer.
 * On a phone both of those are the same question asked twice, so they collapse
 * into one 44pt strip directly under the header, where the answer is visible at
 * every scroll position:
 *
 *   state · what the agent is touching right now · what it has cost · context
 *
 * It is the reason the session screen needs no other chrome. The state word is
 * the same vocabulary the rest of the app uses, and when a human is the
 * bottleneck the strip inverts (paper ink on a faint accent wash) exactly like
 * the attention card does — the same call this language makes everywhere.
 */

import { View } from 'react-native'

import { ContextRing } from '@app/components/ConfigChips'
import { Dot, Mono } from '@app/components/ui'
import { palette, toneColor, type Tone } from '@app/design/tokens'
import { cn } from '@/lib/format'

export function RunBar({
  sessionId,
  tone,
  label,
  pulse,
  detail,
  cost,
  tokens,
  working,
}: {
  sessionId: string
  tone: Tone
  /** The state, in words — never colour alone. */
  label: string
  pulse?: boolean
  /** What the agent is touching right now, e.g. "editing tests/pairing.test.ts". */
  detail?: string
  cost?: number
  tokens?: number
  working: boolean
}) {
  // Attention inverts the strip: a faint accent wash and the state word in the
  // tone's own colour (paper ink). Anything else sits flat on chrome.
  const attention = tone === 'wait'

  return (
    <View
      className={cn('min-h-[44px] flex-row items-center gap-2.5 px-4 py-2')}
      style={{
        backgroundColor: attention ? palette.waitSoft : palette.chrome,
        borderBottomWidth: 1,
        borderBottomColor: attention ? palette.waitBorder : palette.line,
      }}
    >
      <Dot tone={tone} pulse={pulse} />

      <Mono className="text-[10px] uppercase" style={{ color: toneColor[tone], letterSpacing: 0.7 }}>
        {label}
      </Mono>

      {detail ? (
        <>
          <View style={{ width: 1, height: 11, backgroundColor: palette.line }} />
          <Mono className="min-w-0 flex-1 text-[10.5px] text-ink-3" numberOfLines={1}>
            {detail}
          </Mono>
        </>
      ) : (
        <View className="flex-1" />
      )}

      {cost !== undefined || tokens !== undefined ? (
        <Mono className="text-[10px] text-ink-4" numberOfLines={1}>
          {[
            tokens ? `${tokens > 999 ? `${Math.round(tokens / 1000)}k` : tokens} tok` : null,
            cost && cost > 0 ? `$${cost.toFixed(2)}` : null,
          ]
            .filter(Boolean)
            .join(' · ')}
        </Mono>
      ) : null}

      {/* Context pressure, the one number that predicts a stalled run. */}
      <ContextRing sessionId={sessionId} working={working} size={24} />
    </View>
  )
}