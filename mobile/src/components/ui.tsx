/**
 * Primitives — the app's entire component vocabulary.
 *
 * Everything visible is built from this file. A screen may not invent its own
 * button, badge, or card; if it needs one, it belongs here. That constraint is
 * the only reason eleven screens look like one product.
 *
 * THE V3 LANGUAGE, ENCODED HERE
 * -----------------------------
 * The look is "midnight studio": luminous type on near-black, soft-cornered
 * sheets with hairline edges, one electric accent reserved for what is
 * actionable. The rules:
 *
 * 1. **48pt minimum touch target.** Anything smaller is its visual size *plus*
 *    a `hitSlop` that grows the tappable area back to 48 without growing the
 *    visual.
 *
 * 2. **Every interactive element is named.** `accessibilityRole` and
 *    `accessibilityLabel` are required on the pressable primitives. Pass the
 *    verb ("Archive session"), not the destination.
 *
 * 3. **State is never colour alone.** `Dot` varies *size* as well as hue, and
 *    the states that need a human are drawn larger. `StatusPill` always pairs
 *    the dot with a word.
 *
 * 4. **Press feedback is a spring, not a colour swap.** See `Touchable` in
 *    `motion.tsx`.
 *
 * 5. **Tokens only.** No component in this file contains a hex literal.
 *    `scripts/check-colors.mjs` enforces it.
 *
 * DENSITY
 * -------
 * A developer control surface, not a consumer app: a `ListRow` stays ~56pt and
 * the primitives stay tight. The extra centimetres a phone buys go to
 * *hierarchy* — a status line that reads as one, a path that reads as one —
 * not to padding.
 */

