/**
 * ui — the phone's control kit.
 *
 * Every control here is built to the spec in the approved reference
 * (`design/shared.css`): `.btn` is 36pt with a 13.5pt label, `.btn-sm` is 30,
 * `.btn-lg` is 50, `.icobtn` is a 36pt circle, `.pill` is 22 tall, `.chip` is
 * 30, `.search` is 38 and `.field` is 44. The numbers are the mockups', not a
 * local opinion — changing one here changes the phone away from the reference.
 *
 * Three rules the kit enforces so screens cannot reintroduce the old look:
 *
 *  1. **Nothing collapses.** Every control sets `flexShrink: 0`, so a crowded
 *     row ellipsizes its label instead of squeezing the control into a sliver.
 *  2. **Nothing is unreachable.** Controls smaller than 44pt carry a `hitSlop`
 *     that brings the touch target up to 44 without changing the drawn size.
 *  3. **Every state is drawn.** Pressed (scale + dim, the mockup's `:active`),
 *     disabled (dimmed, no haptic) and loading (spinner, inert) are handled by
 *     the control itself, so a screen cannot forget one.
 */

import * as React from 'react'
import {
  ActivityIndicator,
  Animated,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  View,
  Text as RNText,
  type PressableProps,
  type StyleProp,
  type TextInputProps,
  type TextStyle,
  type ViewStyle,
} from 'react-native'
import { BlurView } from 'expo-blur'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import { cn } from '@/lib/format'
import { color, radius, size, space, motion, shadowLayer, shadowThumb } from './design/tokens'
import { W_MEDIUM, W_SEMI, W_BOLD, MONO, MONO_BOLD } from './design/fonts'
import { haptic } from '@/lib/haptics'
import { useKeyboardHeight } from '@/lib/keyboard'
import { Alert as AlertGlyph, ChevronLeft, Close } from './design/icons'

/* ── Tap — the one pressable: instant feedback, haptic on commit ──────────── */

export function Tap(props: PressableProps & { squeeze?: number; children?: React.ReactNode }) {
  const { squeeze = 0.97, children, style, ...rest } = props
  return (
    <Pressable
      {...rest}
      style={(state) => [
        typeof style === 'function' ? style(state) : style,
        state.pressed ? { transform: [{ scale: squeeze }], opacity: 0.85 } : null,
      ]}
    >
      {children}
    </Pressable>
  )
}

export { haptic }

/* ── Text ─────────────────────────────────────────────────────────────────── */

/**
 * Weights travel as class names, not as a `style` object: NativeWind's interop
 * owns the style prop on a component that also carries `className`, so an
 * inline `fontWeight` or `color` is silently dropped and the text falls back to
 * the platform default — regular weight, black ink.
 */
const WEIGHT_CLASS: Record<string, string> = {
  [W_MEDIUM]: 'font-medium',
  [W_SEMI]: 'font-semibold',
  [W_BOLD]: 'font-bold',
  [MONO]: 'font-mono',
  [MONO_BOLD]: 'font-mono font-semibold',
}

export function Text({
  weight,
  className,
  style,
  ...rest
}: React.ComponentProps<typeof RNText> & { weight?: string | undefined }) {
  return <RNText {...rest} className={cn('text-ink', weight ? WEIGHT_CLASS[weight] : '', className)} style={style as StyleProp<TextStyle>} />
}

/* ── Btn — the mockup's ramp: 30 / 36 / 50 ────────────────────────────────── */

type BtnKind = 'primary' | 'plate' | 'ghost' | 'danger' | 'white'

/**
 * The ramp as literal class names. They cannot be interpolated — Tailwind only
 * emits classes it can see in the source — and they must be classes rather
 * than a `style` object: on a `Pressable` that also carries `className`,
 * NativeWind's interop takes over the style prop and an inline box is dropped,
 * which is exactly how a 30pt button turns into a full-height slab.
 */
