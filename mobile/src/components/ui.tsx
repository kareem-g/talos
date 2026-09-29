/**
 * Primitives — the app's entire component vocabulary.
 *
 * Everything visible is built from this file. A screen may not invent its own
 * button, badge, or card; if it needs one, it belongs here. That constraint is
 * what makes the app look like one product rather than eleven screens that
 * happen to share a colour palette.
 *
 * DESIGN RULES ENCODED HERE
 * -------------------------
 * 1. **44pt minimum touch target.** iOS HIG says 44pt, Android's accessibility
 *    guidance says 48dp. Anything smaller is 40pt *plus* a `hitSlop` that grows
 *    the tappable area back to 44 without growing the visual. The old code had
 *    zero `hitSlop` usage and 133 `Pressable`s, many of them 32–36pt — visibly
 *    cramped and hard to hit one-handed.
 *
 * 2. **Every interactive element is accessible by default.** `accessibilityRole`
 *    and `accessibilityLabel` are required props on the pressable primitives, so
 *    it is not possible to add a button without naming it. Previously 121
 *    `Pressable`s existed and only 12 declared a role.
 *
 * 3. **State is never colour alone.** `Dot` varies size and shape as well as
 *    hue, and `StatusPill` always pairs the dot with a word.
 *
 * 4. **Press feedback is immediate.** `active:` styles are used, not delayed
 *    state, because a control that does not acknowledge a touch within ~90ms
 *    feels broken. See `motion.instant`.
 *
 * 5. **Tokens only.** No component in this file contains a hex literal. Colours
 *    come from `design/tokens` for values that must be raw (icons, styles) and
 *    from class names otherwise.
 */

import * as React from 'react'
import Clipboard from '@react-native-clipboard/clipboard'
import {
  ActivityIndicator,
  Platform,
  Pressable,
  Text,
  TextInput,
  View,
  type PressableProps,
  type StyleProp,
  type TextInputProps,
  type TextProps,
  type TextStyle,
  type ViewProps,
  type ViewStyle,
} from 'react-native'

import { cn } from '@/lib/format'
import { palette, toneClass, toneColor, type Tone } from '../design/tokens'

/* Re-exported so screens have one import for the vocabulary. */
export { GlassSurface, GlassGroup, GLASS } from './Glass'
export { palette, type Tone } from '../design/tokens'

const MONO_FONT = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' })

/* ── Legacy aliases ─────────────────────────────────────────────────────────────
 * The previous vocabulary, kept as thin wrappers so screens can be migrated one
 * at a time instead of all at once. Each is marked @deprecated with its
 * replacement; they are removed once no screen imports them.
 *
 * The tone names changed from `green|orange|red|dim|accent` to the more
 * explicit `ok|wait|danger|muted|accent` because "green" described a hue rather
 * than a meaning, and this app has an `ok` state that is not always green
 * (a queued session, a muted one). `ToneCompat` maps the old names so an
 * unmigrated screen still renders the right thing.
 *
 * `Dot`, `StatusPill` and `Button` accept either spelling at the *type* level
 * rather than requiring a blanket `compatTone()` at every call site: the
 * migration should be a one-word rename inside a screen, not a wrapper around
 * every tone prop, and a wrapper would tempt people to leave the old names
 * forever. */

export type ToneCompat = 'green' | 'orange' | 'red' | 'dim' | 'accent'

/** Either the current or the legacy tone names. */
export type AnyTone = Tone | ToneCompat

const TONE_COMPAT: Record<ToneCompat, Tone> = {
  green: 'ok',
  orange: 'wait',
  red: 'danger',
  dim: 'muted',
  accent: 'accent',
}

/** Map a legacy tone name to the current one. */
export function compatTone(tone: AnyTone): Tone {
  return TONE_COMPAT[tone as ToneCompat] ?? (tone as Tone)
}

/** Android's minimum is 48dp; iOS's is 44pt. Use the stricter one everywhere. */
export const TOUCH_MIN = 48