import * as React from 'react'
import Clipboard from '@react-native-clipboard/clipboard'
import {
  ActivityIndicator,
  Animated,
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
import { Check, ChevronRight, Search as SearchIcon, X } from 'lucide-react-native'

import { cn } from '@/lib/format'
import {
  agentColor,
  agentSoft,
  palette,
  radius,
  shadowOverlay,
  toneBorder,
  toneClass,
  toneColor,
  toneSoft,
  type Tone,
} from '../design/tokens'
import { TOUCH_MIN, Touchable, enterStyle, popStyle, useEnter } from './motion'

export { palette, radius, toneColor, type Tone, shadowOverlay, shadowFloating } from '../design/tokens'
export { TOUCH_MIN, Skeleton, RowSkeleton, LiveHalo, usePulse, useShimmer } from './motion'
export { toast, dismissToast, ToastHost } from './Toast'

const MONO_FONT = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' })

/** Grow a small control's tappable area without changing how big it looks. */
const HIT_SLOP = { top: 8, bottom: 8, left: 8, right: 8 }

/* ── Type ──────────────────────────────────────────────────────────────────── */

type TypeRole = 'display' | 'title' | 'heading' | 'body' | 'label' | 'caption' | 'small' | 'micro' | 'mono' | 'monoSmall' | 'eyebrow'

/** The type scale, as class names. Kept in one place so it cannot drift. */
const TYPE_CLASS: Record<TypeRole, string> = {
  display: 'text-[30px] leading-[36px] font-bold',
  title: 'text-[21px] leading-[27px] font-bold',
  heading: 'text-[16.5px] leading-[22px] font-semibold',
  body: 'text-[15.5px] leading-[22px]',
  label: 'text-[15.5px] leading-[22px] font-medium',
  caption: 'text-[13.5px] leading-[19px]',
  small: 'text-[12px] leading-[16px]',
  micro: 'text-[11.5px] leading-[15px] font-medium',
  mono: 'text-[12.5px] leading-[18px]',
  monoSmall: 'text-[11px] leading-[15px] font-medium',
  eyebrow: 'text-[10px] leading-[13px] font-semibold uppercase',
}

const TYPE_TRACK: Partial<Record<TypeRole, number>> = {
  display: -0.7,
  title: -0.4,
  heading: -0.2,
  label: -0.1,
  micro: 0.1,
  eyebrow: 1.2,
}

const MONO_ROLES: TypeRole[] = ['mono', 'monoSmall', 'eyebrow']

/**
 * `Text` with the type scale applied.
 *
 * The prop is `as`, not `role`: `TextProps` already carries an ARIA `role`, and
 * shadowing it would make every `Txt` silently drop the caller's accessibility
 * role.
 */
function Txt({
  as = 'body',
  tone,
  className,
  style,
  ...props
}: TextProps & { as?: TypeRole; tone?: Tone }) {
  const track = TYPE_TRACK[as]
  return (
    <Text
      accessibilityRole={props.accessibilityRole ?? 'text'}
      {...props}
      className={cn(TYPE_CLASS[as], tone && toneClass.text[tone], 'text-ink', className)}
      style={[
        MONO_ROLES.includes(as) ? { fontFamily: MONO_FONT } : null,
        track !== undefined ? { letterSpacing: track } : null,
        style as StyleProp<TextStyle>,
      ]}
    />
  )
}

/**
 * The uppercase mono eyebrow — turns a list of cards into a document with
 * sections.
 */
export function Eyebrow({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <Text className={cn('text-[10px] leading-[13px] font-semibold uppercase text-ink-3', className)} style={{ letterSpacing: 1.2 }}>
      {children}
    </Text>
  )
}

/** Monospace, for ids, paths, hosts, hashes — anything the user may copy. */
export function Mono({ className, style, ...props }: TextProps) {
  return <Text {...props} style={[{ fontFamily: MONO_FONT }, style as StyleProp<TextStyle>]} className={cn('text-ink-3', className)} />
}

/* ── Buttons ───────────────────────────────────────────────────────────────────
 * Four variants, and the choice between them is a decision about intent:
 * `primary` is the one thing you want the user to do on this screen;
 * `secondary` is a real alternative; `ghost` is for dense chrome where a filled
 * button would shout; `danger` only ever destroys. */

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'

const BUTTON_SURFACE: Record<ButtonVariant, string> = {
  primary: 'bg-accent border border-accent',
  secondary: 'bg-raised border border-line-strong',
  ghost: 'bg-transparent border border-line',
  danger: 'bg-danger-soft border border-danger-border',
}

const BUTTON_TEXT: Record<ButtonVariant, string> = {
  primary: 'text-accent-ink font-bold',
  secondary: 'text-ink font-semibold',
  ghost: 'text-ink-2 font-semibold',
  danger: 'text-danger font-semibold',
}

const BUTTON_HEIGHT: Record<'sm' | 'md' | 'lg', number> = { sm: 36, md: 48, lg: 54 }

export function Button({
  variant = 'secondary',
  size = 'md',
  label,
  accessibilityLabel,
  icon,
  trailingIcon,
  full,
  className,
  disabled,
  style,
  ...rest
}: Omit<PressableProps, 'children' | 'style'> & {
  variant?: ButtonVariant
  size?: 'sm' | 'md' | 'lg'
  label: string
  accessibilityLabel?: string
  icon?: React.ReactNode
  trailingIcon?: React.ReactNode
  full?: boolean
  className?: string
  style?: StyleProp<ViewStyle>
}) {
  return (
    <Touchable
      // The spread comes *first* so the explicit props win. A caller's
      // `disabled` must not be able to reach the accessibility tree directly —
      // this component is what guarantees the reported state matches the real
      // one, and putting the spread last would silently undo that.
      {...rest}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? label}
      accessibilityState={{ disabled: !!disabled || undefined }}
      disabled={disabled}
      hitSlop={size === 'sm' ? HIT_SLOP : undefined}
      scaleTo={0.97}
      style={[
        {
          height: BUTTON_HEIGHT[size],
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 7,
          borderRadius: size === 'lg' ? radius.md : radius.sm,
          paddingHorizontal: size === 'sm' ? 14 : 18,
        },
        full ? { alignSelf: 'stretch', width: '100%' } : { alignSelf: 'flex-start' },
        { opacity: disabled ? 0.4 : 1 },
        style as StyleProp<ViewStyle>,
      ]}
      className={cn(BUTTON_SURFACE[variant], className)}
    >
      {icon}
      <Txt
        as={size === 'sm' ? 'small' : 'label'}
        className={cn(BUTTON_TEXT[variant])}
        numberOfLines={1}
        // The visible label is the accessible name; no need to repeat it.
        accessibilityElementsHidden
      >
        {label}
      </Txt>
      {trailingIcon}
    </Touchable>
  )
}

/**
 * A square icon button. `size` is the *visual* size; the touch target is grown
 * to `TOUCH_MIN` with `hitSlop`, so a 34pt button is still easy to hit.
 */
export function IconButton({
  label,
  size = 40,
  tone = 'muted',
  className,
  disabled,
  active,
  children,
  style,
  ...rest
}: Omit<PressableProps, 'children' | 'style'> & {
  label: string
  size?: number
  tone?: Tone
  active?: boolean
  children: React.ReactNode
  className?: string
  style?: StyleProp<ViewStyle>
}) {
  return (
    <Touchable
      // See `Button`: the spread goes first so the role, the name and the
      // reported state are always the ones this component chose.
      {...rest}
      accessibilityRole="button"
      accessibilityLabel={label}
      accessibilityState={{ disabled: !!disabled || undefined, selected: !!active }}
      disabled={disabled}
      hitSlop={{
        top: Math.max(0, (TOUCH_MIN - size) / 2),
        bottom: Math.max(0, (TOUCH_MIN - size) / 2),
        left: Math.max(0, (TOUCH_MIN - size) / 2),
        right: Math.max(0, (TOUCH_MIN - size) / 2),
      }}
      scaleTo={0.88}
      style={[
        {
          width: size,
          height: size,
          alignItems: 'center',
          justifyContent: 'center',
          borderRadius: radius.pill,
          backgroundColor: active ? toneSoft[tone] : 'transparent',
          opacity: disabled ? 0.35 : 1,
        },
        style as StyleProp<ViewStyle>,
      ]}
    >
      {children}
    </Touchable>
  )
}