const BTN_SIZE = {
  sm: { box: 'h-[30px] px-[13px]', font: 'text-btn-sm' as const, height: size.btnSm },
  md: { box: 'h-[36px] px-4', font: 'text-btn-md' as const, height: size.btnMd },
  lg: { box: 'h-[50px] px-[22px]', font: 'text-btn-lg' as const, height: size.btnLg },
}

const BTN_KIND: Record<BtnKind, { bg: string; ink: string }> = {
  primary: { bg: 'bg-accent', ink: 'text-accent-ink' },
  plate: { bg: 'bg-raised', ink: 'text-ink' },
  ghost: { bg: 'bg-transparent', ink: 'text-accent' },
  danger: { bg: 'bg-red-tint', ink: 'text-red' },
  white: { bg: 'bg-white', ink: 'text-black' },
}

/** A hit target of at least 44pt, without drawing a bigger control. */
export function touchSlop(height: number) {
  const pad = Math.max(0, Math.round((44 - height) / 2))
  return { top: pad, bottom: pad, left: 4, right: 4 }
}

export function Btn({
  kind = 'plate',
  label,
  icon,
  after,
  wide,
  className,
  disabled,
  loading,
  onPress,
  size: scale = 'md',
  a11yLabel,
}: {
  kind?: BtnKind
  label: string
  icon?: React.ReactNode
  after?: React.ReactNode
  wide?: boolean
  className?: string
  disabled?: boolean
  loading?: boolean
  onPress?: () => void
  size?: 'sm' | 'md' | 'lg'
  a11yLabel?: string
}) {
  const spec = BTN_SIZE[scale]
  const look = BTN_KIND[kind]
  const inert = !!disabled || !!loading
  return (
    <Tap
      accessibilityRole="button"
      accessibilityLabel={a11yLabel ?? label}
      accessibilityState={{ disabled: inert || undefined, busy: loading || undefined }}
      disabled={inert}
      hitSlop={touchSlop(spec.height)}
      squeeze={0.96}
      onPress={() => {
        if (inert) return
        void haptic('light')
        onPress?.()
      }}
      className={cn(
        'shrink-0 grow-0 flex-row items-center justify-center gap-1.5 rounded-pill',
        spec.box,
        // No `self-start` by default: it overrides a centring parent
        // (`items-center`), which is how a button ends up pinned to the left of
        // its own row. The height class already pins the box, so a stretching
        // parent cannot inflate it either.
        wide ? 'self-stretch' : '',
        inert ? 'opacity-40' : '',
        look.bg,
        className,
      )}
    >
      {loading ? <ActivityIndicator size="small" color={color.ink} /> : icon}
      <Text weight={W_SEMI} className={cn(spec.font, 'font-semibold', look.ink)} numberOfLines={1}>
        {label}
      </Text>
      {after}
    </Tap>
  )
}

/** A toolbar glyph on a 36pt circle (`.icobtn`). */
export function IconBtn({
  label,
  kind = 'plain',
  size: scale = size.ico,
  on,
  className,
  disabled,
  onPress,
  children,
}: {
  label: string
  kind?: 'plain' | 'fill' | 'accent'
  size?: number
  on?: boolean
  className?: string
  disabled?: boolean
  onPress?: () => void
  children: React.ReactNode
}) {
  const filled = on || kind === 'fill' || kind === 'accent'
  const tinted = on || kind === 'accent'
  return (
    <Tap
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled || undefined, selected: !!on }}
      disabled={disabled}
      onPress={() => {
        if (disabled) return
        void haptic('light')
        onPress?.()
      }}
      squeeze={0.92}
      hitSlop={touchSlop(scale)}
      className={cn(
        'shrink-0 items-center justify-center rounded-full',
        scale >= 36 ? 'h-9 w-9' : scale >= 30 ? 'h-[30px] w-[30px]' : 'h-7 w-7',
        disabled ? 'opacity-35' : '',
        tinted ? 'bg-accent-tint' : filled ? 'bg-fill' : 'bg-transparent',
        className,
      )}
    >
      {children}
    </Tap>
  )
}