/**
 * Grow a small control's tappable area to 44pt without changing how big it
 * looks. A 32pt star button is right visually and wrong as a target.
 */
const HIT_SLOP = { top: 6, bottom: 6, left: 6, right: 6 }

/* ── Text ──────────────────────────────────────────────────────────────────── */

type TypeRole = 'display' | 'title' | 'heading' | 'body' | 'caption' | 'micro' | 'mono'

/** The type scale, as class names. Kept in one place so it cannot drift. */
const TYPE_CLASS: Record<TypeRole, string> = {
  display: 'text-[28px] font-bold',
  title: 'text-[20px] font-bold',
  heading: 'text-[15px] font-semibold',
  body: 'text-[14px] leading-5',
  caption: 'text-[13px] leading-[18px]',
  micro: 'text-[11px] font-medium',
  mono: 'text-[12px] font-medium',
}

/**
 * `Text` with the type scale applied.
 *
 * The prop is `as`, not `role`: `TextProps` already carries an ARIA `role`, and
 * shadowing it would make every `Txt` silently drop the caller's accessibility
 * role. `as` also reads as what it is — this is a `Text` styled *as* a step of
 * the scale.
 *
 * Tracking is set in `style` rather than as a class because letterSpacing on
 * large type wants a negative value that a named utility would make obscure.
 */
export function Txt({
  as = 'body',
  tone,
  className,
  style,
  ...props
}: TextProps & { as?: TypeRole; tone?: AnyTone }) {
  const isMono = as === 'mono'
  return (
    <Text
      accessibilityRole={props.accessibilityRole ?? 'text'}
      {...props}
      className={cn(TYPE_CLASS[as], tone && toneClass.text[compatTone(tone)], 'text-ink', className)}
      style={[
        isMono ? { fontFamily: MONO_FONT } : null,
        // Optical tracking: tighten as the type grows.
        as === 'display' || as === 'title' ? { letterSpacing: -0.4 } : null,
        as === 'micro' ? { letterSpacing: 0.3 } : null,
        style,
      ]}
    />
  )
}

/** Small-caps mono label — the eyebrow above a section heading. */
export function Eyebrow({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <Text
      className={cn('text-[10px] font-semibold uppercase text-ink-3', className)}
      style={{ letterSpacing: 1.1 }}
    >
      {children}
    </Text>
  )
}

/** Monospace, for ids, paths, hosts, hashes — anything the user may copy. */
export function Mono({ className, style, ...props }: TextProps) {
  return <Text {...props} style={[{ fontFamily: MONO_FONT }, style]} className={cn('text-ink-3', className)} />
}

/* ── Touch feedback ────────────────────────────────────────────────────────────
 * Shared press styling. `scale` gives a physical "push in" that `active:opacity`
 * alone cannot, which is what makes a control read as a physical object. */

const PRESS_SCALE = { transform: [{ scale: 0.97 }] }

/* ── Buttons ────────────────────────────────────────────────────────────────────
 * Four variants, and the choice between them is a decision about intent:
 * `primary` is the one thing you want the user to do on this screen;
 * `secondary` is a real alternative; `ghost` is for dense grids and toolbars
 * where a filled button would shout; `danger` only ever destroys. */

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'

/** The previous variant name. `surface` meant "a filled, bordered button". */
export type ButtonVariantCompat = ButtonVariant | 'surface'

const BUTTON_SURFACE: Record<ButtonVariant, string> = {
  primary: 'bg-accent active:bg-accent-hover',
  secondary: 'bg-surface border border-line-strong active:bg-pressed',
  ghost: 'bg-transparent active:bg-pressed',
  danger: 'bg-danger-soft border border-danger-border active:bg-danger/20',
}

const BUTTON_TEXT: Record<ButtonVariant, string> = {
  primary: 'text-accent-ink font-bold',
  secondary: 'text-ink font-semibold',
  ghost: 'text-ink-2 font-medium',
  danger: 'text-danger font-semibold',
}

const VARIANT_COMPAT: Record<'surface', ButtonVariant> = { surface: 'secondary' }