/* ── Status ────────────────────────────────────────────────────────────────────
 * Colour is never the only channel: `Dot` changes size and shape per tone, and
 * every status surface ships a word. */

const DOT_SIZE: Record<Tone, number> = {
  ok: 8,
  wait: 11,
  danger: 11,
  info: 8,
  accent: 8,
  muted: 6,
}

/**
 * The status signal.
 *
 * `wait` and `danger` are drawn larger than `ok` on purpose: the states that
 * need a human are the states that should be findable while scrolling. `pulse`
 * adds a slow opacity cycle for a session actively working — motion, not
 * colour, marks "live". A *waiting-for-you* session does not pulse: it is
 * stuck on the user, and motion would imply progress that is not happening.
 */
export function Dot({ tone = 'muted', pulse }: { tone?: Tone; pulse?: boolean }) {
  const size = DOT_SIZE[tone]
  return (
    <View
      // A pulsing dot is decoration; announcing it would be noise.
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      className="rounded-full"
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: toneColor[tone],
        opacity: pulse ? 0.7 : 1,
      }}
    />
  )
}

/** A compact badge. Count, unit, or transport marker. */
export function Badge({
  tone = 'muted',
  children,
  className,
  outline,
  mono,
}: {
  tone?: Tone
  children: React.ReactNode
  className?: string
  outline?: boolean
  mono?: boolean
}) {
  return (
    <View
      className={cn(
        'h-[22px] shrink-0 flex-row items-center justify-center rounded-pill px-2',
        outline ? toneClass.border[tone] : toneClass.soft[tone],
        className,
      )}
      style={outline ? { borderWidth: 1 } : undefined}
    >
      <Text
        className={cn('text-[11px] font-semibold', mono ? 'text-[10px] uppercase' : '', toneClass.text[tone])}
        numberOfLines={1}
        style={{ letterSpacing: mono ? 0.6 : 0.1, fontFamily: mono ? MONO_FONT : undefined }}
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
  size = 'md',
}: {
  tone: Tone
  label: string
  pulse?: boolean
  className?: string
  size?: 'sm' | 'md'
}) {
  return (
    <View
      accessible
      accessibilityRole="text"
      accessibilityLabel={`Status: ${label}`}
      className={cn(
        'shrink-0 flex-row items-center rounded-pill',
        size === 'sm' ? 'h-6 gap-1.5 px-2' : 'h-7 gap-2 px-2.5',
        toneClass.soft[tone],
        className,
      )}
      style={{ borderWidth: 1, borderColor: toneBorder[tone] }}
    >
      <Dot tone={tone} pulse={pulse} />
      <Text
        className={cn('font-semibold', size === 'sm' ? 'text-[10.5px]' : 'text-[11.5px]', toneClass.text[tone])}
        numberOfLines={1}
      >
        {label}
      </Text>
    </View>
  )
}

/* ── Surfaces ────────────────────────────────────────────────────────────────────
 * One elevation model, in the order defined by the tokens: `well` is a hole,
 * `canvas` is the page, `surface` is a card, `raised` is a card on a card. */

export function Card({ className, style, tone, ...props }: ViewProps & { tone?: Tone }) {
  return (
    <View
      {...props}
      className={cn('rounded-lg border', tone ? undefined : 'border-line bg-surface', className)}
      style={[
        tone
          ? { borderColor: toneBorder[tone], backgroundColor: toneSoft[tone] }
          : undefined,
        style as StyleProp<ViewStyle>,
      ]}
    />
  )
}