/* ── Dot, Pill, MiniBadge — the status voice ──────────────────────────────── */

export type Tone = 'green' | 'orange' | 'red' | 'dim' | 'accent' | 'sky'

const TONE: Record<Tone, string> = {
  green: color.green,
  orange: color.orange,
  red: color.red,
  dim: color.ink3,
  accent: color.accent,
  sky: color.sky,
}
/** The same two ramps as class names, for text inside a `className` element. */
const TONE_TEXT_CLASS: Record<Tone, string> = {
  green: 'text-green',
  orange: 'text-orange',
  red: 'text-red',
  dim: 'text-ink-2',
  accent: 'text-accent',
  sky: 'text-sky',
}
const TONE_BG_CLASS: Record<Tone, string> = {
  green: 'bg-green-tint',
  orange: 'bg-orange-tint',
  red: 'bg-red-tint',
  dim: 'bg-field',
  accent: 'bg-accent-tint',
  sky: 'bg-sky-tint',
}

export function Dot({ tone = 'dim', pulse, size: dot = 8 }: { tone?: Tone; pulse?: boolean; size?: number }) {
  const breath = React.useRef(new Animated.Value(1)).current
  React.useEffect(() => {
    if (!pulse) return
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(breath, { toValue: 0.35, duration: 700, useNativeDriver: true }),
        Animated.timing(breath, { toValue: 1, duration: 700, useNativeDriver: true }),
      ]),
    )
    loop.start()
    return () => loop.stop()
  }, [pulse, breath])
  return (
    <Animated.View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ width: dot, height: dot, borderRadius: dot / 2, backgroundColor: TONE[tone], opacity: pulse ? breath : 1 }}
    />
  )
}

export function Pill({ label, tone, pulse, className }: { label: string; tone: Tone; pulse?: boolean; className?: string }) {
  return (
    <View
      accessible
      accessibilityRole="text"
      accessibilityLabel={`Status: ${label}`}
      className={cn('h-pill shrink-0 flex-row items-center gap-1.5 rounded-pill px-[9px]', TONE_BG_CLASS[tone], className)}
    >
      <Dot tone={tone} pulse={pulse} size={6} />
      <Text className={cn('text-pill font-medium', TONE_TEXT_CLASS[tone])} numberOfLines={1}>
        {label}
      </Text>
    </View>
  )
}

/** The 19pt count badge that sits under a project name (`.minibadge`). */
export function MiniBadge({ label, tone }: { label: string; tone: 'green' | 'orange' | 'red' | 'dim' }) {
  return (
    <View className={cn('h-[19px] shrink-0 flex-row items-center gap-1 rounded-pill px-2', TONE_BG_CLASS[tone])}>
      <Dot tone={tone} size={5} />
      <Text className={cn('text-mono-cap font-semibold', TONE_TEXT_CLASS[tone])}>{label}</Text>
    </View>
  )
}

/* ── Chip, Search, Field, Seg ─────────────────────────────────────────────── */

/** The filter chip (`.chip`) — 30pt tall, 13pt label, white when selected. */
export function Chip({
  label,
  count,
  dot,
  on,
  onPress,
}: {
  label: string
  count?: number
  dot?: Tone
  on?: boolean
  onPress: () => void
}) {
  return (
    <Tap
      accessibilityRole="tab"
      accessibilityState={{ selected: !!on }}
      onPress={() => {
        void haptic('select')
        onPress()
      }}
      hitSlop={touchSlop(size.chip)}
      className={cn('h-chip shrink-0 flex-row items-center gap-1.5 rounded-pill px-[14px]', on ? 'bg-white' : 'bg-field')}
    >
      {dot ? <Dot tone={dot} size={6} /> : null}
      <Text className={cn('text-sub', on ? 'font-semibold text-black' : 'font-medium text-ink-2')}>{label}</Text>
      {count !== undefined && count > 0 ? (
        <Text className={cn('text-sub', on ? 'text-black' : 'text-ink-2')} style={{ opacity: 0.65, fontVariant: ['tabular-nums'] }}>
          {count}
        </Text>
      ) : null}
    </Tap>
  )
}