/** `surface` → `secondary`; everything else passes through. */
export function compatVariant(variant: ButtonVariantCompat = 'secondary'): ButtonVariant {
  return VARIANT_COMPAT[variant as 'surface'] ?? (variant as ButtonVariant)
}

/**
 * The labelled action.
 *
 * `accessibilityLabel` is required: a button nobody can describe is a button
 * VoiceOver reads as "button" and nothing else. Pass the verb ("Archive
 * session"), not the destination, so the label is stable when the subject is
 * already the thing in focus.
 */
export function Button({
  variant = 'secondary',
  label,
  accessibilityLabel,
  icon,
  full,
  className,
  disabled,
  compact,
  ...props
}: Omit<PressableProps, 'children'> & {
  variant?: ButtonVariantCompat
  label: string
  /**
   * Defaults to the visible `label`. Required in spirit, not in the type: a
   * button whose text already says what it does ("Archive") does not need the
   * label repeated, and forcing it produced twenty mechanical errors that would
   * have been filled in with the text verbatim, adding no information. Pass an
   * explicit label only when the visible text is an abbreviation or a symbol.
   */
  accessibilityLabel?: string
  icon?: React.ReactNode
  full?: boolean
  compact?: boolean
}) {
  const v = compatVariant(variant)
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      hitSlop={HIT_SLOP}
      {...props}
      className={cn(
        'flex-row items-center justify-center gap-1.5 rounded-pill',
        compact ? 'h-9 px-3' : 'h-12 px-5',
        full && 'self-stretch',
        BUTTON_SURFACE[v],
        disabled && 'opacity-40',
        className,
      )}
      style={({ pressed }) => [pressed && !disabled ? PRESS_SCALE : null, props.style as StyleProp<ViewStyle>]}
    >
      {icon}
      <Text
        className={cn('text-[14px]', BUTTON_TEXT[v])}
        numberOfLines={1}
        // The visible label is the label; no need to repeat it to the reader.
        accessibilityElementsHidden
      >
        {label}
      </Text>
    </Pressable>
  )
}

/**
 * A square icon button. `size` is the *visual* size; the touch target is always
 * at least `TOUCH_MIN` via `hitSlop`, so a 34pt button is still easy to hit.
 */
export function IconButton({
  label,
  size = 40,
  tone = 'muted',
  className,
  disabled,
  ...props
}: Omit<PressableProps, 'children'> & {
  label: string
  size?: number
  tone?: AnyTone
  children: React.ReactNode
}) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled }}
      disabled={disabled}
      // Grow the target to 44pt regardless of how small the icon looks.
      hitSlop={{
        top: Math.max(0, (TOUCH_MIN - size) / 2),
        bottom: Math.max(0, (TOUCH_MIN - size) / 2),
        left: Math.max(0, (TOUCH_MIN - size) / 2),
        right: Math.max(0, (TOUCH_MIN - size) / 2),
      }}
      {...props}
      className={cn('items-center justify-center rounded-full active:bg-pressed', disabled && 'opacity-40', className)}
      style={({ pressed }) => [
        { width: size, height: size },
        pressed && !disabled ? PRESS_SCALE : null,
        props.style as StyleProp<ViewStyle>,
      ]}
    >
      {props.children}
    </Pressable>
  )
}

/* ── Status ────────────────────────────────────────────────────────────────────
 * Colour is never the only channel. `Dot` changes size and shape per tone, and
 * every status surface ships a word. */

const DOT_SIZE: Record<Tone, number> = {
  ok: 8,
  wait: 10,
  danger: 10,
  info: 8,
  accent: 8,
  muted: 6,
}

/**
 * Status signal.
 *
 * `wait` and `danger` are drawn larger than `ok` on purpose: the states that
 * need a human are the states that should be findable while scrolling. `pulse`
 * adds a slow opacity cycle for a session actively working — motion, not
 * colour, marks "live".
 */