/** Card with a title row. The hairline separates header from content. */
export function CardHeader({
  title,
  eyebrow,
  subtitle,
  right,
  className,
}: {
  title: string
  eyebrow?: string
  subtitle?: string
  right?: React.ReactNode
  className?: string
}) {
  return (
    <View className={cn('flex-row items-center justify-between gap-3 border-b border-line px-4 py-3.5', className)}>
      <View className="min-w-0 flex-1 gap-0.5">
        {eyebrow ? <Eyebrow>{eyebrow}</Eyebrow> : null}
        <Text className="text-[15px] leading-[20px] font-semibold text-ink" numberOfLines={1} style={{ letterSpacing: -0.15 }}>
          {title}
        </Text>
        {subtitle ? (
          <Text className="text-[12px] leading-[16px] text-ink-3" numberOfLines={2}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right}
    </View>
  )
}

/**
 * Inset well — code, logs, diffs, terminal output, a mirrored screenshot.
 *
 * A *hole* in the surface: darker than everything around it, never raised,
 * never the thing you tap. Those three properties are what make a block read
 * as "this is output, not a control", and having one component is what stops
 * five read-only surfaces from being five slightly different grey boxes.
 */
export function Well({ className, style, ...props }: ViewProps) {
  return <View {...props} className={cn('rounded-md bg-code', className)} style={style} />
}

/* ── Inputs ──────────────────────────────────────────────────────────────────────
 * Every field is 48pt, the same as `Button`, so a form built from these aligns
 * without per-screen fudging. */

export function Field({
  label,
  hint,
  error,
  leading,
  trailing,
  className,
  containerClassName,
  mono,
  ...props
}: TextInputProps & {
  label?: string
  hint?: string
  error?: string | null
  leading?: React.ReactNode
  trailing?: React.ReactNode
  className?: string
  containerClassName?: string
  mono?: boolean
}) {
  return (
    <View className={cn('gap-1.5', containerClassName)}>
      {label ? <Txt as="small" className="font-semibold text-ink-2">{label}</Txt> : null}
      <View
        className={cn(
          'min-h-12 flex-row items-center gap-2.5 rounded-md border bg-field px-3.5',
          // A field in an error state is bordered, not filled — the fill would
          // read as the value, and the border reads as "this is wrong".
          error ? 'border-danger-border' : 'border-line',
          props.multiline && 'items-start py-3',
        )}
      >
        {leading}
        <TextInput
          accessibilityLabel={props.accessibilityLabel ?? label}
          placeholderTextColor={palette.ink4}
          {...props}
          className={cn('flex-1 text-[15.5px] text-ink', mono && 'text-[13px]')}
          style={[
            { paddingVertical: 0, fontFamily: mono ? MONO_FONT : undefined },
            props.style as StyleProp<TextStyle>,
          ]}
        />
        {trailing}
      </View>
      {error ? (
        <Text className="text-[12.5px] leading-[17px] text-danger">{error}</Text>
      ) : hint ? (
        <Text className="text-[12.5px] leading-[17px] text-ink-3">{hint}</Text>
      ) : null}
    </View>
  )
}

/** The search field. Identical to `Field` but shaped and wired for one job. */
export function SearchField({
  value,
  onChangeText,
  placeholder = 'Search',
  onSubmit,
  accessibilityLabel,
  style,
}: {
  value: string
  onChangeText: (value: string) => void
  placeholder?: string
  onSubmit?: () => void
  accessibilityLabel?: string
  style?: StyleProp<ViewStyle>
}) {
  return (
    <View
      className="min-h-11 flex-row items-center gap-2.5 rounded-pill border border-line bg-field px-3.5"
      style={style as StyleProp<ViewStyle>}
    >
      <SearchIcon size={16} color={palette.ink3} />
      <TextInput
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={palette.ink4}
        accessibilityLabel={accessibilityLabel ?? placeholder}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        onSubmitEditing={onSubmit}
        clearButtonMode="while-editing"
        className="flex-1 text-[15px] text-ink"
        style={{ paddingVertical: 0 }}
      />
      {value.length > 0 ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel="Clear search"
          onPress={() => onChangeText('')}
          hitSlop={10}
        >
          <X size={15} color={palette.ink3} />
        </Pressable>
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
  leading,
}: {
  label: string
  description?: string
  value: boolean
  onChange: (next: boolean) => void
  disabled?: boolean
  leading?: React.ReactNode
}) {
  return (
    <Pressable
      accessibilityRole="switch"
      accessibilityLabel={label}
      accessibilityHint={description}
      accessibilityState={{ checked: value, disabled: !!disabled }}
      disabled={disabled}
      onPress={() => onChange(!value)}
      className="min-h-14 flex-row items-center gap-3 rounded-md px-1 py-3 active:bg-raised"
      style={{ opacity: disabled ? 0.4 : 1 }}
    >
      {leading}
      <View className="min-w-0 flex-1">
        <Text className="text-[15.5px] leading-[21px] font-medium text-ink">{label}</Text>
        {description ? (
          <Text className="mt-0.5 text-[12.5px] leading-[17px] text-ink-3">{description}</Text>
        ) : null}
      </View>
      <View
        className="h-7 w-[46px] justify-center rounded-pill px-0.5"
        style={{ backgroundColor: value ? palette.accent : palette.raised, borderWidth: 1, borderColor: value ? palette.accent : palette.lineStrong }}
      >
        <View
          className="size-[22px] rounded-full"
          style={{
            transform: [{ translateX: value ? 20 : 0 }],
            backgroundColor: value ? palette.accentInk : palette.ink3,
          }}
        />
      </View>
    </Pressable>
  )
}

/**
 * A checkbox row.
 *
 * The box carries a tick rather than being a coloured square so the *state* is
 * legible without colour, which matters because "which of these had I already
 * included" is exactly the question a multi-select is asked. `leading` exists
 * for rows whose item also has an identity — an agent avatar, say — because a
 * multi-select of otherwise identical names is a list you have to read rather
 * than scan.
 */
export function CheckRow({
  label,
  description,
  checked,
  onPress,
  disabled,
  leading,
  trailing,
}: {
  label: string
  description?: string
  checked: boolean
  onPress: () => void
  disabled?: boolean
  leading?: React.ReactNode
  trailing?: React.ReactNode
}) {
  return (
    <Pressable
      accessibilityRole="checkbox"
      accessibilityLabel={label}
      accessibilityHint={description}
      accessibilityState={{ checked, disabled: !!disabled }}
      disabled={disabled}
      onPress={onPress}
      className="min-h-12 flex-row items-center gap-3 rounded-md px-3 py-2.5 active:bg-raised"
      style={{ opacity: disabled ? 0.4 : 1 }}
    >
      <View
        className="size-5 shrink-0 items-center justify-center rounded-xs border"
        style={{
          borderColor: checked ? palette.accent : palette.lineStrong,
          backgroundColor: checked ? palette.accent : 'transparent',
        }}
      >
        {checked ? <Check size={13} color={palette.accentInk} strokeWidth={3} /> : null}
      </View>
      {leading}
      <View className="min-w-0 flex-1">
        <Text className="text-[14.5px] leading-[19px] font-medium text-ink" numberOfLines={1}>
          {label}
        </Text>
        {description ? (
          <Text className="mt-0.5 text-[12.5px] leading-[17px] text-ink-3" numberOfLines={2}>
            {description}
          </Text>
        ) : null}
      </View>
      {trailing}
    </Pressable>
  )
}

/* ── Selection controls ──────────────────────────────────────────────────────────
 * Two components, on purpose. `Segmented` is for 2–4 mutually exclusive options
 * that all fit and are all equally likely — a viewport, a density. Above that,
 * or when one option is much more likely than the others, it becomes a
 * scrolling `FilterChips` row, because a segmented control that has to shrink
 * its labels to fit is lying about the options. */

export function Segmented<T extends string>({
  options,
  value,
  onChange,
  label,
  className,
  size = 'md',
}: {
  options: Array<{ value: T; label: string; badge?: string | number }>
  value: T
  onChange: (value: T) => void
  label?: string
  className?: string
  size?: 'sm' | 'md'
}) {
  return (
    <View
      accessibilityRole="tablist"
      accessibilityLabel={label}
      className={cn('flex-row gap-1 rounded-pill border border-line bg-field p-1', className)}
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
              'flex-1 flex-row items-center justify-center gap-1.5 rounded-pill',
              size === 'sm' ? 'h-8' : 'h-10',
              active ? 'bg-raised' : 'active:bg-raised/60',
            )}
          >
            <Text
              className={cn('text-[13px]', active ? 'font-semibold text-ink' : 'font-medium text-ink-3')}
              numberOfLines={1}
            >
              {option.label}
            </Text>
            {option.badge !== undefined && option.badge !== 0 ? (
              <View
                className="min-w-[18px] items-center justify-center rounded-pill px-1"
                style={{ height: 18, backgroundColor: active ? palette.accent : palette.raised }}
              >
                <Text
                  className="text-[10px] font-bold"
                  style={{ color: active ? palette.accentInk : palette.ink2 }}
                >
                  {option.badge}
                </Text>
              </View>
            ) : null}
          </Pressable>
        )
      })}
    </View>
  )
}

