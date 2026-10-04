/**
 * ContextRing — the top bar's context-window control.
 *
 * The desktop puts a small progress ring on the composer; on a phone the top
 * bar is where a session's vitals belong, next to the model name. The ring
 * encodes how full the window is — green, amber past 60%, red past 85% — and
 * opens the token breakdown on tap.
 *
 * It is drawn inside the same 36pt filled circle as the two buttons beside it,
 * on purpose: a bare ring floating next to two filled circles read as a
 * loading spinner rather than a control. Same circle, same tap target, same
 * weight — the gauge is simply the glyph.
 *
 * With no window reported the track is drawn empty rather than filled to a
 * made-up level: an unknown reading should look unknown.
 */

import Svg, { Circle } from 'react-native-svg'

import { color } from '../design/tokens'
import { Tap, haptic } from '../ui'
import type { ContextUsage } from './context'

/** The circle matches `.icobtn`; the ring inside is sized to the icons' weight. */
const RING = 20
const STROKE = 2.2
const RADIUS = (RING - STROKE) / 2
const CIRCUMFERENCE = 2 * Math.PI * RADIUS

export function contextTone(percent: number | undefined): 'green' | 'orange' | 'red' | 'dim' {
  if (percent === undefined) return 'dim'
  if (percent >= 85) return 'red'
  if (percent >= 60) return 'orange'
  return 'green'
}

export function ContextRing({ usage, onPress }: { usage?: ContextUsage; onPress: () => void }) {
  const percent = usage?.percent
  const tone = contextTone(percent)
  const stroke =
    tone === 'red' ? color.red : tone === 'orange' ? color.orange : tone === 'green' ? color.green : color.ink3
  const offset = percent === undefined ? CIRCUMFERENCE : CIRCUMFERENCE * (1 - percent / 100)

  return (
    <Tap
      accessibilityRole="button"
      accessibilityLabel={
        percent === undefined
          ? 'Context window usage, not reported yet'
          : `Context window ${Math.round(percent)} percent full`
      }
      onPress={() => {
        void haptic('light')
        onPress()
      }}
      squeeze={0.92}
      hitSlop={{ top: 4, bottom: 4, left: 2, right: 2 }}
      // The 36pt box lives in the class list: a `Pressable` with both a
      // `className` and an inline size loses the inline one, and the gauge
      // collapses to the size of its own ring.
      className="h-9 w-9 shrink-0 items-center justify-center rounded-full bg-fill"
    >
      <Svg width={RING} height={RING} viewBox={`0 0 ${RING} ${RING}`}>
        <Circle cx={RING / 2} cy={RING / 2} r={RADIUS} stroke={color.ink4} strokeWidth={STROKE} fill="none" />
        {percent !== undefined ? (
          <Circle
            cx={RING / 2}
            cy={RING / 2}
            r={RADIUS}
            stroke={stroke}
            strokeWidth={STROKE}
            strokeLinecap="round"
            fill="none"
            strokeDasharray={`${CIRCUMFERENCE} ${CIRCUMFERENCE}`}
            strokeDashoffset={offset}
            // Start the arc at twelve o'clock, the way a gauge reads.
            transform={`rotate(-90 ${RING / 2} ${RING / 2})`}
          />
        ) : (
          // Nothing reported: a filled hub marks the middle, so the empty ring
          // reads as a gauge at rest rather than a circle that failed to load.
          <Circle cx={RING / 2} cy={RING / 2} r={2} fill={color.ink3} />
        )}
      </Svg>
    </Tap>
  )
}