/** The 38pt search well (`.search`). */
export function Search({
  value,
  onChangeText,
  placeholder,
  icon,
  className,
}: {
  value: string
  onChangeText: (next: string) => void
  placeholder: string
  icon?: React.ReactNode
  className?: string
}) {
  return (
    <View className={cn('h-search flex-row items-center gap-2 rounded-control bg-field px-3', className)}>
      {icon ? <View className="shrink-0">{icon}</View> : null}
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={color.ink3}
        accessibilityLabel={placeholder}
        className="min-w-0 flex-1 text-body text-ink"
        style={{ paddingVertical: 0 }}
      />
    </View>
  )
}

/** A 44pt input well (`.field`), or 88pt multi-line (`.field.multi`). */
export function Field({
  className,
  leading,
  mono,
  multi,
  ...rest
}: TextInputProps & { leading?: React.ReactNode; mono?: boolean; multi?: boolean; className?: string }) {
  return (
    <View
      className={cn('flex-row gap-2 rounded-control bg-option px-3.5', multi ? 'min-h-[88px] items-start py-3' : 'h-field items-center', className)}
    >
      {leading ? <View className="shrink-0">{leading}</View> : null}
      <TextInput
        placeholderTextColor={color.ink3}
        multiline={multi}
        {...rest}
        className={cn('min-w-0 flex-1 text-body text-ink', mono && 'font-mono')}
        style={[
          multi ? { paddingVertical: 0, lineHeight: 22, textAlignVertical: 'top' } : { paddingVertical: 0 },
          mono ? { fontFamily: MONO } : undefined,
          rest.style as StyleProp<TextStyle>,
        ]}
      />
    </View>
  )
}

/** The segmented control (`.seg`). */
export function Seg<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T
  options: Array<{ value: T; label: string }>
  onChange: (value: T) => void
}) {
  return (
    <View accessibilityRole="tablist" className="shrink-0 flex-row rounded-[11px] bg-field p-0.5">
      {options.map((option) => {
        const active = value === option.value
        return (
          <Tap
            key={option.value}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            onPress={() => {
              void haptic('select')
              onChange(option.value)
            }}
            className={cn('h-8 flex-1 flex-row items-center justify-center rounded-[9px] px-2.5', active ? 'bg-raised' : 'bg-transparent')}
            style={active ? shadowThumb : undefined}
          >
            <Text className={cn('text-btn-md', active ? 'font-semibold text-ink' : 'text-ink-2')} weight={active ? W_SEMI : undefined}>
              {option.label}
            </Text>
          </Tap>
        )
      })}
    </View>
  )
}

/* ── Structure: Card, SectionHead, Row, Label, Hairline ───────────────────── */

/** The grouped-list card (`.card`) — 16pt gutter, 16pt radius. */
export function Card({ children, className, style }: { children: React.ReactNode; className?: string; style?: StyleProp<ViewStyle> }) {
  return (
    <View className={cn('mx-4 overflow-hidden rounded-card bg-card', className)} style={style}>
      {children}
    </View>
  )
}

/** The section header (`.section-head`) — title 13, count 12, 26pt above. */
export function SectionHead({
  title,
  count,
  trailing,
}: {
  title: string
  count?: React.ReactNode
  trailing?: React.ReactNode
}) {
  return (
    <View className="mx-4 mb-[9px] mt-[26px] flex-row items-baseline gap-2">
      <Text className="text-section font-semibold text-ink-2">{title}</Text>
      {count !== undefined ? (
        <Text className="text-section-count font-medium text-ink-3" style={{ fontVariant: ['tabular-nums'] }}>
          {count}
        </Text>
      ) : null}
      <View className="flex-1" />
      {trailing}
    </View>
  )
}