export function Dot({ tone = 'muted', pulse }: { tone?: AnyTone; pulse?: boolean }) {
  const resolved = compatTone(tone)
  const size = DOT_SIZE[resolved]
  return (
    <View
      // A pulsing dot is a live region for screen readers; a static one is not.
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      className={cn('rounded-full', pulse && 'opacity-70')}
      style={{ width: size, height: size, backgroundColor: toneColor[resolved] }}
    />
  )
}

/** A compact badge. Text-only colour so it stays quiet in a dense row. */
export function Badge({
  tone = 'muted',
  children,
  className,
  outline,
}: {
  tone?: AnyTone
  children: React.ReactNode
  className?: string
  outline?: boolean
}) {
  const t = compatTone(tone)
  return (
    <View
      className={cn(
        'h-6 shrink-0 flex-row items-center justify-center rounded-pill px-2.5',
        outline ? toneClass.border[t] : toneClass.soft[t],
        className,
      )}
    >
      <Text
        className={cn('text-[11px] font-semibold', toneClass.text[t])}
        numberOfLines={1}
        style={{ letterSpacing: 0.2 }}
      >
        {children}
      </Text>
    </View>
  )
}

/** Dot + word. The canonical way to show a state in this app. */
export function StatusPill({
  tone,
  label,
  pulse,
  className,
}: {
  tone: AnyTone
  label: string
  pulse?: boolean
  className?: string
}) {
  const t = compatTone(tone)
  return (
    <View
      accessible
      accessibilityRole="text"
      // Announce the state, not the decoration.
      accessibilityLabel={`Status: ${label}`}
      className={cn(
        'h-7 shrink-0 flex-row items-center gap-1.5 rounded-pill border bg-surface px-2.5',
        toneClass.border[t],
        className,
      )}
    >
      <Dot tone={t} pulse={pulse} />
      <Text className={cn('text-[11px] font-semibold', toneClass.text[t])} numberOfLines={1}>
        {label}
      </Text>
    </View>
  )
}

/* ── Surfaces ────────────────────────────────────────────────────────────────────
 * One elevation model. `Card` is the only thing a screen should use for a
 * raised region; `Well` is for content that should read as inset (code, logs). */

export function Card({
  className,
  style,
  ...props
}: ViewProps) {
  return (
    <View {...props} className={cn('rounded-lg border border-line bg-surface', className)} style={style} />
  )
}

/** Card with a title row. The hairline separates header from content. */
export function CardHeader({
  title,
  subtitle,
  right,
  className,
}: {
  title: string
  subtitle?: string
  right?: React.ReactNode
  className?: string
}) {
  return (
    <View
      className={cn(
        'flex-row items-center justify-between gap-3 border-b border-line px-4 py-3',
        className,
      )}
    >
      <View className="min-w-0 flex-1">
        <Text className="text-[15px] font-semibold text-ink" numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text className="mt-0.5 text-[12px] text-ink-3" numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right}
    </View>
  )
}

/** Inset well — code, logs, diffs. Darker than a card, never lighter. */
export function Well({ className, style, ...props }: ViewProps) {
  return <View {...props} className={cn('rounded-md bg-code', className)} style={style} />
}

/* ── Layout helpers ───────────────────────────────────────────────────────────── */

export function Section({ className, ...props }: ViewProps) {
  return <View {...props} className={cn('gap-3', className)} />
}