/**
 * A horizontally scrolling filter row, for more options than fit.
 *
 * The count rides along because a filter without a count is a guess: "Needs
 * you" is a statement about the whole system, and the number beside it is what
 * makes it actionable — "3 need you" tells you whether it is worth looking.
 */
export function FilterChips<T extends string>({
  options,
  value,
  onChange,
  label,
  className,
}: {
  options: Array<{ value: T; label: string; count?: number; tone?: Tone }>
  value: T
  onChange: (value: T) => void
  label?: string
  className?: string
}) {
  return (
    <View accessibilityRole="tablist" accessibilityLabel={label} className={cn('flex-row', className)}>
      {options.map((option) => {
        const active = option.value === value
        return (
          <Pressable
            key={option.value}
            accessibilityRole="tab"
            accessibilityLabel={
              option.count === undefined ? option.label : `${option.label}, ${option.count}`
            }
            accessibilityState={{ selected: active }}
            onPress={() => onChange(option.value)}
            className="mr-2 min-h-9 flex-row items-center gap-1.5 rounded-pill border px-3.5"
            style={{
              borderColor: active ? palette.accentBorder : palette.line,
              backgroundColor: active ? palette.accentSoft : 'transparent',
            }}
          >
            <Text
              className="text-[13px]"
              style={{
                color: active ? palette.accent : palette.ink2,
                fontWeight: active ? '700' : '500',
              }}
            >
              {option.label}
            </Text>
            {option.count !== undefined ? (
              <Text
                style={{
                  color: active ? palette.accent : palette.ink3,
                  fontSize: 11,
                  fontWeight: '600',
                  fontVariant: ['tabular-nums'],
                }}
              >
                {option.count}
              </Text>
            ) : null}
          </Pressable>
        )
      })}
    </View>
  )
}

