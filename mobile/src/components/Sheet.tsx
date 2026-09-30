/**
 * Overlays — deck sheets, dialogs, action menus, pickers, confirmations.
 *
 * QAI SIGNAL DECK — how panes open.
 * ---------------------------------
 * Bottom sheets rise on a spring and dismiss down with velocity-projected
 * flick; pushed workbenches slide from the right; reference lookups rise from
 * the bottom. Every sheet carries the deck grammar: dense scrim, quiet
 * grabber, signal tick beside its eyebrow, cut 18pt top corners, hairline
 * edge — elevation by lift, not by glow. One implementation, so no screen
 * gets the gesture, animation, safe area, or back handling wrong.
 */

import * as React from 'react'
import {
  Animated,
  KeyboardAvoidingView,
  Modal,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  Text,
  TextInput,
  View,
  useWindowDimensions,
  type StyleProp,
  type ViewStyle,
} from 'react-native'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { Check, ChevronDown, Search as SearchIcon, X } from 'lucide-react-native'

import { cn } from '@/lib/format'
import { DISMISS_VELOCITY, duration, palette, radius, spring, toneColor } from '../design/tokens'
import { EASE_OUT, popStyle } from './motion'
import { Button, Eyebrow, IconButton, SearchField, haptic, shadowOverlay } from './ui'

/* ── The bottom sheet ────────────────────────────────────────────────────────────
 * Position model: the panel is always `screenHeight` tall and lives *below* the
 * screen, so `translateY` is a single value that means "how much of the panel
 * is still hidden". Closed is `screenHeight`; a half-detent sheet rests at
 * `screenHeight * (1 - 0.5)`; a content-sized sheet rests at `0`.
 *
 * That model is what makes drag, detents and dismissal the same maths: a
 * gesture only has to change one number, and every visual falls out of it. */

export interface SheetProps {
  open: boolean
  onClose: () => void
  title?: string
  eyebrow?: string
  children: React.ReactNode
  footer?: React.ReactNode
  /**
   * Fractions of the screen, ascending. Omit for a content-sized sheet that
   * fits its own body. With snap points, the sheet opens at the first and can
   * be pulled between them.
   */
  snapPoints?: number[]
  /** Index the sheet opens at. Defaults to the first snap point. */
  defaultSnap?: number
  /** Maximum height as a fraction of the screen for a content-sized sheet. */
  maxHeightRatio?: number
  /** Skip the grabber — for a sheet that is a full screen and has its own header. */
  hideGrabber?: boolean
  contentClassName?: string
  /** Fired when the sheet settles on a detent. */
  onSnapChange?: (index: number) => void
  style?: StyleProp<ViewStyle>
}