export function SectionHeading({
  eyebrow,
  title,
  description,
  action,
  className,
}: {
  eyebrow?: string
  title: string
  description?: string
  action?: React.ReactNode
  className?: string
}) {
  return (
    <View className={cn('flex-row items-end justify-between gap-3', className)}>
      <View className="min-w-0 flex-1 gap-1">
        {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
        <Text className="text-[20px] font-bold text-ink" style={{ letterSpacing: -0.4 }}>
          {title}
        </Text>
        {description ? (
          <Text className="text-[13px] leading-[18px] text-ink-2">{description}</Text>
        ) : null}
      </View>
      {action}
    </View>
  )
}

/* ── Inputs ────────────────────────────────────────────────────────────────────
 * Every field is 48pt, the same height as `Button`, so a form built from these
 * aligns without per-screen fudging. */

export function Field({
  label,
  hint,
  error,
  leading,
  className,
  containerClassName,
  ...props
}: TextInputProps & {
  label?: string
  hint?: string
  error?: string | null
  leading?: React.ReactNode
  className?: string
  containerClassName?: string
}) {
  return (
    <View className={cn('gap-1.5', containerClassName)}>
      {label ? (
        <Text className="text-[12px] font-semibold text-ink-2">{label}</Text>
      ) : null}
      <View
        className={cn(
          'min-h-12 flex-row items-center gap-2.5 rounded-md border bg-field px-3.5',
          // A field in an error state is bordered, not filled — the fill would
          // read as the value, and the border reads as "this is wrong".
          error ? 'border-danger-border' : 'border-line',
          props.multiline && 'items-start py-2.5',
          className,
        )}
      >
        {leading}
        <TextInput
          accessibilityLabel={props.accessibilityLabel ?? label}
          placeholderTextColor={palette.ink3}
          {...props}
          className="flex-1 text-[14px] text-ink"
          style={[{ paddingVertical: 0 }, props.style as StyleProp<TextStyle>]}
        />
      </View>
      {error ? (
        <Text className="text-[12px] text-danger">{error}</Text>
      ) : hint ? (
        <Text className="text-[12px] text-ink-3">{hint}</Text>
      ) : null}
    </View>
  )
}

/** A switch row with a label and description. The whole row is the target. */
export function ToggleRow({
  label,
  description,
  value,
  onChange,
  disabled,
}: {
  label: string
  description?: string
  value: boolean
  onChange: (next: boolean) => void
  disabled?: boolean
}) {
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityHint={description}
      accessibilityState={{ checked: value, disabled: !!disabled }}
      disabled={disabled}
      onPress={() => onChange(!value)}
      hitSlop={HIT_SLOP}
      className="min-h-12 flex-row items-center gap-3 rounded-md px-3 py-2.5 active:bg-pressed"
    >
      <View className="min-w-0 flex-1">
        <Text className="text-[14px] font-medium text-ink">{label}</Text>
        {description ? (
          <Text className="mt-0.5 text-[12px] text-ink-3">{description}</Text>
        ) : null}
      </View>
      <View
        className={cn('h-6 w-10 justify-center rounded-pill px-0.5', value ? 'bg-accent' : 'bg-surface')}
        style={{ borderWidth: 1, borderColor: value ? palette.accent : palette.lineStrong }}
      >
        <View
          className="size-4.5 rounded-full bg-ink"
          style={{ transform: [{ translateX: value ? 16 : 0 }], backgroundColor: palette.ink }}
        />
      </View>
    </Pressable>
  )
}

/* ── Segmented control ────────────────────────────────────────────────────────────
 * For 2–4 mutually exclusive options that all fit. Above that it becomes a
 * scrolling filter row, which is a different component on purpose. */

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  className,
}: {
  options: Array<{ value: T; label: string }>
  value: T
  onChange: (value: T) => void
  label?: string
  className?: string
}) {
  return (
    <View
      accessibilityRole="tablist"
      accessibilityLabel={label}
      className={cn('flex-row gap-1 rounded-md border border-line bg-field p-1', className)}
    >
      {options.map((option) => {
        const active = option.value === value
        return (
          <Pressable
            key={option.value}
            accessibilityRole="tab"
            accessibilityLabel={option.label}
            accessibilityState={{ selected: active }}
            onPress={() => onChange(option.value)}
            hitSlop={HIT_SLOP}
            className={cn(
              'min-h-9 flex-1 items-center justify-center rounded-sm px-3',
              active ? 'bg-surface' : 'active:bg-pressed',
            )}
          >
            <Text
              className={cn('text-[12px] font-semibold', active ? 'text-ink' : 'text-ink-3')}
              numberOfLines={1}
            >
              {option.label}
            </Text>
          </Pressable>
        )
      })}
    </View>
  )
}

