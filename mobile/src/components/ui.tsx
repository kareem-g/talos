/**
 * Shared RN UI primitives — the NativeWind counterpart to the desktop
 * `components/ui.tsx`.
 *
 * Names, tones, and proportions are copied from the desktop so a component that
 * reads as a "Chip" or a "StatusPill" there reads the same here: the same 7px
 * dot, the same tint-per-tone chip, the same `SectionLabel` and rail micro-label
 * typography. Two deliberate native deviations, both from the repo's own mobile
 * phase notes:
 *
 *   - touch targets are at least 44px tall (the desktop's 36px buttons are
 *     hover-sized, not thumb-sized);
 *   - `Mono` resolves a real monospace family per platform, because the desktop's
 *     JetBrains Mono is not bundled on device and `font-mono` alone falls back to
 *     the proportional system face on iOS.
 *
 * Colors come from the Tailwind tokens in tailwind.config.js (mirrored from the
 * desktop theme), so `bg-surface`, `text-ink`, `border-line` and the status hues
 * are literally the same values as the desktop control station.
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
  type TextInputProps,
  type TextProps,
  type ViewProps,
} from 'react-native'
import { cn } from '@/lib/format'
import { GlassSurface } from './Glass'

// Re-exported so screens have one import site for the primitive set.
export { GlassSurface, GlassGroup, GLASS } from './Glass'

export type Tone = 'green' | 'orange' | 'red' | 'dim' | 'accent'

const TONE_DOT: Record<Tone, string> = {
  green: 'bg-green',
  orange: 'bg-orange',
  red: 'bg-red',
  dim: 'bg-ink-3',
  accent: 'bg-accent',
}

const TONE_TEXT: Record<Tone, string> = {
  green: 'text-green',
  orange: 'text-orange',
  red: 'text-red',
  dim: 'text-ink-3',
  accent: 'text-accent',
}

/** Desktop mono stack, resolved per platform (JetBrains Mono is not bundled). */
const MONO_FONT = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' })

/** Monospace text — ids, hosts, paths, timestamps, counts. */
export function Mono({ className, style, ...props }: TextProps) {
  return <Text {...props} style={[{ fontFamily: MONO_FONT }, style]} className={cn('text-ink-3', className)} />
}

/* ── Buttons ─────────────────────────────────────────────────────────────── */

type ButtonVariant = 'primary' | 'surface' | 'ghost' | 'danger'

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-accent border border-accent active:bg-accent-hover',
  surface: 'bg-surface border border-line active:bg-hover',
  ghost: 'bg-transparent border border-line active:bg-hover',
  danger: 'bg-red-tint border border-red-border active:bg-red/20',
}
const BUTTON_TEXT: Record<ButtonVariant, string> = {
  primary: 'text-accent-ink font-semibold',
  surface: 'text-ink',
  ghost: 'text-ink-2',
  danger: 'text-red',
}

export function Button({
  variant = 'surface',
  label,
  className,
  disabled,
  ...props
}: PressableProps & { variant?: ButtonVariant; label: string }) {
  return (
    <Pressable
      accessibilityRole="button"
      disabled={disabled}
      className={cn(
        'min-h-11 flex-row items-center justify-center gap-1.5 rounded-control px-3.5',
        BUTTON_VARIANTS[variant],
        disabled && 'opacity-40',
        className,
      )}
      {...props}
    >
      <Text className={cn('text-[13px] font-medium', BUTTON_TEXT[variant])} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  )
}

/** Round icon button — desktop `IconButton` (36px there, 40px for thumbs here). */
export function IconButton({
  label,
  className,
  children,
  ...props
}: PressableProps & { label: string; children: React.ReactNode }) {
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      className={cn('size-10 items-center justify-center rounded-full active:bg-hover-2', className)}
      {...props}
    >
      {children}
    </Pressable>
  )
}

/* ── Status ──────────────────────────────────────────────────────────────── */

/** The 7px signal dot. `pulse` dims it — the desktop breathes it; native
 *  animation is reserved for genuinely live work. */
export function Dot({ tone = 'dim', pulse }: { tone?: Tone; pulse?: boolean }) {
  return (
    <View
      className={cn('size-[7px] rounded-full', TONE_DOT[tone], pulse && 'opacity-70')}
      accessibilityElementsHidden
    />
  )
}

/** Desktop `Chip`: tinted background, text-only colour, 22px tall. */
export function Chip({
  tone = 'dim',
  label,
  className,
}: {
  tone?: Tone
  label: string
  className?: string
}) {
  const tint =
    tone === 'green'
      ? 'bg-green-tint'
      : tone === 'red'
        ? 'bg-red-tint'
        : tone === 'orange'
          ? 'bg-orange-tint'
          : tone === 'accent'
            ? 'bg-accent-tint'
            : 'bg-field'
  return (
    <View className={cn('h-[22px] shrink-0 flex-row items-center justify-center rounded-md px-1.5', tint, className)}>
      <Text className={cn('text-[11.5px] font-medium', TONE_TEXT[tone])} numberOfLines={1}>
        {label}
      </Text>
    </View>
  )
}