export function Sheet({
  open,
  onClose,
  title,
  eyebrow,
  children,
  footer,
  snapPoints,
  defaultSnap,
  maxHeightRatio = 0.92,
  hideGrabber,
  contentClassName,
  onSnapChange,
  style,
}: SheetProps) {
  const insets = useSafeAreaInsets()
  const { height: screenHeight } = useWindowDimensions()

  const [mounted, setMounted] = React.useState(open)
  const [contentHeight, setContentHeight] = React.useState(0)
  const [snapIndex, setSnapIndex] = React.useState(defaultSnap ?? 0)

  /** `0` = fully closed, `1` = resting at the current detent. */
  const progress = React.useRef(new Animated.Value(0)).current
  /** Live pixel offset, written by the drag gesture. */
  const drag = React.useRef(new Animated.Value(0)).current
  const settle = React.useRef(new Animated.Value(0)).current

  const detents = React.useMemo(
    () => (snapPoints && snapPoints.length > 0 ? snapPoints.map((ratio) => Math.round(ratio * screenHeight)) : null),
    [snapPoints, screenHeight],
  )

  // Content-sized sheets fit their body; a detent sheet always fills the screen
  // so it can rest at any point along it.
  const naturalHeight = React.useMemo(() => {
    const chrome = (title || eyebrow ? 62 : 0) + (footer ? 68 : 0) + (hideGrabber ? 0 : 24)
    if (detents) return screenHeight
    return Math.min(contentHeight + chrome, screenHeight * maxHeightRatio)
  }, [contentHeight, detents, footer, hideGrabber, maxHeightRatio, screenHeight, title, eyebrow])

  /** translateY (px from the top of the screen) for each state. */
  const offsetFor = React.useCallback(
    (index: number) => (detents ? screenHeight - detents[index] : 0),
    [detents, screenHeight],
  )
  const closedOffset = screenHeight

  const settleTo = React.useCallback(
    (index: number, velocity = 0) => {
      setSnapIndex(index)
      onSnapChange?.(index)
      const target = offsetFor(index)
      const goingUp = velocity < 0
      Animated.spring(settle, {
        toValue: target,
        velocity,
        useNativeDriver: true,
        // Arriving fast, leaving faster: a dismissal the user committed to
        // should not make them wait for the object to finish settling.
        ...(goingUp ? spring.overlay : spring.dismiss),
      }).start()
    },
    [offsetFor, onSnapChange, settle],
  )

  // Enter / exit. `mounted` is held one extra beat so the exit animation is
  // visible — unmounting on close would make every dismissal instantaneous.
  React.useEffect(() => {
    if (open) {
      setMounted(true)
      drag.setValue(0)
      const index = defaultSnap ?? 0
      setSnapIndex(index)
      progress.setValue(0)
      Animated.timing(progress, {
        toValue: 1,
        duration: duration.normal,
        easing: EASE_OUT,
        useNativeDriver: true,
      }).start()
      // `settle` starts at the closed offset and springs up to the detent, so
      // the sheet is thrown into place rather than eased.
      settle.setValue(closedOffset)
      Animated.spring(settle, { toValue: offsetFor(index), useNativeDriver: true, ...spring.overlay }).start()
    } else {
      Animated.parallel([
        Animated.timing(progress, { toValue: 0, duration: duration.fast, easing: EASE_OUT, useNativeDriver: true }),
        Animated.spring(settle, { toValue: closedOffset, useNativeDriver: true, ...spring.dismiss }),
      ]).start(({ finished }) => {
        if (finished) setMounted(false)
      })
    }
    // `naturalHeight` and `offsetFor` are stable for a given screen size.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, defaultSnap, progress, settle, drag, closedOffset, offsetFor])

  const baseRest = detents ? offsetFor(snapIndex) : 0

  // The drag gesture. Only the grabber and the header are draggable, never the
  // body: a sheet you can flick by grabbing a list item inside it is a sheet
  // that closes when you meant to scroll.
  const pan = React.useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_e, gesture) => gesture.dy > 4,
        onPanResponderMove: (_e, gesture) => {
          // Down is free. Up is rubber-banded at 1/4 resistance, because a
          // sheet pulled above its tallest detent should feel like a limit,
          // not like it is stuck.
          const overshoot = gesture.dy < 0 ? gesture.dy / 4 : gesture.dy
          settle.setValue(baseRest + overshoot)
        },
        onPanResponderRelease: (_e, gesture) => {
          const current = baseRest + (gesture.dy < 0 ? gesture.dy / 4 : gesture.dy)
          const travelled = current - baseRest
          const flick = gesture.vy > DISMISS_VELOCITY / 1000
          const far = travelled > naturalHeight * 0.28

          if ((flick && travelled > 0) || far) {
            void haptic('light')
            onClose()
            return
          }
          if (!detents) {
            Animated.spring(settle, { toValue: 0, velocity: gesture.vy, useNativeDriver: true, ...spring.overlay }).start()
            return
          }
          // Project where the sheet would come to rest, then snap to the
          // nearest detent — a small flick up lands on the next one, it does
          // not have to be dragged all the way.
          const projected = current + gesture.vy * 90
          let best = 0
          let bestDistance = Infinity
          for (let index = 0; index < detents.length; index++) {
            const distance = Math.abs(screenHeight - detents[index] - projected)
            if (distance < bestDistance) {
              bestDistance = distance
              best = index
            }
          }
          if (gesture.vy < -0.4) best = Math.min(detents.length - 1, best + 1)
          if (gesture.vy > 0.4) best = Math.max(0, best - 1)
          settleTo(best, gesture.vy)
        },
        onPanResponderTerminate: () => settleTo(snapIndex),
      }),
    [baseRest, detents, naturalHeight, onClose, screenHeight, settle, settleTo],
  )

  if (!mounted) return null

  const scrimOpacity = progress.interpolate({ inputRange: [0, 1], outputRange: [0, 1] })

  return (
    <Modal
      transparent
      visible={mounted}
      animationType="none"
      onRequestClose={onClose}
      statusBarTranslucent
      supportedOrientations={['portrait', 'landscape']}
    >
      <View style={{ flex: 1, justifyContent: 'flex-end' }}>
        <Animated.View style={[StyleSheetAbsoluteFill, { backgroundColor: palette.scrim, opacity: scrimOpacity }]}>
          <Pressable
            accessibilityRole="button"
            accessibilityLabel="Close"
            onPress={onClose}
            style={{ flex: 1 }}
          />
        </Animated.View>

        <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
          <Animated.View
            {...pan.panHandlers}
            accessibilityViewIsModal
            style={[
              {
                height: naturalHeight,
                borderTopLeftRadius: radius.xl,
                borderTopRightRadius: radius.xl,
                borderTopWidth: 1,
                borderColor: palette.lineStrong,
                backgroundColor: palette.surface,
                overflow: 'hidden',
                transform: [{ translateY: Animated.add(settle, drag) }],
              },
              shadowOverlay,
              style,
            ]}
          >
            {/* Signal edge: a hairline of accent says "this surface is live
                above the deck" without shouting. */}
            <View style={{ height: 2, backgroundColor: palette.accent, opacity: 0.55 }} />
            {/* The grabber is the primary dismissal affordance — quiet by
                design; the flick and the scrim teach the rest. */}
            {hideGrabber ? null : (
              <View {...pan.panHandlers} style={{ height: 24, alignItems: 'center', justifyContent: 'center' }}>
                <View
                  style={{
                    width: 36,
                    height: 4,
                    borderRadius: 2,
                    backgroundColor: palette.ink4,
                  }}
                />
              </View>
            )}

            {title || eyebrow ? (
              <View
                {...pan.panHandlers}
                className="flex-row items-center gap-3 border-b border-line px-4 pb-3 pt-1"
              >
                <View style={{ width: 2, height: 17, borderRadius: 1, backgroundColor: palette.accent }} />
                <View className="min-w-0 flex-1">
                  {eyebrow ? <Eyebrow className="mb-1">{eyebrow}</Eyebrow> : null}
                  <Text
                    className="text-[18px] leading-[24px] font-bold text-ink"
                    style={{ letterSpacing: -0.35 }}
                    numberOfLines={1}
                  >
                    {title}
                  </Text>
                </View>
                {/* Only useful when there is a detent to go to. */}
                {detents && detents.length > 1 ? (
                  <IconButton
                    label={snapIndex === detents.length - 1 ? 'Collapse sheet' : 'Expand sheet'}
                    size={36}
                    onPress={() => settleTo(snapIndex === detents.length - 1 ? 0 : detents.length - 1)}
                  >
                    <ChevronDown
                      size={19}
                      color={palette.ink2}
                      style={{
                        transform: [{ rotate: snapIndex === detents.length - 1 ? '180deg' : '0deg' }],
                      }}
                    />
                  </IconButton>
                ) : null}
                <IconButton label="Close" size={36} onPress={onClose}>
                  <X size={18} color={palette.ink3} />
                </IconButton>
              </View>
            ) : null}

            <ScrollView
              className={cn('flex-1', contentClassName)}
              contentContainerClassName="gap-3 px-4 pb-4 pt-3"
              keyboardShouldPersistTaps="handled"
              keyboardDismissMode="on-drag"
              showsVerticalScrollIndicator={false}
              onContentSizeChange={(_width, height) => {
                // Only a content-sized sheet needs to measure itself; a detent
                // sheet already fills the screen. The *content* size is the
                // number that matters: measuring the ScrollView's own frame
                // was circular — the frame is derived from the sheet height,
                // which is derived from this measurement — and content-sized
                // sheets collapsed to a header and a sliver of body.
                if (detents) return
                setContentHeight((current) => (Math.abs(current - height) < 1 ? current : height))
              }}
            >
              {children}
            </ScrollView>

            {footer ? (
              <View
                style={{
                  borderTopWidth: 1,
                  borderTopColor: palette.line,
                  paddingHorizontal: 16,
                  paddingTop: 12,
                  paddingBottom: Math.max(insets.bottom, 12),
                }}
              >
                {footer}
              </View>
            ) : (
              <View style={{ height: Math.max(insets.bottom, 12) }} />
            )}
          </Animated.View>
        </KeyboardAvoidingView>
      </View>
    </Modal>
  )
}