/**
 * A grouped-list row (`.row`). The hairline is drawn by the row itself, so a
 * list of rows never needs hand-placed dividers.
 */
export function Row({
  children,
  onPress,
  selected,
  first,
  align = 'center',
  className,
  a11yLabel,
  a11yState,
}: {
  children: React.ReactNode
  onPress?: () => void
  selected?: boolean
  first?: boolean
  align?: 'center' | 'top'
  className?: string
  a11yLabel?: string
  a11yState?: Record<string, boolean | undefined>
}) {
  const body = (
    <View
      className={cn(
        'relative min-h-[52px] flex-row gap-3 px-4 py-2.5',
        align === 'center' ? 'items-center' : 'items-start',
        selected ? 'bg-accent-tint' : '',
        className,
      )}
    >
      {!first ? <View className="absolute left-4 right-0 top-0 h-px" style={{ backgroundColor: color.lineSoft }} /> : null}
      {children}
    </View>
  )
  if (!onPress) return body
  return (
    <Tap
      accessibilityRole="button"
      accessibilityLabel={a11yLabel}
      accessibilityState={a11yState}
      onPress={() => {
        void haptic('select')
        onPress()
      }}
    >
      {body}
    </Tap>
  )
}

/** An uppercase group label above a card (`.sheet-section`). */
export function Label({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <Text className={cn('mx-4 mb-1.5 mt-3.5 text-[11px] font-semibold uppercase text-ink-3', className)} style={{ letterSpacing: 0.6 }}>
      {children}
    </Text>
  )
}

export function Hairline({ left = 16, right = 0 }: { left?: number; right?: number }) {
  return <View className="h-px shrink-0" style={{ backgroundColor: color.line, marginLeft: left, marginRight: right }} />
}

/* ── Notice, Empty, Loader ────────────────────────────────────────────────── */

export function Notice({
  message,
  tone = 'warn',
  onClose,
}: {
  message: string
  tone?: 'warn' | 'error'
  onClose: () => void
}) {
  const bg = tone === 'error' ? 'bg-red-tint' : 'bg-orange-tint'
  const ink = tone === 'error' ? color.red : color.orange
  return (
    <View accessibilityRole="alert" className={cn('shrink-0 flex-row items-start gap-2.5 px-3.5 py-2.5', bg)}>
      <View className="mt-0.5 shrink-0">
        <AlertGlyph color={ink} />
      </View>
      <Text className="min-w-0 flex-1 text-meta leading-[19px] text-ink">{message}</Text>
      <Tap accessibilityRole="button" accessibilityLabel="Dismiss" onPress={onClose} hitSlop={10} className="shrink-0 p-1">
        <Close size={13} color={color.ink2} />
      </Tap>
    </View>
  )
}

export function Empty({ title, note, action }: { title: string; note?: string; action?: React.ReactNode }) {
  return (
    <View className="mx-4 my-6 flex-col items-center justify-center gap-1.5 rounded-card border-[1.5px] border-dashed border-line-strong px-6 py-10">
      <Text className="text-center text-body font-semibold text-ink-2" weight={W_SEMI}>
        {title}
      </Text>
      {note ? <Text className="max-w-80 text-center text-meta leading-[19px] text-ink-3">{note}</Text> : null}
      {action ? <View className="pt-2">{action}</View> : null}
    </View>
  )
}

