/**
 * Shared RN UI primitives — iOS 26 design system.
 *
 * Redesigned from scratch following Apple's Human Interface Guidelines and
 * WWDC Designing Fluid Interfaces principles:
 *
 *   - Typography uses size-specific tracking (tighter large text, looser small)
 *   - Touch targets are 44px minimum for thumbs
 *   - Glass chrome floats over content; cards stay solid for legibility
 *   - Buttons respond on press-down, not release (active: states)
 *   - Material weight encodes hierarchy: heavier blur = structural regions
 *   - Hairlines are rgba white at low opacity so they recede under glass
 *   - Radii match iOS conventions: 20px cards, pill controls
 *
 * Colors come from tailwind.config.js tokens, which are evolved from the
 * desktop dashboard to feel native on iPhone.
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

const MONO_FONT = Platform.select({ ios: 'Menlo', android: 'monospace', default: 'monospace' })

/** Monospace text — ids, hosts, paths, timestamps, counts. */
export function Mono({ className, style, ...props }: TextProps) {
  return <Text {...props} style={[{ fontFamily: MONO_FONT }, style]} className={cn('text-ink-3', className)} />
}

/* ── Buttons ─────────────────────────────────────────────────────────────── */

type ButtonVariant = 'primary' | 'surface' | 'ghost' | 'danger'

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-accent active:bg-accent-hover',
  surface: 'bg-surface border border-line-strong active:bg-hover',
  ghost: 'bg-transparent active:bg-hover-2',
  danger: 'bg-red-tint border border-red-border active:bg-red/20',
}
const BUTTON_TEXT: Record<ButtonVariant, string> = {
  primary: 'text-accent-ink font-semibold',
  surface: 'text-ink font-medium',
  ghost: 'text-ink-2',
  danger: 'text-red font-medium',
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
        'min-h-[44px] flex-row items-center justify-center gap-1.5 rounded-control px-4',
        BUTTON_VARIANTS[variant],
        disabled && 'opacity-30',
        className,
      )}
      {...props}
    >
      <Text className={cn('text-[14px]', BUTTON_TEXT[variant])} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  )
}

/** Round icon button — 44px touch target for thumbs. */
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
      className={cn('size-11 items-center justify-center rounded-full active:bg-hover-2', className)}
      {...props}
    >
      {children}
    </Pressable>
  )
}

/* ── Status ──────────────────────────────────────────────────────────────── */

/** Signal dot — 6px for compact rows, used with status indicators. */
export function Dot({ tone = 'dim', pulse }: { tone?: Tone; pulse?: boolean }) {
  return (
    <View
      className={cn('size-1.5 rounded-full', TONE_DOT[tone], pulse && 'opacity-60')}
      accessibilityElementsHidden
    />
  )
}

/** Chip — tinted capsule with text-only colour, 24px tall for readability. */
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
    <View className={cn('h-6 shrink-0 flex-row items-center justify-center rounded-chip px-2', tint, className)}>
      <Text className={cn('text-[11px] font-semibold tracking-wide', TONE_TEXT[tone])} numberOfLines={1}>
        {label}
      </Text>
    </View>
  )
}

/** StatusPill — dot + label inside a glass-ready capsule. */
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
        'h-7 shrink-0 flex-row items-center gap-1.5 rounded-chip border border-line bg-surface/80 px-2.5',
        className,
      )}
    >
      <Dot tone={tone} pulse={pulse} />
      <Text className={cn('text-[11px] font-semibold tracking-wide', TONE_TEXT[tone])} numberOfLines={1}>
        {label}
      </Text>
    </View>
  )
}

/* ── Structure ───────────────────────────────────────────────────────────── */

/** Card — solid surface with refined border and iOS-native radius. */
export function Card({ className, ...props }: ViewProps) {
  return <View className={cn('rounded-card border border-line bg-surface', className)} {...props} />
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
    <View className={cn('flex-row items-center justify-between border-b border-line px-4 py-3', className)}>
      <Text className="text-[13px] font-semibold tracking-tight text-ink" numberOfLines={1}>
        {title}
      </Text>
      {right}
    </View>
  )
}

/** Section label — small caps above a group of rows, with more breathing room. */
export function SectionLabel({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <Text className={cn('px-4 pb-1.5 pt-4 text-[10px] font-semibold uppercase tracking-[0.2em] text-ink-3', className)}>
      {children}
    </Text>
  )
}

/** Rail micro-label — mono, tight tracking, used in drawer navigation. */
export function NavLabel({ children, className }: { children: React.ReactNode; className?: string }) {
  return (
    <Mono className={cn('px-3.5 pb-1 pt-4 text-[9px] font-semibold uppercase tracking-[0.2em] text-ink-3', className)}>
      {children}
    </Mono>
  )
}

/** Section eyebrow + title + description — the home screen heading pattern. */
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
    <View className="gap-1.5">
      <Mono className="text-[10px] font-semibold uppercase tracking-[0.18em] text-ink-3">{eyebrow}</Mono>
      <Text className="text-[22px] font-bold tracking-tight text-ink" style={{ letterSpacing: -0.5 }}>
        {title}
      </Text>
      {description ? (
        <Text className="text-[13px] leading-5 text-ink-2">{description}</Text>
      ) : null}
    </View>
  )
}