const StyleSheetAbsoluteFill = {
  position: 'absolute' as const,
  left: 0,
  right: 0,
  top: 0,
  bottom: 0,
}

/* ── Dialog ──────────────────────────────────────────────────────────────────────
 * A centred dialog for a genuine yes/no. Used for destruction and for pairing
 * and nowhere else. */

export function Dialog({
  open,
  onClose,
  title,
  body,
  confirmLabel,
  cancelLabel = 'Cancel',
  onConfirm,
  destructive,
  busy,
  children,
  icon,
}: {
  open: boolean
  onClose: () => void
  title: string
  body?: string
  confirmLabel: string
  cancelLabel?: string
  onConfirm: () => void
  destructive?: boolean
  busy?: boolean
  children?: React.ReactNode
  icon?: React.ReactNode
}) {
  const insets = useSafeAreaInsets()
  const [mounted, setMounted] = React.useState(open)
  const progress = React.useRef(new Animated.Value(open ? 1 : 0)).current

  React.useEffect(() => {
    if (open) {
      setMounted(true)
      progress.setValue(0)
      Animated.spring(progress, { toValue: 1, useNativeDriver: true, ...spring.overlay }).start()
    } else {
      Animated.timing(progress, { toValue: 0, duration: duration.fast, easing: EASE_OUT, useNativeDriver: true }).start(
        ({ finished }) => {
          if (finished) setMounted(false)
        },
      )
    }
  }, [open, progress])

  if (!mounted) return null

  return (
    <Modal
      transparent
      visible={mounted}
      animationType="none"
      onRequestClose={onClose}
      statusBarTranslucent
      supportedOrientations={['portrait', 'landscape']}
    >
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', padding: 28 }}>
        <Animated.View style={[StyleSheetAbsoluteFill, { backgroundColor: palette.scrim, opacity: progress }]}>
          <Pressable accessibilityRole="button" accessibilityLabel="Dismiss" onPress={onClose} style={{ flex: 1 }} />
        </Animated.View>

        <Animated.View
          accessibilityViewIsModal
          accessibilityRole="alert"
          style={[
            {
              width: '100%',
              maxWidth: 380,
              borderRadius: radius.xl,
              borderWidth: 1,
              borderColor: destructive ? palette.dangerBorder : palette.lineStrong,
              backgroundColor: palette.raised,
              padding: 20,
              paddingBottom: 20 + insets.bottom * 0.2,
              gap: 16,
            },
            popStyle(progress, 0.92),
            shadowOverlay,
          ]}
        >
          {icon ? (
            <View
              style={{
                width: 40,
                height: 40,
                borderRadius: radius.md,
                alignItems: 'center',
                justifyContent: 'center',
                backgroundColor: destructive ? palette.dangerSoft : palette.accentSoft,
              }}
            >
              {icon}
            </View>
          ) : null}
          <View style={{ gap: 6 }}>
            <Text className="text-[19px] font-bold text-ink" style={{ letterSpacing: -0.3 }}>
              {title}
            </Text>
            {body ? (
              <Text className="text-[14px] leading-[20px] text-ink-2">{body}</Text>
            ) : null}
          </View>
          {children}
          <View style={{ flexDirection: 'row', gap: 10 }}>
            <Button
              variant="secondary"
              label={cancelLabel}
              onPress={onClose}
              full
              style={{ flex: 1 }}
              accessibilityLabel={cancelLabel}
            />
            <Button
              variant={destructive ? 'danger' : 'primary'}
              label={busy ? 'Working…' : confirmLabel}
              onPress={onConfirm}
              disabled={busy}
              full
              style={{ flex: 1 }}
            />
          </View>
        </Animated.View>
      </View>
    </Modal>
  )
}