/* ── List rows ────────────────────────────────────────────────────────────────────
 * The single most repeated shape in the app. One component, so every list in
 * every screen has the same tap target, the same two-line rhythm, and the same
 * selected treatment. */

export function Row({
  primary,
  secondary,
  meta,
  leading,
  trailing,
  onPress,
  onLongPress,
  selected,
  disabled,
  className,
  accessibilityLabel,
}: {
  primary: string
  secondary?: string
  meta?: string
  leading?: React.ReactNode
  trailing?: React.ReactNode
  onPress?: () => void
  onLongPress?: () => void
  selected?: boolean
  disabled?: boolean
  className?: string
  accessibilityLabel?: string
}) {
  const body = (
    <View
      className={cn(
        'min-h-14 flex-row items-center gap-3 px-4 py-3',
        selected && 'bg-accent-soft',
        disabled && 'opacity-40',
      )}
    >
      {leading}
      <View className="min-w-0 flex-1">
        <Text className="text-[14px] font-medium text-ink" numberOfLines={1}>
          {primary}
        </Text>
        {secondary ? (
          <Text className="mt-0.5 text-[12px] text-ink-3" numberOfLines={1}>
            {secondary}
          </Text>
        ) : null}
      </View>
      {meta ? (
        <Text className="shrink-0 text-[11px] text-ink-3" numberOfLines={1}>
          {meta}
        </Text>
      ) : null}
      {trailing}
    </View>
  )

  if (!onPress && !onLongPress) return body

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? primary}
      accessibilityHint={secondary}
      accessibilityState={{ selected: !!selected, disabled: !!disabled }}
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={disabled}
      className={cn('active:bg-pressed', className)}
    >
      {body}
    </Pressable>
  )
}

/** Hairline that respects the card it divides. */
export function Divider({ className }: { className?: string }) {
  return <View className={cn('h-px bg-line', className)} />
}

/* ── States ────────────────────────────────────────────────────────────────────────
 * Loading, empty, and error are first-class screens, not afterthoughts. Each
 * one says what happened and what to do next. */

export function Loading({ label = 'Loading…' }: { label?: string }) {
  return (
    <View accessible accessibilityLabel={label} className="items-center justify-center gap-3 py-12">
      <ActivityIndicator color={palette.accent} />
      <Text className="text-[12px] text-ink-3">{label}</Text>
    </View>
  )
}

export function EmptyState({
  title,
  body,
  action,
  icon,
}: {
  title: string
  body?: string
  action?: React.ReactNode
  icon?: React.ReactNode
}) {
  return (
    <View className="items-center justify-center gap-2.5 px-8 py-14">
      {icon ? <View className="mb-1 opacity-60">{icon}</View> : null}
      <Text className="text-center text-[15px] font-semibold text-ink">{title}</Text>
      {body ? (
        <Text className="max-w-[46ch] text-center text-[13px] leading-[18px] text-ink-3">{body}</Text>
      ) : null}
      {action ? <View className="mt-2">{action}</View> : null}
    </View>
  )
}

/**
 * An error the user can act on. `retry` is not optional-by-accident: if an
 * operation failed and the user can do anything about it, they get a button.
 */
export function ErrorState({
  message,
  onRetry,
  retryLabel = 'Try again',
  className,
}: {
  message: string
  onRetry?: () => void
  retryLabel?: string
  className?: string
}) {
  return (
    <View
      accessible
      accessibilityRole="alert"
      accessibilityLabel={message}
      className={cn('gap-2.5 rounded-md border border-danger-border bg-danger-soft p-4', className)}
    >
      <Text className="text-[13px] leading-[18px] text-ink">{message}</Text>
      {onRetry ? (
        <Button
          variant="secondary"
          label={retryLabel}
          accessibilityLabel={retryLabel}
          compact
          className="self-start"
          onPress={onRetry}
        />
      ) : null}
    </View>
  )
}