/* ── List rows ────────────────────────────────────────────────────────────────────
 * `ListRow` is the single most repeated shape in the app: one component, so
 * every list in every screen has the same tap target, the same two-line rhythm,
 * and the same selected treatment.
 *
 * It is deliberately the *plain* row. A session row is `SessionRow` in
 * `session/SessionRow.tsx`, which adds a status stripe, a swipe action set and
 * an agent avatar — and folding that in here would mean every unrelated list
 * (routes, keys, branch names) carried machinery it does not need. When a row
 * needs one of those, compose `ListRow` rather than forking it.
 */

export function ListRow({
  title,
  subtitle,
  meta,
  leading,
  trailing,
  onPress,
  onLongPress,
  selected,
  disabled,
  className,
  accessibilityLabel,
  accessibilityHint,
  dense,
  style,
}: {
  title: string
  subtitle?: string
  meta?: string
  leading?: React.ReactNode
  trailing?: React.ReactNode
  onPress?: () => void
  onLongPress?: () => void
  selected?: boolean
  disabled?: boolean
  dense?: boolean
  className?: string
  accessibilityLabel?: string
  accessibilityHint?: string
  style?: StyleProp<ViewStyle>
}) {
  const body = (
    <View
      className={cn(
        'min-h-14 flex-row items-center gap-3 px-4',
        dense ? 'py-2' : 'py-3',
        selected && 'bg-accent-soft',
        disabled && 'opacity-40',
      )}
    >
      {leading}
      <View className="min-w-0 flex-1">
        <Text className="text-[15.5px] leading-[21px] font-medium text-ink" numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Mono className="mt-0.5 text-[11.5px] leading-[15px]" numberOfLines={1}>
            {subtitle}
          </Mono>
        ) : null}
      </View>
      {meta ? (
        <Mono className="shrink-0 text-[11px]" numberOfLines={1}>
          {meta}
        </Mono>
      ) : null}
      {trailing}
    </View>
  )

  if (!onPress && !onLongPress) return body

  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel ?? title}
      accessibilityHint={accessibilityHint ?? subtitle}
      accessibilityState={{ selected: !!selected, disabled: !!disabled }}
      onPress={onPress}
      onLongPress={onLongPress}
      disabled={disabled}
      className={cn('active:bg-raised', className)}
      style={style as StyleProp<ViewStyle>}
    >
      {body}
    </Pressable>
  )
}

/** A hairline that respects the card it divides. */
export function Divider({ className, inset = 0 }: { className?: string; inset?: number }) {
  return <View className={cn('h-px bg-line', className)} style={{ marginLeft: inset }} />
}

/* ── Agent identity ────────────────────────────────────────────────────────────────
 * The letter avatar. It is the one piece of identity the app can always draw
 * without asking the network, so it is the anchor of every session row. */

export function AgentAvatar({ agent, size = 36, name }: { agent: string; size?: number; name?: string }) {
  const initial = (name ?? agent ?? '?').trim().charAt(0).toUpperCase() || '?'
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      className="items-center justify-center"
      style={{
        width: size,
        height: size,
        borderRadius: size / 2,
        backgroundColor: agentSoft(agent),
        borderWidth: 1,
        borderColor: `${agentColor(agent)}44`,
      }}
    >
      <Text style={{ color: agentColor(agent), fontSize: size * 0.42, fontWeight: '700' }}>{initial}</Text>
    </View>
  )
}

/** A rounded-square icon tile — the second-tier identity mark (features, tools). */
export function IconTile({
  icon,
  tone = 'accent',
  size = 38,
}: {
  icon: React.ReactNode
  tone?: Tone
  size?: number
}) {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      className="items-center justify-center"
      style={{ width: size, height: size, borderRadius: size * 0.31, backgroundColor: toneSoft[tone] }}
    >
      {icon}
    </View>
  )
}

/**
 * A "goes somewhere" chevron.
 *
 * It is drawn at `ink4`, one step below the label's own colour, because a
 * chevron is an affordance rather than content: at full contrast it competes
 * with the row's title for the eye, which is backwards.
 */
export function Chevron() {
  return <ChevronRight size={17} color={palette.ink4} />
}

/* ── Read-outs ──────────────────────────────────────────────────────────────────────
 * Numbers are `tabular-nums` and abbreviated, exactly as on the desktop. An
 * unaligned digit column makes a runtime or a token count unreadable. */