/**
 * The confirmation used for anything destructive.
 *
 * `destructive` moves the confirm button to the danger colour and reverses the
 * button order so the safe choice is the one under the thumb. A confirm button
 * that destroys must never look like one that saves, or muscle memory from the
 * app's other dialogs deletes the wrong thing.
 */
export function ConfirmDialog({
  open,
  onClose,
  onConfirm,
  title,
  body,
  confirmLabel = 'Delete',
  busy,
}: {
  open: boolean
  onClose: () => void
  onConfirm: () => void
  title: string
  body?: string
  confirmLabel?: string
  busy?: boolean
}) {
  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={title}
      body={body}
      confirmLabel={confirmLabel}
      onConfirm={onConfirm}
      destructive
      busy={busy}
    />
  )
}

/* ── Action sheet ─────────────────────────────────────────────────────────────────
 * The phone's answer to a desktop's hover menu. Every destructive or
 * navigational action in the app goes through this so there is exactly one
 * place an action list looks and behaves. */

export interface SheetActionSpec {
  label: string
  hint?: string
  icon?: React.ReactNode
  tone?: 'default' | 'danger'
  disabled?: boolean
  onPress: () => void
}

export function ActionSheet({
  open,
  onClose,
  onDismiss,
  title,
  eyebrow,
  message,
  actions,
  cancelLabel = 'Cancel',
}: {
  open: boolean
  onClose: () => void
  /**
   * Fired *after* the sheet has finished animating out.
   *
   * This exists so an action that opens another surface — a picker, a form, a
   * screen — can wait for the sheet to be gone before presenting. Opening a
   * second sheet while the first is still on screen produces two modals stacked
   * on one another, and iOS does not present a modal on top of a modal.
   */
  onDismiss?: () => void
  title?: string
  eyebrow?: string
  message?: string
  actions: SheetActionSpec[]
  cancelLabel?: string
}) {
  const insets = useSafeAreaInsets()
  return (
    <Sheet
      open={open}
      onClose={() => {
        onClose()
        // 260ms is the sheet's exit spring; a frame after that is the earliest
        // the presenting view controller is free.
        if (onDismiss) setTimeout(onDismiss, 260)
      }}
      title={title}
      eyebrow={eyebrow}
      hideGrabber
    >
      {message ? (
        <Text className="pb-1 text-[13px] leading-[18px] text-ink-2">{message}</Text>
      ) : null}
      <View style={{ marginHorizontal: -16 }}>
        {actions.map((action) => (
          <Pressable
            key={action.label}
            accessibilityRole="button"
            accessibilityLabel={action.label}
            accessibilityHint={action.hint}
            accessibilityState={{ disabled: !!action.disabled }}
            disabled={action.disabled}
            onPress={() => {
              void haptic(action.tone === 'danger' ? 'warn' : 'light')
              action.onPress()
              onClose()
            }}
            className="min-h-14 flex-row items-center gap-3.5 px-4 active:bg-raised"
            style={{ opacity: action.disabled ? 0.4 : 1 }}
          >
            {action.icon}
            <View className="min-w-0 flex-1">
              <Text
                className="text-[14.5px] font-medium"
                style={{ color: action.tone === 'danger' ? palette.danger : palette.ink }}
              >
                {action.label}
              </Text>
              {action.hint ? (
                <Text className="mt-0.5 text-[12px] leading-[16px] text-ink-3" numberOfLines={2}>
                  {action.hint}
                </Text>
              ) : null}
            </View>
          </Pressable>
        ))}
      </View>
      <View style={{ height: 1, backgroundColor: palette.line, marginTop: 8 }} />
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={cancelLabel}
        onPress={onClose}
        className="min-h-14 items-center justify-center rounded-md active:bg-raised"
        style={{ marginBottom: Math.max(insets.bottom, 0) }}
      >
        <Text className="text-[14.5px] font-semibold text-accent">{cancelLabel}</Text>
      </Pressable>
    </Sheet>
  )
}