/** Desktop `StatusPill`: dot + label inside a hairline capsule. */
export function StatusPill({
  tone,
  label,
  pulse,
  className,
}: {
  tone: Tone
  label: string
  pulse?: boolean
  className?: string
}) {
  return (
    <View
      className={cn(
        'h-6 shrink-0 flex-row items-center gap-1.5 rounded-chip border border-line bg-surface px-2',
        className,
      )}
    >
      <Dot tone={tone} pulse={pulse} />
      <Text className={cn('text-[11px] font-medium', TONE_TEXT[tone])} numberOfLines={1}>
        {label}
      </Text>
    </View>
  )
}

/* ── Structure ───────────────────────────────────────────────────────────── */

/** Desktop panel: `rounded-xl border border-line bg-surface`. */
export function Card({ className, ...props }: ViewProps) {
  return <View className={cn('rounded-xl border border-line bg-surface', className)} {...props} />
}

/** Card header row — title left, action right, hairline beneath. */
export function CardHeader({
  title,
  right,
  className,
}: {
  title: string
  right?: React.ReactNode
  className?: string
}) {
  return (
    <View className={cn('flex-row items-center justify-between border-b border-line px-3.5 py-2.5', className)}>
      <Text className="text-[12.5px] font-medium text-ink" numberOfLines={1}>
        {title}
      </Text>
      {right}
    </View>
  )
}

/** Desktop `SectionLabel` — small caps above a group of rows. */
export function SectionLabel({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <Text className={cn('px-2.5 pb-1 pt-2.5 text-[10.5px] font-medium uppercase tracking-wider text-ink-3', className)}>
      {children}
    </Text>
  )
}

/** Desktop rail micro-label: mono, 9px, wide tracking. */
export function NavLabel({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <Mono className={cn('px-3 pb-1 pt-3 text-[9px] uppercase tracking-[0.18em] text-ink-3', className)}>
      {children}
    </Mono>
  )
}

/** Desktop section eyebrow + title + description (StationHome's SectionHeading). */
export function SectionHeading({
  eyebrow,
  title,
  description,
}: {
  eyebrow: string
  title: string
  description?: string
}) {
  return (
    <View className="gap-1">
      <Mono className="text-[10.5px] uppercase tracking-[0.16em] text-ink-3">{eyebrow}</Mono>
      <Text className="text-[20px] font-semibold tracking-tight text-ink">{title}</Text>
      {description ? <Text className="text-[12.5px] leading-5 text-ink-2">{description}</Text> : null}
    </View>
  )
}

/** Desktop `Row` — a tappable list row with primary + secondary lines. */
export function Row({
  primary,
  secondary,
  leading,
  trailing,
  onPress,
  selected,
  disabled,
  className,
}: {
  primary: string
  secondary?: string
  leading?: React.ReactNode
  trailing?: React.ReactNode
  onPress?: () => void
  selected?: boolean
  disabled?: boolean
  className?: string
}) {
  return (
    <Pressable
      accessibilityRole={onPress ? 'button' : undefined}
      onPress={onPress}
      disabled={disabled || !onPress}
      className={cn(
        'min-h-11 flex-row items-center gap-2 rounded-control px-2.5 py-1.5',
        selected && 'bg-accent-tint',
        // Dim only a genuinely disabled row: a row with no `onPress` is static
        // information, not an unavailable action.
        disabled && 'opacity-55',
        onPress && !disabled && 'active:bg-hover-2',
        className,
      )}
    >
      {leading}
      <View className="min-w-0 flex-1">
        <Text className="text-[13px] text-ink" numberOfLines={1}>
          {primary}
        </Text>
        {secondary ? (
          <Text className="mt-0.5 text-[11.5px] text-ink-3" numberOfLines={1}>
            {secondary}
          </Text>
        ) : null}
      </View>
      {trailing}
    </Pressable>
  )
}

/** Desktop `TextField` — hairline field with an optional leading icon. */
export function TextField({
  leading,
  className,
  ...props
}: TextInputProps & { leading?: React.ReactNode }) {
  return (
    <View className="min-h-11 flex-row items-center gap-2 rounded-xl border border-line bg-field px-3">
      {leading}
      <TextInput
        className={cn('flex-1 py-2.5 text-[13px] text-ink', className)}
        placeholderTextColor="#7e7e86"
        {...props}
      />
    </View>
  )
}