/** Three breathing dots — the working mark (`.loader`). */
export function Loader({ label }: { label?: string }) {
  const frames = React.useRef([new Animated.Value(1), new Animated.Value(0.4), new Animated.Value(1)]).current
  React.useEffect(() => {
    const loops = frames.map((value, index) =>
      Animated.loop(
        Animated.sequence([
          Animated.timing(value, { toValue: 0.3, duration: 550, delay: index * 160, useNativeDriver: true }),
          Animated.timing(value, { toValue: 1, duration: 550, delay: index * 160, useNativeDriver: true }),
        ]),
      ),
    )
    loops.forEach((loop) => loop.start())
    return () => loops.forEach((loop) => loop.stop())
  }, [frames])
  return (
    <View className="flex-row items-center gap-2">
      <View className="flex-row items-center gap-[3.5px]">
        {frames.map((value, index) => (
          <Animated.View key={index} className="size-[4.5px] rounded-full bg-ink-2" style={{ opacity: value }} />
        ))}
      </View>
      {label ? <Text className="text-sub text-ink-2">{label}</Text> : null}
    </View>
  )
}

/* ── Chrome — translucent bars over content ──────────────────────────────── */

/**
 * The `.chrome` layer: `rgba(22,22,24,0.72)` over a blur of what is behind it.
 *
 * Android can only blur a view it has a reference to, and a `Modal` renders in
 * a separate window — so a bar passes the ref of the content it floats over
 * when it has one, and otherwise gets the same colour as an opaque fill. That
 * fallback is deliberate: a BlurView with no target renders *nothing* and logs
 * a warning, which is how the chrome previously disappeared entirely.
 */
export function Chrome({ target }: { target?: React.RefObject<View | null> }) {
  if (target) {
    return (
      <>
        <BlurView intensity={40} tint="dark" blurMethod="dimezisBlurView" blurTarget={target} style={StyleSheet.absoluteFill} />
        {/* 0.72 is the mockup's `.chrome`, and it is only legible on top of the
            blur above. When the platform declines to blur (older Android, an
            unreachable target) that layer alone lets text read straight through
            the bar, so the fill backs off toward opaque instead. */}
        <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(22, 22, 24, 0.94)' }]} />
      </>
    )
  }
  return <View style={[StyleSheet.absoluteFill, { backgroundColor: 'rgba(22, 22, 24, 0.96)' }]} />
}

/* ── Sheet — bottom sheets and side panes ─────────────────────────────────── */