/* ── Picker ───────────────────────────────────────────────────────────────────────
 * A searchable single-select. The desktop does this with an anchored dropdown
 * and, for long lists, a filter field; on a phone it is a sheet, because a
 * dropdown that opens upward over a transcript is a dropdown you cannot read.
 *
 * `allowsCustomValue` mirrors the desktop's "any model id this agent accepts",
 * which is how a model dimension stays data-driven. */

export interface PickerOption {
  value: string
  label: string
  hint?: string
  badge?: string
}

export function PickerSheet({
  open,
  onClose,
  title,
  subtitle,
  options,
  value,
  onSelect,
  searchable,
  emptyLabel = 'No options',
  allowsCustomValue,
  customPlaceholder = 'Any value this accepts',
  footer,
}: {
  open: boolean
  onClose: () => void
  title: string
  subtitle?: string
  options: PickerOption[]
  value?: string
  onSelect: (value: string) => void
  /** Auto-enables above eight options, as on the desktop. */
  searchable?: boolean
  emptyLabel?: string
  allowsCustomValue?: boolean
  customPlaceholder?: string
  footer?: React.ReactNode
}) {
  const [query, setQuery] = React.useState('')
  const [custom, setCustom] = React.useState('')

  React.useEffect(() => {
    if (open) {
      setQuery('')
      setCustom('')
    }
  }, [open])

  const wantsSearch = searchable ?? options.length > 8
  const needle = query.trim().toLowerCase()
  const visible = React.useMemo(
    () =>
      needle
        ? options.filter(
            (option) =>
              option.label.toLowerCase().includes(needle) || option.value.toLowerCase().includes(needle),
          )
        : options,
    [needle, options],
  )

  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={title}
      eyebrow={subtitle}
      // Long lists get a detent pair but open at the TALL one: a picker that
      // opens half-height hides the very options the user opened it for, and
      // dragging up is an extra gesture nobody asked for. Drag down to shrink.
      snapPoints={visible.length > 7 ? [0.6, 0.92] : undefined}
      defaultSnap={visible.length > 7 ? 1 : undefined}
      footer={footer}
    >
      {wantsSearch ? (
        <SearchField value={query} onChangeText={setQuery} placeholder={`Filter ${options.length} options`} />
      ) : null}

      <View style={{ gap: 6 }}>
        {visible.length === 0 ? (
          <Text className="px-4 py-6 text-center text-[13px] text-ink-3">{emptyLabel}</Text>
        ) : (
          visible.map((option) => {
            const active = option.value === value
            return (
              <Pressable
                key={option.value}
                accessibilityRole="menuitem"
                accessibilityLabel={option.label}
                accessibilityState={{ selected: active }}
                onPress={() => {
                  void haptic('select')
                  onSelect(option.value)
                  onClose()
                }}
                style={({ pressed }) => ({
                  minHeight: 52,
                  flexDirection: 'row',
                  alignItems: 'center',
                  gap: 12,
                  borderRadius: radius.md,
                  borderWidth: 1,
                  paddingHorizontal: 13,
                  paddingVertical: 10,
                  borderColor: active ? palette.accentBorder : palette.line,
                  backgroundColor: active
                    ? palette.accentSoft
                    : pressed
                      ? palette.raised
                      : palette.surface,
                })}
              >
                {/* Radio ring: the selection state is readable without the
                    colour, and the ring reads as "one of these" at a glance. */}
                <View
                  accessibilityElementsHidden
                  importantForAccessibility="no-hide-descendants"
                  style={{
                    width: 18,
                    height: 18,
                    borderRadius: 9,
                    borderWidth: active ? 5.5 : 1.5,
                    borderColor: active ? palette.accent : palette.lineStrong,
                    backgroundColor: active ? palette.accentInk : 'transparent',
                  }}
                />
                <View className="min-w-0 flex-1">
                  <Text
                    className="text-[15px] leading-[20px]"
                    style={{ color: active ? palette.ink : palette.ink2, fontWeight: active ? '600' : '400' }}
                    numberOfLines={1}
                  >
                    {option.label}
                  </Text>
                  {option.hint ? (
                    <Text className="mt-0.5 text-[12px] leading-[16px] text-ink-3" numberOfLines={1}>
                      {option.hint}
                    </Text>
                  ) : null}
                </View>
                {option.badge ? (
                  <View
                    style={{
                      paddingHorizontal: 6,
                      paddingVertical: 2,
                      borderRadius: radius.xs,
                      borderWidth: 1,
                      borderColor: palette.line,
                    }}
                  >
                    <Text
                      style={{
                        color: palette.ink3,
                        fontSize: 9.5,
                        fontWeight: '700',
                        letterSpacing: 0.6,
                        fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
                      }}
                    >
                      {option.badge}
                    </Text>
                  </View>
                ) : null}
                {active ? <Check size={17} color={palette.accent} strokeWidth={2.6} /> : null}
              </Pressable>
            )
          })
        )}
      </View>

      {allowsCustomValue ? (
        <View style={{ gap: 8, paddingTop: 6, paddingBottom: 4 }}>
          <View style={{ height: 1, backgroundColor: palette.line }} />
          <CustomValueInput value={custom} onChangeText={setCustom} placeholder={customPlaceholder} />
          <Button
            variant="secondary"
            label="Use this value"
            disabled={custom.trim().length === 0}
            onPress={() => {
              onSelect(custom.trim())
              onClose()
            }}
          />
        </View>
      ) : null}
    </Sheet>
  )
}