/** `12.4k` / `1.2M` — the desktop's abbreviation, so both surfaces agree. */
export function formatCount(n: number): string {
  if (!Number.isFinite(n)) return '—'
  const abs = Math.abs(n)
  if (abs >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (abs >= 10_000) return `${Math.round(n / 1000)}k`
  if (abs >= 1_000) return `${(n / 1000).toFixed(1)}k`
  return String(Math.round(n))
}

export function formatCost(cost: number): string {
  if (!Number.isFinite(cost) || cost <= 0) return '—'
  return cost < 0.01 ? '< $0.01' : `$${cost.toFixed(2)}`
}

/** A big figure over a small caps label. The desktop's `Stat`. */
export function Stat({
  label,
  value,
  tone,
  align = 'left',
}: {
  label: string
  value: string
  tone?: Tone
  align?: 'left' | 'center' | 'right'
}) {
  return (
    <View style={{ flex: 1, alignItems: align === 'left' ? 'flex-start' : align === 'right' ? 'flex-end' : 'center', gap: 3 }}>
      <Eyebrow>{label}</Eyebrow>
      <Text
        className={cn('text-[22px] font-semibold', tone && toneClass.text[tone])}
        style={{ letterSpacing: -0.5, fontVariant: ['tabular-nums'] }}
        numberOfLines={1}
      >
        {value}
      </Text>
    </View>
  )
}

/** A determinate progress bar. 3pt, because a thicker bar competes with text. */
export function ProgressBar({
  value,
  tone = 'accent',
  className,
}: {
  /** 0–1. Values outside are clamped, because a session's step count is data. */
  value: number
  tone?: Tone
  className?: string
}) {
  const clamped = Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0))
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      className={cn('h-[3px] overflow-hidden rounded-pill bg-raised', className)}
    >
      <View
        style={{
          width: `${Math.max(1.5, clamped * 100)}%`,
          height: '100%',
          borderRadius: 999,
          backgroundColor: toneColor[tone],
        }}
      />
    </View>
  )
}

/** A label/value pair, for read-only data. */
export function KeyValue({
  label,
  value,
  mono = true,
  tone,
}: {
  label: string
  value: string
  mono?: boolean
  tone?: Tone
}) {
  return (
    <View className="min-h-8 flex-row items-center justify-between gap-3">
      <Text className="text-[13.5px] text-ink-2" numberOfLines={1}>
        {label}
      </Text>
      <Text
        className={cn('shrink-0 text-[13px] text-ink', tone && toneClass.text[tone])}
        style={mono ? { fontFamily: MONO_FONT } : undefined}
        numberOfLines={1}
      >
        {value}
      </Text>
    </View>
  )
}

/* ── States ──────────────────────────────────────────────────────────────────────────
 * Loading, empty, and error are first-class screens, not afterthoughts. Each one
 * says what happened and what to do next — an empty state with no action is a
 * dead end. */

export function Loading({ label = 'Loading' }: { label?: string }) {
  return (
    <View accessible accessibilityLabel={label} className="items-center justify-center gap-3 py-12">
      <ActivityIndicator color={palette.accent} />
      <Text className="text-[13px] text-ink-3">{label}</Text>
    </View>
  )
}

export function EmptyState({
  title,
  body,
  action,
  icon,
  compact,
}: {
  title: string
  body?: string
  action?: React.ReactNode
  icon?: React.ReactNode
  compact?: boolean
}) {
  const enter = useEnter(0, false)
  return (
    <View
      accessible
      accessibilityLabel={body ? `${title}. ${body}` : title}
      className="items-center justify-center gap-2.5 px-8"
      style={{ paddingVertical: compact ? 24 : 48 }}
    >
      {icon ? (
        <View
          style={[
            {
              width: 54,
              height: 54,
              borderRadius: radius.lg,
              backgroundColor: palette.raised,
              borderWidth: 1,
              borderColor: palette.line,
              alignItems: 'center',
              justifyContent: 'center',
            },
            enterStyle(enter, 6),
          ]}
        >
          {icon}
        </View>
      ) : null}
      <Text className="text-center text-[16px] leading-[21px] font-semibold text-ink" style={{ letterSpacing: -0.2 }}>
        {title}
      </Text>
      {body ? (
        <Text className="max-w-[40ch] text-center text-[13.5px] leading-[19px] text-ink-3">{body}</Text>
      ) : null}
      {action ? <View style={{ marginTop: 8 }}>{action}</View> : null}
    </View>
  )
}

/**
 * An error the user can act on. `retry` is not optional-by-accident: if an
 * operation failed and the user can do anything about it, they get a button.
 */
export function ErrorState({
  message,
  detail,
  onRetry,
  retryLabel = 'Try again',
  className,
}: {
  message: string
  detail?: string
  onRetry?: () => void
  retryLabel?: string
  className?: string
}) {
  return (
    <View
      accessible
      accessibilityRole="alert"
      accessibilityLabel={message}
      className={cn('gap-2.5 rounded-lg border border-danger-border bg-danger-soft p-4', className)}
    >
      <Text className="text-[14px] leading-[19px] font-semibold text-ink">{message}</Text>
      {detail ? (
        <Text className="text-[13px] leading-[18px] text-ink-2">{detail}</Text>
      ) : null}
      {onRetry ? (
        <Button variant="secondary" size="sm" label={retryLabel} onPress={onRetry} />
      ) : null}
    </View>
  )
}

