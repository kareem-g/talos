/**
 * Toasts — the app's one transient message channel.
 *
 * WHY A TOAST LAYER AT ALL
 * ------------------------
 * Before this, the app reported the outcome of an action in three different
 * ways depending on which screen you were on: a green line of text under a
 * card, a `Modal.alert`, and a pill that slid in from nowhere. None of them
 * were consistent, two of them covered the content they were talking about, and
 * none of them could offer an *undo*.
 *
 * A toast fixes all three. It is anchored to the top of the viewport so it
 * never covers the composer or the button the user is about to press again,
 * it carries a tone so the outcome is legible without reading, and it can hold
 * an action — which is what turns a destructive tap from "are you sure?" into
 * "no you're not, undo that".
 *
 * A store rather than a context: toasts are raised from store actions, socket
 * frames and non-React code paths. Threading a provider through every one of
 * those to reach a setter is how toast layers end up unused.
 */

import * as React from 'react'
import {Animated, PanResponder, Pressable, View} from 'react-native'
import { Text } from '@app/components/Text'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { X } from 'lucide-react-native'

import {
  duration,
  palette,
  radius,
  shadowFloating,
  spring,
  toneBorder,
  toneColor,
  type Tone,
} from '../design/tokens'
import { EASE_OUT } from './motion'
import { haptic } from './ui'

export interface ToastAction {
  label: string
  onPress: () => void
}

export interface ToastSpec {
  id?: string
  message: string
  detail?: string
  tone?: Tone
  /** Milliseconds. `0` means it stays until dismissed or replaced. */
  duration?: number
  action?: ToastAction
  /** Fires a haptic when it lands. Defaults to matching the tone. */
  haptic?: false | 'light' | 'warn' | 'error' | 'success'
}

interface ToastRecord extends ToastSpec {
  id: string
  tone: Tone
  duration: number
}

type Listener = (toasts: ToastRecord[]) => void

let toasts: ToastRecord[] = []
const listeners = new Set<Listener>()
let counter = 0

function emit() {
  for (const listener of listeners) listener(toasts)
}

/** Raise a toast. Returns its id, so a caller can replace or dismiss it. */
export function toast(spec: ToastSpec): string {
  const id = spec.id ?? `toast-${++counter}`
  const tone = spec.tone ?? 'accent'
  const record: ToastRecord = {
    ...spec,
    id,
    tone,
    duration: spec.duration ?? (spec.action ? 6000 : 3200),
  }
  // Same-id toasts replace, which is what makes "Connecting…" → "Connected"
  // read as one message resolving rather than two messages arriving.
  toasts = [...toasts.filter((entry) => entry.id !== id), record]
  emit()
  const kind =
    record.haptic === false
      ? false
      : (record.haptic ?? (tone === 'danger' ? 'error' : tone === 'ok' ? 'success' : tone === 'wait' ? 'warn' : 'light'))
  if (kind) void haptic(kind)
  return id
}

export function dismissToast(id: string): void {
  const next = toasts.filter((entry) => entry.id !== id)
  if (next.length === toasts.length) return
  toasts = next
  emit()
}

export function clearToasts(): void {
  if (toasts.length === 0) return
  toasts = []
  emit()
}