export function Sheet({
  open,
  onClose,
  title,
  glyph,
  children,
  foot,
  edge = 'bottom',
  back,
  width,
}: {
  open: boolean
  onClose: () => void
  title: string
  glyph?: React.ReactNode
  children: React.ReactNode
  foot?: React.ReactNode
  edge?: 'bottom' | 'left' | 'right'
  back?: { label: string; onPress: () => void }
  width?: number
}) {
  const insets = useSafeAreaInsets()
  // A sheet is a Modal, so the keyboard draws over it. Lifting the footer by the
  // IME height keeps the primary action reachable while typing (the first
  // prompt field sits directly above it).
  const keyboard = useKeyboardHeight()
  const [mounted, setMounted] = React.useState(open)
  const progress = React.useRef(new Animated.Value(open ? 1 : 0)).current
  const paneW = Math.round(390 * (width ?? 0.82))

  React.useEffect(() => {
    if (open) {
      setMounted(true)
      progress.setValue(0)
      Animated.spring(progress, { toValue: 1, useNativeDriver: true, ...motion.overlay }).start()
    } else if (mounted) {
      Animated.timing(progress, { toValue: 0, duration: 180, useNativeDriver: true }).start(({ finished }) => {
        if (finished) setMounted(false)
      })
    }
  }, [open, mounted, progress])

  if (!mounted) return null

  const side = edge === 'left' || edge === 'right'
  const shift = side
    ? progress.interpolate({ inputRange: [0, 1], outputRange: [edge === 'left' ? -paneW : paneW, 0] })
    : progress.interpolate({ inputRange: [0, 1], outputRange: [900, 0] })

  return (
    <Modal transparent visible animationType="none" statusBarTranslucent onRequestClose={onClose}>
      <View style={{ flex: 1, ...(side ? {} : { justifyContent: 'flex-end' }) }}>
        <Animated.View style={{ position: 'absolute', left: 0, right: 0, top: 0, bottom: 0, backgroundColor: color.scrim, opacity: progress }}>
          <Pressable accessibilityRole="button" accessibilityLabel="Close" onPress={onClose} style={{ flex: 1 }} />
        </Animated.View>
        <Animated.View
          accessibilityViewIsModal
          style={[
            side
              ? {
                  position: 'absolute',
                  top: insets.top,
                  bottom: 0,
                  width: paneW,
                  [edge === 'left' ? 'left' : 'right']: 0,
                  borderLeftWidth: edge === 'right' ? 0.5 : 0,
                  borderRightWidth: edge === 'left' ? 0.5 : 0,
                  borderColor: color.line,
                  overflow: 'hidden',
                  backgroundColor: color.pane,
                }
              : {
                  maxHeight: '86%',
                  borderTopLeftRadius: radius.sheet,
                  borderTopRightRadius: radius.sheet,
                  backgroundColor: 'rgba(28, 28, 30, 0.97)',
                  borderTopWidth: 0.5,
                  borderColor: 'rgba(255, 255, 255, 0.14)',
                },
            { transform: [{ translateX: side ? shift : 0 }, { translateY: side ? 0 : shift }], overflow: 'hidden' },
            shadowLayer,
          ]}
        >
          {!side ? (
            <View style={{ height: 22, alignItems: 'center', justifyContent: 'center' }}>
              <View className="h-[5px] w-10 rounded-full" style={{ backgroundColor: 'rgba(255, 255, 255, 0.25)' }} />
            </View>
          ) : null}
          <View className={cn('shrink-0 flex-row items-center gap-2.5', side ? 'px-3.5 pb-2.5 pt-3.5' : 'px-[18px] pb-2.5 pt-1.5')}>
            {back ? (
              <IconBtn label={back.label} onPress={back.onPress}>
                <ChevronLeft size={side ? 22 : 16} color={color.ink} stroke={2.2} />
              </IconBtn>
            ) : (
              glyph
            )}
            <Text className="min-w-0 flex-1 text-sheet-title font-semibold text-ink" weight={W_SEMI} numberOfLines={1}>
              {title}
            </Text>
            <IconBtn label="Close" onPress={onClose}>
              <Close size={18} color={color.ink2} />
            </IconBtn>
          </View>
          <View className="h-px shrink-0" style={{ backgroundColor: color.lineSoft }} />
          <ScrollView
            style={side ? { flex: 1 } : { flexGrow: 1, flexShrink: 1 }}
            contentContainerStyle={{ paddingBottom: 26 }}
            keyboardShouldPersistTaps="handled"
            showsVerticalScrollIndicator={false}
          >
            {children}
          </ScrollView>
          {foot ? (
            <View
              className="shrink-0 gap-3 border-t px-4 pt-3"
              style={{
                borderColor: color.lineSoft,
                paddingBottom: keyboard > 0 ? 8 : Math.max(insets.bottom, space.lg),
              }}
            >
              {foot}
            </View>
          ) : (
            <View className="shrink-0" style={{ height: keyboard > 0 ? 8 : Math.max(insets.bottom, space.lg) }} />
          )}
        </Animated.View>
      </View>
    </Modal>
  )
}

/* ── Brand ────────────────────────────────────────────────────────────────── */

export function Brand({ size: mark = 28 }: { size?: number }) {
  return (
    <View
      style={{
        width: mark,
        height: mark,
        borderRadius: Math.round(mark * 0.25),
        backgroundColor: color.accent,
        alignItems: 'center',
        justifyContent: 'center',
      }}
    >
      <Text style={{ fontFamily: MONO, fontSize: Math.round(mark * 0.43), fontWeight: '600', color: color.accentInk }}>Q</Text>
    </View>
  )
}