/** An inline notice strip — for "saved", "not applied until restart", etc. */
export function Notice({
  message,
  tone = 'info',
  action,
  className,
}: {
  message: string
  tone?: Tone
  action?: { label: string; onPress: () => void; busy?: boolean }
  className?: string
}) {
  return (
    <View
      accessible
      accessibilityRole="alert"
      className={cn('flex-row items-center gap-2.5 rounded-md border px-3 py-2.5', className)}
      style={{ borderColor: toneBorder[tone], backgroundColor: toneSoft[tone] }}
    >
      <Text className="min-w-0 flex-1 text-[13px] leading-[18px]" style={{ color: toneColor[tone] }}>
        {message}
      </Text>
      {action ? (
        <Pressable
          accessibilityRole="button"
          accessibilityLabel={action.label}
          onPress={action.onPress}
          disabled={action.busy}
          hitSlop={HIT_SLOP}
          className="min-h-8 items-center justify-center rounded-sm px-2.5 active:bg-raised"
          style={{ backgroundColor: palette.raised, opacity: action.busy ? 0.5 : 1 }}
        >
          <Text className="text-[12.5px] font-semibold text-ink">{action.busy ? 'Working…' : action.label}</Text>
        </Pressable>
      ) : null}
    </View>
  )
}

/* ── Feedback ─────────────────────────────────────────────────────────────────────────
 * `expo-haptics` is a dependency, and the app previously gave no physical
 * confirmation for any action. These are the moments worth feeling: a
 * confirmed action, a rejection, a destructive edge, and a toggle landing. */

export async function haptic(
  kind: 'light' | 'medium' | 'heavy' | 'success' | 'warn' | 'error' | 'select' = 'light',
): Promise<void> {
  try {
    const Haptics = await import('expo-haptics')
    switch (kind) {
      case 'medium':
        return Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium)
      case 'heavy':
        return Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Heavy)
      case 'select':
        return Haptics.selectionAsync()
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

/* ── Copy ─────────────────────────────────────────────────────────────────────────────
 * Copying an id or a path is a primary action in a tool like this, so it gets a
 * real control with real feedback rather than a silent long-press. */

export function CopyButton({
  value,
  label = 'Copy',
  accessibilityLabel,
  icon,
}: {
  value: string
  label?: string
  accessibilityLabel?: string
  icon?: boolean
}) {
  const [copied, setCopied] = React.useState(false)
  const timer = React.useRef<ReturnType<typeof setTimeout> | null>(null)

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
      className="min-h-9 flex-row items-center gap-1.5 rounded-sm px-2 active:bg-raised"
      style={copied ? { backgroundColor: palette.okSoft } : undefined}
    >
      {copied ? <Check size={13} color={palette.ok} strokeWidth={2.6} /> : icon ? <Txt as="small">⧉</Txt> : null}
      <Text className="text-[12.5px] font-semibold" style={{ color: copied ? palette.ok : palette.ink3 }}>
        {copied ? 'Copied' : label}
      </Text>
    </Pressable>
  )
}

/** Read-only value with a copy affordance. For ids, hosts, fingerprints. */
export function FieldRow({ label, value }: { label: string; value: string }) {
  return (
    <View className="min-h-11 flex-row items-center justify-between gap-3">
      <Text className="text-[13.5px] text-ink-2" numberOfLines={1}>
        {label}
      </Text>
      <View className="min-w-0 flex-1 flex-row items-center justify-end gap-1">
        <Mono className="min-w-0 text-[12px] text-ink" numberOfLines={1}>
          {value}
        </Mono>
        <CopyButton value={value} label="Copy" accessibilityLabel={`Copy ${label}`} />
      </View>
    </View>
  )
}

/* ── Brand ──────────────────────────────────────────────────────────────────────────── */

/**
 * The kiln mark. Three fired slabs stacked with the ember on top — heat
 * rises. Doubles as the app icon's geometry.
 */
export function BrandMark({ size = 24, color = palette.accent }: { size?: number; color?: string }) {
  return (
    <View
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
      style={{ width: size, height: size, justifyContent: 'center', gap: size * 0.12 }}
    >
      {[1, 0.62, 0.34].map((opacity, index) => (
        <View
          key={index}
          style={{
            width: index === 0 ? size : size * (0.78 - index * 0.1),
            height: size * 0.2,
            borderRadius: size * 0.1,
            backgroundColor: color,
            opacity,
            alignSelf: index === 0 ? 'stretch' : 'center',
          }}
        />
      ))}
    </View>
  )
}

/* ── Popover ──────────────────────────────────────────────────────────────────────────
 * A small anchored card that scales in. Used for a context ring's breakdown and
 * for a menu that must appear *over* content rather than covering it. */

export function Popover({
  children,
  className,
  style,
}: {
  children: React.ReactNode
  className?: string
  style?: StyleProp<ViewStyle>
}) {
  const enter = useEnter(0, false)
  return (
    <Animated.View
      className={cn('rounded-lg border border-line-strong bg-raised p-3', className)}
      style={[popStyle(enter), shadowOverlay, style]}
    >
      {children}
    </Animated.View>
  )
}