/** Row — a tappable list row with primary + secondary lines. */
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
        'min-h-[44px] flex-row items-center gap-3 rounded-xl px-3 py-2',
        selected && 'bg-accent-tint',
        disabled && 'opacity-40',
        onPress && !disabled && 'active:bg-hover-2',
        className,
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
      {trailing}
    </Pressable>
  )
}

/** TextField — refined input with softer border and comfortable padding. */
export function TextField({
  leading,
  className,
  ...props
}: TextInputProps & { leading?: React.ReactNode }) {
  return (
    <View className="min-h-[44px] flex-row items-center gap-2.5 rounded-2xl border border-line bg-field px-3.5">
      {leading}
      <TextInput
        className={cn('flex-1 py-3 text-[14px] text-ink', className)}
        placeholderTextColor="#86868e"
        {...props}
      />
    </View>
  )
}

/** Segmented control — the filter tablist with pill-shaped active indicator. */
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
    <View className="flex-row gap-0.5 rounded-2xl border border-line bg-field p-1">
      {options.map((option) => {
        const active = option.value === value
        return (
          <Pressable
            key={option.value}
            accessibilityRole="tab"
            accessibilityState={{ selected: active }}
            onPress={() => onChange(option.value)}
            className={cn(
              'min-h-9 flex-1 items-center justify-center rounded-xl px-3',
              active ? 'bg-surface shadow-sm' : '',
            )}
          >
            <Text
              className={cn(
                'text-[12px] font-semibold',
                active ? 'text-ink' : 'text-ink-3',
              )}
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

/** Loading dots with a label. */
export function Dots({ label }: { label: string }) {
  return (
    <View className="flex-row items-center gap-2.5">
      <View className="flex-row gap-1">
        {[0, 1, 2].map((index) => (
          <View
            key={index}
            className="size-1.5 rounded-full bg-ink-3"
            style={{ opacity: 0.3 + index * 0.25 }}
          />
        ))}
      </View>
      <Text className="text-[12px] text-ink-3">{label}</Text>
    </View>
  )
}

export function EmptyState({ title, body }: { title: string; body?: string }) {
  return (
    <View className="items-center justify-center gap-2 px-10 py-16">
      <Text className="text-center text-[15px] font-semibold text-ink">{title}</Text>
      {body ? (
        <Text className="max-w-72 text-center text-[13px] leading-5 text-ink-3">{body}</Text>
      ) : null}
    </View>
  )
}

/** Machine-readable value with copy affordance. */
export function FieldRow({ label, value }: { label: string; value: string }) {
  return (
    <View className="flex-row items-center justify-between gap-3">
      <Text className="text-[13px] text-ink-2">{label}</Text>
      <Mono className="max-w-[65%] text-[12px] text-ink" numberOfLines={1}>
        {value}
      </Mono>
    </View>
  )
}

/** Screen header for pushed (non-drawer) screens. */
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
      <View className="flex-row items-center gap-3 px-4 py-3.5">
        {left}
        <View className="flex-1">
          <Text className="text-[17px] font-bold tracking-tight text-ink" numberOfLines={1}>
            {title}
          </Text>
          {subtitle ? (
            <Mono className="mt-0.5 text-[11px]" numberOfLines={1}>
              {subtitle}
            </Mono>
          ) : null}
        </View>
        {right}
      </View>
    </GlassSurface>
  )
}

/** Page header — glass chrome bar with menu, title, and actions. */
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
    <GlassSurface effect="regular" radius={0} className="border-b border-line">
      <View className="h-14 flex-row items-center gap-2 px-2">
        {onMenu ? (
          <IconButton label="Menu" onPress={onMenu} className="size-10">
            <MenuIcon />
          </IconButton>
        ) : null}
        {wordmark ? <BrandMark /> : null}
        {title ? (
          <Text className="flex-1 text-[16px] font-bold tracking-tight text-ink" numberOfLines={1}>
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

/** The four-square AgentDeck mark. */
export function BrandMark({ size = 22, color = '#5e9eff' }: { size?: number; color?: string }) {
  return (
    <View className="flex-row flex-wrap" style={{ width: size, height: size, gap: size * 0.1 }}>
      {[0, 1, 2, 3].map((index) => (
        <View
          key={index}
          style={{
            width: size * 0.45,
            height: size * 0.45,
            borderRadius: size * 0.12,
            backgroundColor: color,
            opacity: index === 3 ? 0.4 : 1,
          }}
        />
      ))}
    </View>
  )
}

function MenuIcon() {
  return (
    <View className="gap-[3px]">
      {[0, 1, 2].map((index) => (
        <View key={index} className="h-[2px] w-4 rounded-full bg-ink-2" />
      ))}
    </View>
  )
}

/** Copy button — shows "Copied" for 1.4s after success. */
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
      className="h-7 shrink-0 justify-center rounded-lg px-2 active:bg-hover-2"
    >
      <Text className="text-[11px] font-medium text-ink-3">{copied ? 'Copied' : label}</Text>
    </Pressable>
  )
}

export function Spinner({ className }: { className?: string }) {
  return <ActivityIndicator color="#5e9eff" className={className} />
}
