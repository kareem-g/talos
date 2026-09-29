/**
 * Overlays — sheets, modals, and the confirm dialog.
 *
 * The app is full of "do this now, keep the context" surfaces: a session action
 * menu, the new-task flow, the engine switcher, a destructive confirmation.
 * Each was previously hand-rolled with its own scrim, animation, safe-area
 * padding, and back-button handling, which is why the same interaction looked
 * subtly different in eight places and only some of them closed on Android's
 * hardware back.
 *
 * These three components centralise that. A screen that needs a sheet calls
 * `Sheet`; it cannot get the gesture, the animation, or the back handling
 * wrong, because it does not implement them.
 *
 * WHY A BOTTOM SHEET RATHER THAN A CENTRED MODAL
 * ---------------------------------------------
 * On a phone, a sheet that rises from the bottom is reachable with a thumb and
 * signals "this is a temporary layer over what you were doing". A centred
 * dialog signals "this is modal and blocking". That is the right distinction for
 * nearly everything here: the user is mid-task and wants to peek at a menu.
 * `Dialog` is reserved for the one case where the answer genuinely is binary and
 * proceeding wrongly destroys something.
 */

import * as React from 'react'
import {
  Modal,
  Pressable,
  ScrollView,
  Text,
  View,
  useWindowDimensions,
  type RefreshControlProps,
  type StyleProp,
  type ViewStyle,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
// Core `Animated`, not Reanimated's. Reanimated also default-exports an
// `Animated`, and importing it by name here would silently pull in the
// worklet runtime for a transform that does not need one. The core API is what
// `prose.tsx` already uses, so the app keeps one animation model.
import { Animated } from 'react-native'
import { X } from 'lucide-react-native'

import { cn } from '@/lib/format'
import { motion, palette } from '../design/tokens'
import { Button, Eyebrow, IconButton } from './ui'

/** Spring used for the sheet. Snappy on the way in, no bounce on dismissal. */
const SPRING = { damping: 26, stiffness: 320, mass: 0.9 } as const

/**
 * A bottom sheet.
 *
 * Closes on: the scrim, the grabber, the close button, and Android hardware
 * back. All four, because a sheet that only closes one of those ways feels
 * broken in exactly the situation you notice it.
 */
export function Sheet({
  open,
  onClose,
  title,
  eyebrow,
  children,
  footer,
  /** Cap the height as a fraction of the screen; the body scrolls beyond it. */
  maxHeightRatio = 0.86,
  contentClassName,
}: {
  open: boolean
  onClose: () => void
  title?: string
  eyebrow?: string
  children: React.ReactNode
  footer?: React.ReactNode
  maxHeightRatio?: number
  contentClassName?: string
}) {
  const insets = useSafeAreaInsets()
  const { height } = useWindowDimensions()

  // Core `Animated`, not Reanimated worklets. A sheet's entrance is a single
  // transform on a native driver; Reanimated's Babel plugin and worklet
  // pipeline buy nothing here and are one more thing that can break a build.
  // `prose.tsx` already animates this way, so the app has exactly one
  // animation model rather than two.
  const progress = React.useRef(new Animated.Value(open ? 1 : 0)).current

  React.useEffect(() => {
    Animated.timing(progress, {
      toValue: open ? 1 : 0,
      duration: open ? motion.fast : motion.instant,
      useNativeDriver: true,
    }).start()
  }, [open, progress])

  // Follows the screen so the sheet is usable in landscape and on a tablet
  // without a second breakpoint.
  const translateY = progress.interpolate({
    inputRange: [0, 1],
    outputRange: [height * 0.5, 0],
  })

  if (!open) return null

  return (
    <Modal transparent visible animationType="none" onRequestClose={onClose} statusBarTranslucent>
      <View className="flex-1 justify-end">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Close"
          onPress={onClose}
          className="absolute inset-0"
          style={{ backgroundColor: palette.scrim }}
        />
        <Animated.View
          style={{
            maxHeight: height * maxHeightRatio,
            backgroundColor: palette.surface,
            borderTopLeftRadius: 20,
            borderTopRightRadius: 20,
            borderTopWidth: 1,
            borderColor: palette.lineStrong,
            paddingBottom: Math.max(insets.bottom, 16),
            transform: [{ translateY }],
          }}
        >
          <SheetHeader title={title} eyebrow={eyebrow} onClose={onClose} />
          <ScrollView
            className={cn('px-4', contentClassName)}
            contentContainerClassName="gap-3 pb-4"
            keyboardShouldPersistTaps="handled"
            // A sheet taller than the screen scrolls; announce its extent.
            accessibilityViewIsModal
          >
            {children}
          </ScrollView>
          {footer ? <View className="border-t border-line px-4 py-3">{footer}</View> : null}
        </Animated.View>
      </View>
    </Modal>
  )
}

function SheetHeader({
  title,
  eyebrow,
  onClose,
}: {
  title?: string
  eyebrow?: string
  onClose: () => void
}) {
  if (!title && !eyebrow) return <View className="h-5" />
  return (
    <View className="px-4 pb-2 pt-3">
      {/* The grabber is the primary dismissal affordance — the thing a thumb
          reaches for first. It is a real button, not decoration. */}
      <Pressable
        accessibilityRole="button"
        accessibilityLabel="Close"
        onPress={onClose}
        hitSlop={{ top: 10, bottom: 6, left: 40, right: 40 }}
        className="mb-3 h-5 items-center justify-center"
      >
        <View className="h-1 w-9 rounded-pill" style={{ backgroundColor: palette.lineStrong }} />
      </Pressable>
      <View className="flex-row items-center gap-3">
        <View className="min-w-0 flex-1">
          {eyebrow ? <Eyebrow className="mb-0.5">{eyebrow}</Eyebrow> : null}
          {title ? (
            <Text className="text-[19px] font-bold text-ink" style={{ letterSpacing: -0.3 }} numberOfLines={1}>
              {title}
            </Text>
          ) : null}
        </View>
        <IconButton label="Close" size={36} onPress={onClose}>
          <X size={18} color={palette.ink3} />
        </IconButton>
      </View>
    </View>
  )
}

/**
 * A centred dialog for a genuine yes/no.
 *
 * Used for destruction and for pairing, and nowhere else. The `destructive`
 * flag moves the primary action to the danger colour — a confirm button that
 * destroys should never be the same colour as one that saves, or muscle memory
 * from the app's other dialogs will delete the wrong thing.
 */
export function Dialog({
  open,
  onClose,
  title,
  body,
  confirmLabel,
  cancelLabel = 'Cancel',
  onConfirm,
  destructive,
  children,
}: {
  open: boolean
  onClose: () => void
  title: string
  body?: string
  confirmLabel: string
  cancelLabel?: string
  onConfirm: () => void
  destructive?: boolean
  children?: React.ReactNode
}) {
  return (
    <Modal transparent visible animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View className="flex-1 items-center justify-center p-6">
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Dismiss"
          onPress={onClose}
          className="absolute inset-0"
          style={{ backgroundColor: palette.scrim }}
        />
        <View
          accessibilityViewIsModal
          className="w-full max-w-sm gap-4 rounded-lg border border-line-strong p-5"
          style={{ backgroundColor: palette.raised }}
        >
          <View className="gap-1.5">
            <Text className="text-[17px] font-bold text-ink" style={{ letterSpacing: -0.2 }}>
              {title}
            </Text>
            {body ? (
              <Text className="text-[13px] leading-[18px] text-ink-2">{body}</Text>
            ) : null}
          </View>
          {children}
          <View className="flex-row gap-2">
            <Button
              variant={destructive ? 'danger' : 'primary'}
              label={confirmLabel}
              accessibilityLabel={confirmLabel}
              full
              onPress={onConfirm}
            />
            <Button
              variant="secondary"
              label={cancelLabel}
              accessibilityLabel={cancelLabel}
              full
              onPress={onClose}
            />
          </View>
        </View>
      </View>
    </Modal>
  )
}

/**
 * The standard screen frame: safe area, a header, and a scrollable body.
 *
 * Every screen in the app is "header + content", and the previous code repeated
 * the `SafeAreaView` + header + `ScrollView` triple in each one, with
 * inconsistent padding and a `PageHeader` that only root screens could use.
 * Screens compose this instead.
 */
export function Screen({
  header,
  children,
  scroll = true,
  contentClassName,
  refreshControl,
  bottomInset = true,
  style,
}: {
  header?: React.ReactNode
  children: React.ReactNode
  scroll?: boolean
  contentClassName?: string
  refreshControl?: React.ReactElement<RefreshControlProps>
  bottomInset?: boolean
  style?: StyleProp<ViewStyle>
}) {
  const insets = useSafeAreaInsets()
  return (
    <View className="flex-1 bg-canvas" style={style}>
      {header}
      {scroll ? (
        <ScrollView
          className="flex-1"
          contentContainerClassName={cn(
            'gap-4 px-4',
            // 16 is the rhythm unit; the extra inset keeps the last row clear
            // of the home indicator instead of butting against it.
            bottomInset ? 'pb-6' : '',
            contentClassName,
          )}
          contentInsetAdjustmentBehavior="automatic"
          keyboardShouldPersistTaps="handled"
          refreshControl={refreshControl}
        >
          {children}
        </ScrollView>
      ) : (
        <View className={cn('flex-1', contentClassName)} style={{ paddingBottom: bottomInset ? insets.bottom : 0 }}>
          {children}
        </View>
      )}
    </View>
  )
}