/* ── Feedback ──────────────────────────────────────────────────────────────────────
 * `haptics` is a dependency and was never called, so the app gave no physical
 * confirmation for any of its actions. These are the four moments worth feeling:
 * a confirmed action, a rejection, a destructive edge, and a toggle landing. */

export async function haptic(kind: 'light' | 'medium' | 'success' | 'warn' | 'error' = 'light') {
  try {
    const Haptics = await import('expo-haptics')
    switch (kind) {
      case 'medium':
        return Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
      case 'success':
        return Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success)
      case 'warn':
        return Haptics.notificationAsync(Haptics.NotificationFeedbackType.Warning)
      case 'error':
        return Haptics.notificationAsync(Haptics.NotificationFeedbackType.Error)
      default:
        return Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light)
    }
  } catch {
    // Haptics are a nicety; never let one break an action.
  }
}

/* ── Copy ────────────────────────────────────────────────────────────────────────────
 * Copying an id or a path is a primary action in a tool like this, so it gets a
 * real control with real feedback rather than a silent long-press. */

export function CopyButton({
  value,
  label = 'Copy',
  accessibilityLabel,
}: {
  value: string
  label?: string
  accessibilityLabel?: string
}) {
  const [copied, setCopied] = React.useState(false)
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null)

  // Clear the pending reset if the component unmounts while showing "Copied".
  React.useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current)
    },
    [],
  )

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      onPress={() => {
        Clipboard.setString(value)
        setCopied(true)
        void haptic('success')
        if (timer.current) clearTimeout(timer.current)
        timer.current = setTimeout(() => setCopied(false), 1600)
      }}
      hitSlop={HIT_SLOP}
      className="min-h-8 justify-center rounded-sm px-2 active:bg-pressed"
    >
      <Text className={cn('text-[11px] font-semibold', copied ? 'text-ok' : 'text-ink-3')}>
        {copied ? 'Copied' : label}
      </Text>
    </Pressable>
  )
}

/** Read-only value with a copy affordance. For ids, hosts, fingerprints. */
export function FieldRow({ label, value }: { label: string; value: string }) {
  return (
    <View className="min-h-11 flex-row items-center justify-between gap-3">
      <Text className="text-[13px] text-ink-2">{label}</Text>
      <View className="min-w-0 flex-1 flex-row items-center justify-end gap-1">
        <Mono className="min-w-0 text-[12px] text-ink" numberOfLines={1}>
          {value}
        </Mono>
        <CopyButton value={value} label="Copy" accessibilityLabel={`Copy ${label}`} />
      </View>
    </View>
  )
}

/* ── Chrome ─────────────────────────────────────────────────────────────────────────
 * Screen headers. `ScreenHeader` is a pushed screen (it can go back);
 * `NavBar` is a root screen (it opens navigation). Two components, because
 * pretending they are the same is how you end up with a back button that goes
 * nowhere. */

export function ScreenHeader({
  title,
  subtitle,
  left,
  right,
  className,
}: {
  title: string
  subtitle?: string
  left?: React.ReactNode
  right?: React.ReactNode
  className?: string
}) {
  return (
    <View
      className={cn(
        'flex-row items-center gap-2 border-b border-line bg-chrome px-2 py-2.5',
        className,
      )}
    >
      {left}
      <View className="min-w-0 flex-1 px-1">
        <Text className="text-[17px] font-bold text-ink" numberOfLines={1} style={{ letterSpacing: -0.3 }}>
          {title}
        </Text>
        {subtitle ? (
          <Text className="mt-0.5 text-[11px] text-ink-3" numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right}
    </View>
  )
}

/** The four-square mark. Doubles as the app icon's geometry. */
export function BrandMark({ size = 22, color = palette.accent }: { size?: number; color?: string }) {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ width: size, height: size, flexDirection: 'row', flexWrap: 'wrap', gap: size * 0.11 }}
    >
      {[0, 1, 2, 3].map((index) => (
        <View
          key={index}
          style={{
            width: size * 0.445,
            height: size * 0.445,
            borderRadius: size * 0.13,
            backgroundColor: color,
            // The fourth square recedes: the mark reads as one object, not four.
            opacity: index === 3 ? 0.42 : 1,
          }}
        />
      ))}
    </View>
  )
}