/** Desktop `Segmented` — the filter tablist (All / Active / Attention / …). */
export function Segmented<T extends string>({
  options,
  value,
  onChange,
}: {
  options: Array<{ value: T; label: string }>
  value: T
  onChange: (value: T) => void
}) {
  return (
    <View className="flex-row gap-0.5 rounded-xl border border-line bg-surface p-0.5">
      {options.map((option) => {
        const active = option.value === value
        return (
          <Pressable
            key={option.value}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            onPress={() => onChange(option.value)}
            className={cn(
              'min-h-8 flex-1 items-center justify-center rounded-lg px-2.5',
              active ? 'border border-line bg-hover' : 'border border-transparent',
            )}
          >
            <Text className={cn('text-[11.5px]', active ? 'text-ink' : 'text-ink-3')} numberOfLines={1}>
              {option.label}
            </Text>
          </Pressable>
        )
      })}
    </View>
  )
}

/** Desktop `Dots` — three breathing dots with a label, used for loading rows. */
export function Dots({ label }: { label: string }) {
  return (
    <View className="flex-row items-center gap-2">
      <View className="flex-row gap-1">
        {[0, 1, 2].map((index) => (
          <View
            key={index}
            className="size-1 rounded-full bg-ink-3"
            style={{ opacity: 0.35 + index * 0.2 }}
          />
        ))}
      </View>
      <Text className="text-[11.5px] text-ink-3">{label}</Text>
    </View>
  )
}

export function EmptyState({ title, body }: { title: string; body?: string }) {
  return (
    <View className="items-center justify-center gap-1.5 px-8 py-14">
      <Text className="text-center text-[13px] font-medium text-ink">{title}</Text>
      {body ? <Text className="max-w-80 text-center text-[12px] leading-5 text-ink-3">{body}</Text> : null}
    </View>
  )
}

/** A single machine-readable value with a copy affordance — the desktop shows
 *  hosts and origins this way in the Remote screen. */
export function FieldRow({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row items-center justify-between gap-3">
      <Text className="text-[12.5px] text-ink-2">{label}</Text>
      <Mono className="max-w-[65%] text-[12px] text-ink" numberOfLines={1}>
        {value}
      </Mono>
    </View>
  )
}

/** Desktop `ScreenHeader`. Kept for the pushed (non-drawer) screens. */
export function ScreenHeader({
  title,
  subtitle,
  left,
  right,
}: {
  title: string
  subtitle?: string
  left?: React.ReactNode
  right?: React.ReactNode
}) {
  return (
    <GlassSurface radius={0} className="border-b border-line">
      <View className="flex-row items-center gap-3 px-4 py-3">
        {left}
        <View className="flex-1">
          <Text className="text-[17px] font-semibold text-ink" numberOfLines={1}>
            {title}
          </Text>
          {subtitle ? (
            <Mono className="mt-0.5 text-[11.5px]" numberOfLines={1}>
              {subtitle}
            </Mono>
          ) : null}
        </View>
        {right}
      </View>
    </GlassSurface>
  )
}

/** Desktop app-shell header (h-14): menu affordance left, wordmark, actions right. */
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
    <GlassSurface radius={0} className="border-b border-line">
      <View className="h-14 flex-row items-center gap-3 px-3">
      {onMenu ? (
        <IconButton label="Menu" onPress={onMenu}>
          <MenuIcon />
        </IconButton>
      ) : null}
      {wordmark ? <BrandMark /> : null}
      {title ? (
        <Text className="flex-1 text-[15px] font-semibold text-ink" numberOfLines={1}>
          {title}
        </Text>
      ) : (
        <View className="flex-1" />
      )}
      {right}
      </View>
    </GlassSurface>
  )
}

/** The four-square AgentDeck mark, matching the desktop BrandMark. */
export function BrandMark({ size = 20, color = '#5b8def' }: { size?: number; color?: string }) {
  return (
    <View className="flex-row flex-wrap" style={{ width: size, height: size, gap: size * 0.12 }}>
      {[0, 1, 2, 3].map((index) => (
        <View
          key={index}
          style={{
            width: size * 0.44,
            height: size * 0.44,
            borderRadius: size * 0.12,
            backgroundColor: color,
            opacity: index === 3 ? 0.45 : 1,
          }}
        />
      ))}
    </View>
  )
}

function MenuIcon() {
  return (
    <View className="gap-1">
      {[0, 1, 2].map((index) => (
        <View key={index} className="h-0.5 w-4 rounded-full bg-ink-2" />
      ))}
    </View>
  )
}

/** Desktop `CopyButton`: shows "Copied" for 1.4s after a successful copy. */
export function CopyButton({ value, label = 'Copy' }: { value: string; label?: string }) {
  const [copied, setCopied] = React.useState(false)
  return (
    <Pressable
      accessibilityRole="button"
      accessibilityLabel={label}
      onPress={() => {
        Clipboard.setString(value)
        setCopied(true)
        setTimeout(() => setCopied(false), 1400)
      }}
      className="h-6 shrink-0 justify-center rounded-md px-1.5 active:bg-hover-2"
    >
      <Text className="text-[11px] text-ink-3">{copied ? 'Copied' : label}</Text>
    </Pressable>
  )
}

export function Spinner({ className }: { className?: string }) {
  return <ActivityIndicator color="#5b8def" className={className} />
}
