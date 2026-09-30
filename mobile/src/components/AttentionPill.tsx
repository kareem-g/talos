/**
 * The attention pill.
 *
 * A persistent, floating reminder that something is blocked on the user, and
 * that disappears the moment it is not.
 *
 * WHY IT IS NOT A BANNER
 * ----------------------
 * The desktop's home page has a "Needs you" pill in its sticky header, and it
 * works there because the header is always on screen and nothing scrolls over
 * it. On a phone the user spends their time *in a session*, and the surfaces
 * that are always on screen during a session are the composer and the status
 * pill — both of which are about the session you are in, not about the other
 * four. So the cross-session reminder has to float, and it has to be the only
 * floating thing.
 *
 * WHY IT IS AT THE TOP
 * -------------------
 * The bottom of the screen belongs to the composer and to the thumb. A pill at
 * the bottom sits 40pt above the send button, which is exactly where a thumb
 * is about to be, and every dismissal is a mis-tap. At the top it is out of
 * the thumb's arc, it does not cover the keyboard, and it is in the same
 * reading position as a notification banner — so it is understood without
 * being taught.
 *
 * It animates because appearing and disappearing should not shift the content
 * under the user's finger by surprise.
 */

import * as React from 'react'
import { Animated, Text, View } from 'react-native'
import { BlurView } from 'expo-blur'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { ChevronRight } from 'lucide-react-native'


import { useStore } from '@app/store'
import { useNavigation } from '@react-navigation/native'
import type { NativeStackNavigationProp } from '@react-navigation/native-stack'
import type { RootStackParamList } from '@app/navigation'
import { palette, radius, shadowOverlay, spring } from '@app/design/tokens'
import { Touchable } from '@app/components/motion'
import { Dot, haptic } from '@app/components/ui'

export function AttentionPill() {
  const insets = useSafeAreaInsets()
  const navigation = useNavigation<NativeStackNavigationProp<RootStackParamList>>()
  const sessions = useStore((s) => s.sessions)
  const connection = useStore((s) => s.connection)
  const revisions = useStore((s) => s.revisions)
  const pendingActions = useStore((s) => s.pendingActions)

  // Derived, not stored: a session can become blocked without any pending
  // action being pushed, and a pill that only knew about notifications would
  // sit at zero while a session sat waiting.
  const blocked = React.useMemo(
    () =>
      sessions.filter((session) => {
        if (session.status === 'archived') return false
        if (connection !== 'connected') return false
        return (
          session.status === 'waiting_for_approval' ||
          session.status === 'waiting_for_input' ||
          session.status === 'error'
        )
      }),
    [connection, sessions, revisions],
  )

  const count = Math.max(blocked.length, pendingActions.length)
  const target = blocked[0]
  const targetId = target?.id ?? pendingActions[0]?.session_id
  const targetApprovalId = pendingActions[0]?.id

  const progress = React.useRef(new Animated.Value(0)).current
  const [mounted, setMounted] = React.useState(false)
  const wasVisible = React.useRef(false)

  React.useEffect(() => {
    const shouldShow = count > 0 && Boolean(targetId)
    if (shouldShow && !wasVisible.current) {
      wasVisible.current = true
      setMounted(true)
      progress.setValue(0)
      Animated.spring(progress, { toValue: 1, useNativeDriver: true, ...spring.overlay }).start()
    } else if (!shouldShow && wasVisible.current) {
      wasVisible.current = false
      Animated.timing(progress, { toValue: 0, duration: 200, useNativeDriver: true }).start(({ finished }) => {
        if (finished) setMounted(false)
      })
    }
  }, [count, progress, targetId])

  if (!mounted) return null

  return (
    <Animated.View
      pointerEvents="box-none"
      style={{
        position: 'absolute',
        top: insets.top + 8,
        left: 0,
        right: 0,
        alignItems: 'center',
        opacity: progress,
        transform: [
          { translateY: progress.interpolate({ inputRange: [0, 1], outputRange: [-26, 0] }) },
          { scale: progress.interpolate({ inputRange: [0, 1], outputRange: [0.94, 1] }) },
        ],
      }}
    >
      <Touchable
        accessibilityRole="button"
        accessibilityLabel={`${count} ${count === 1 ? 'session needs' : 'sessions need'} you. Opens ${target?.name ?? 'the next one'}.`}
        onPress={() => {
          void haptic('medium')
          if (targetId) navigation.push('Session', { sessionId: targetId, approvalId: targetApprovalId })
        }}
        scaleTo={0.96}
        style={{ maxWidth: '92%' }}
      >
        {/* The one surface in the app allowed to cast a full overlay shadow:
            this pill genuinely floats over whatever session is behind it. */}
        <View style={[{ borderRadius: radius.pill }, shadowOverlay]}>
          <View
            style={{
              overflow: 'hidden',
              borderRadius: radius.pill,
              borderWidth: 1,
              borderColor: palette.lineStrong,
              backgroundColor: `${palette.chrome}E6`,
            }}
          >
            <BlurView intensity={60} tint="dark" style={StyleSheetAbsoluteFill} />
            <View
              style={{
                flexDirection: 'row',
                alignItems: 'center',
                gap: 8,
                paddingLeft: 14,
                paddingRight: 10,
                paddingVertical: 9,
              }}
            >
              {/* `wait` is the token that means "a human is blocking the run" —
                  and the word beside it keeps the state from being colour
                  alone. */}
              <Dot tone="wait" />
              <Text className="shrink-0 text-[13px] leading-[18px] font-semibold text-ink" numberOfLines={1}>
                {count} {count === 1 ? 'needs' : 'need'} you
              </Text>
              {target ? (
                <>
                  <Text className="shrink-0 text-[13px] leading-[18px] text-ink-4">·</Text>
                  <Text className="min-w-0 shrink text-[13px] leading-[18px] text-ink-2" numberOfLines={1}>
                    {target.name}
                  </Text>
                </>
              ) : null}
              <ChevronRight size={15} color={palette.ink3} />
            </View>
          </View>
        </View>
      </Touchable>
    </Animated.View>
  )
}

const StyleSheetAbsoluteFill = {
  position: 'absolute' as const,
  left: 0,
  right: 0,
  top: 0,
  bottom: 0,
}