function subscribe(listener: Listener) {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

function getSnapshot() {
  return toasts
}

/** Read the live toast list. Rarely needed — the host renders it. */
export function useToasts(): ToastRecord[] {
  return React.useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

/* ── Host ────────────────────────────────────────────────────────────────────
 * Mounted once, at the root, above the navigator. It renders every live toast
 * as an absolutely-positioned card, so a toast can appear over a sheet, over a
 * dialog, and over a pushed screen without any of them knowing. */

const MAX_VISIBLE = 3

export function ToastHost() {
  const insets = useSafeAreaInsets()
  const items = useToasts()
  if (items.length === 0) return null
  return (
    <View
      pointerEvents="box-none"
      style={{ position: 'absolute', left: 0, right: 0, top: insets.top + 8 }}
    >
      {items.slice(-MAX_VISIBLE).map((entry, index) => (
        <ToastCard
          key={entry.id}
          record={entry}
          // Newest on top: the message you just caused is the one you read.
          offset={items.length - 1 - index}
        />
      ))}
    </View>
  )
}

function ToastCard({ record, offset }: { record: ToastRecord; offset: number }) {
  const dismiss = React.useCallback(() => dismissToast(record.id), [record.id])
  const [leaving, setLeaving] = React.useState(false)

  const progress = React.useRef(new Animated.Value(0)).current
  const drag = React.useRef(new Animated.Value(0)).current

  React.useEffect(() => {
    Animated.spring(progress, { toValue: 1, useNativeDriver: true, ...spring.overlay }).start()
    if (record.duration <= 0) return
    const timer = setTimeout(dismiss, record.duration)
    return () => clearTimeout(timer)
  }, [dismiss, progress, record.duration])

  const close = React.useCallback(
    (velocity = 0) => {
      if (leaving) return
      setLeaving(true)
      Animated.parallel([
        Animated.timing(progress, { toValue: 0, duration: duration.fast, easing: EASE_OUT, useNativeDriver: true }),
        Animated.timing(drag, { toValue: -120, duration: duration.fast, useNativeDriver: true }),
      ]).start(() => dismiss())
      void velocity
    },
    [dismiss, drag, leaving, progress],
  )

  // Drag up to dismiss. A toast you cannot get rid of is a toast you now have
  // to read, and some of these cover the header.
  const pan = React.useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_e, gesture) => Math.abs(gesture.dy) > 6,
        onPanResponderMove: (_e, gesture) => {
          if (gesture.dy < 0) drag.setValue(gesture.dy)
        },
        onPanResponderRelease: (_e, gesture) => {
          if (gesture.dy < -24 || gesture.vy < -0.6) {
            close(gesture.vy)
            return
          }
          Animated.spring(drag, { toValue: 0, useNativeDriver: true, ...spring.snappy }).start()
        },
      }),
    [close, drag],
  )

  const accent = toneColor[record.tone]

  return (
    <Animated.View
      {...pan.panHandlers}
      accessibilityLiveRegion="polite"
      style={[
        {
          marginHorizontal: 12,
          marginBottom: 8,
          borderRadius: radius.lg,
          backgroundColor: palette.raised,
          borderWidth: 1,
          borderColor: toneBorder[record.tone],
          // A tone stripe rather than a tinted fill: a full-colour wash at this
          // size fights the text, and the stripe survives on any surface.
          borderLeftWidth: 3,
          borderLeftColor: accent,
          ...shadowFloating,
          transform: [
            { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [-24, offset * 6] }) },
            { translateY: drag },
            { scale: progress.interpolate({ inputRange: [0, 1], outputRange: [0.96, 1] }) },
          ],
          opacity: progress,
        },
      ]}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12, paddingLeft: 13, paddingRight: 8, paddingVertical: 11 }}>
        <View style={{ flex: 1, gap: 2 }}>
          <Text style={{ color: palette.ink, fontSize: 14, fontWeight: '600', letterSpacing: -0.1 }} numberOfLines={2}>
            {record.message}
          </Text>
          {record.detail ? (
            <Text style={{ color: palette.ink3, fontSize: 12.5, lineHeight: 17 }} numberOfLines={3}>
              {record.detail}
            </Text>
          ) : null}
        </View>

        {record.action ? (
          <Pressable
            accessibilityRole="button"
            accessibilityLabel={record.action.label}
            onPress={() => {
              record.action?.onPress()
              close()
            }}
            hitSlop={10}
            style={({ pressed }) => ({
              paddingHorizontal: 12,
              paddingVertical: 8,
              borderRadius: radius.sm,
              backgroundColor: palette.accent,
              opacity: pressed ? 0.8 : 1,
            })}
          >
            <Text style={{ color: palette.accentInk, fontSize: 12.5, fontWeight: '700' }}>
              {record.action.label}
            </Text>
          </Pressable>
        ) : null}

        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Dismiss notification"
          onPress={() => close()}
          hitSlop={10}
          style={({ pressed }) => ({ padding: 4, opacity: pressed ? 0.6 : 1 })}
        >
          <X size={15} color={palette.ink3} />
        </Pressable>
      </View>
    </Animated.View>
  )
}