/** The free-text half of `PickerSheet`, for a dimension that accepts any value. */
function CustomValueInput({
  value,
  onChangeText,
  placeholder,
}: {
  value: string
  onChangeText: (value: string) => void
  placeholder: string
}) {
  return (
    <TextInput
      value={value}
      onChangeText={onChangeText}
      placeholder={placeholder}
      placeholderTextColor={palette.ink4}
      autoCapitalize="none"
      autoCorrect={false}
      accessibilityLabel={placeholder}
      className="min-h-12 rounded-md border border-line bg-field px-3.5 text-[14px] text-ink"
    />
  )
}

/* ── Form sheet ─────────────────────────────────────────────────────────────────────
 * A sheet that is a form: a title, a body that scrolls, and a pinned primary
 * action. Used for "add MCP server", "add an automation", "new branch". The
 * action is pinned rather than scrolled because the thing the user wants is
 * always the same control, at the same place, regardless of how much form is
 * above it. */

export function FormSheet({
  open,
  onClose,
  title,
  eyebrow,
  children,
  submitLabel,
  onSubmit,
  busy,
  error,
  disabled,
}: {
  open: boolean
  onClose: () => void
  title: string
  eyebrow?: string
  children: React.ReactNode
  submitLabel: string
  onSubmit: () => void
  busy?: boolean
  error?: string | null
  disabled?: boolean
}) {
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={title}
      eyebrow={eyebrow}
      snapPoints={[0.6, 0.92]}
      defaultSnap={1}
      footer={
        <View style={{ gap: 8 }}>
          {error ? (
            <Text className="text-[12px] leading-[16px] text-danger" numberOfLines={2}>
              {error}
            </Text>
          ) : null}
          <Button
            variant="primary"
            label={busy ? 'Working…' : submitLabel}
            onPress={onSubmit}
            disabled={busy || disabled}
            full
          />
        </View>
      }
    >
      {children}
    </Sheet>
  )
}

/* ── Re-exports used by screens that build menus from the same vocabulary ───────── */

export { SearchIcon, toneColor }