/**
 * The menu button, used by every root screen.
 *
 * It lives here rather than being inlined per screen because the old code drew
 * a bespoke three-line `MenuIcon` in `ui.tsx` while the screens that actually
 * used it imported a lucide `Menu` — two different hamburger glyphs, at two
 * different sizes, in the same position.
 */
export function MenuButton({ onPress, label = 'Open navigation' }: { onPress: () => void; label?: string }) {
  return (
    <IconButton label={label} size={40} onPress={onPress} accessibilityHint="Opens the app menu">
      <MenuIcon />
    </IconButton>
  )
}

function MenuIcon() {
  return (
    <View style={{ gap: 4, width: 18 }} accessibilityElementsHidden>
      {[0, 1, 2].map((line) => (
        <View
          key={line}
          style={{
            height: 2,
            width: 18,
            borderRadius: 1,
            backgroundColor: palette.ink2,
            // Taper the lines so the glyph reads as a menu, not three rules.
            opacity: line === 1 ? 0.8 : 1,
          }}
        />
      ))}
    </View>
  )
}

/* ── Deprecated aliases ───────────────────────────────────────────────────────────
 * Thin wrappers over the primitives above, so the remaining screens keep
 * compiling while they are migrated. Every one of these is scheduled for
 * deletion; `scripts/check-legacy-ui.mjs` counts what is left so the migration
 * cannot silently stall.
 *
 * Each maps an old name to its replacement:
 *   Chip       → Badge
 *   TextField  → Field
 *   Dots       → Loading
 *   Spinner    → ActivityIndicator via Loading, or a bare spinner inline
 *   NavLabel   → Eyebrow
 *   SectionLabel → Eyebrow
 */

/** @deprecated Use `Badge`. */
export function Chip({
  tone = 'dim',
  label,
  className,
}: {
  tone?: ToneCompat
  label: string
  className?: string
}) {
  return (
    <Badge tone={compatTone(tone)} className={className}>
      {label}
    </Badge>
  )
}

/** @deprecated Use `Field`. */
export function TextField({
  leading,
  className,
  ...props
}: TextInputProps & { leading?: React.ReactNode }) {
  return <Field leading={leading} className={className} {...props} />
}

/** @deprecated Use `Loading`. */
export function Dots({ label }: { label: string }) {
  return <Loading label={label} />
}

/** @deprecated Use `Loading`, or `ActivityIndicator` with `palette.accent`. */
export function Spinner({ className }: { className?: string }) {
  return <ActivityIndicator color={palette.accent} className={className} />
}

/** @deprecated Use `Eyebrow`. */
export function NavLabel({ children, className }: { children: React.ReactNode; className?: string }) {
  return <Eyebrow className={className}>{children}</Eyebrow>
}

/** @deprecated Use `Eyebrow`. */
export function SectionLabel({ children, className }: { children: React.ReactNode; className?: string }) {
  return <Eyebrow className={className}>{children}</Eyebrow>
}

/**
 * @deprecated Use `ScreenHeader` with a `MenuButton` in its `left` slot.
 *
 * `PageHeader` bundled the menu affordance, the wordmark, and the title into one
 * component, which meant a screen could not have a header without also having a
 * menu button — which is why it was only ever used on root screens, and why the
 * pushed screens had to build their own. Composing `ScreenHeader` from explicit
 * slots removes the constraint.
 */
export function PageHeader({
  title,
  onMenu,
  wordmark,
  right,
}: {
  title?: string
  onMenu?: () => void
  wordmark?: boolean
  right?: React.ReactNode
}) {
  return (
    <ScreenHeader
      title={title ?? ''}
      left={onMenu ? <MenuButton onPress={onMenu} /> : wordmark ? <BrandMark /> : undefined}
      right={right}
    />
  )
}
