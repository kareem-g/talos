/**
 * Shared RN UI primitives — the NativeWind counterpart to the web `ui.tsx`.
 *
 * Deliberately small for now: the pieces the core screens need (buttons, chips,
 * status pill, card, screen header, empty state). Full parity with the web
 * primitive set (Layer→bottom-sheet, DropdownList, Segmented, toasts, the inline
 * SVG icon set) is a later phase; these cover pairing, home, and the session
 * screen so the app is usable end to end.
 *
 * Colors come from the Tailwind tokens in tailwind.config.js (mirrored from the
 * web theme), so `bg-surface`, `text-ink`, `border-line`, and the status hues
 * read the same as the desktop control station.
 */

import * as React from 'react'
import {
  ActivityIndicator,
  Pressable,
  Text,
  View,
  type PressableProps,
  type ViewProps,
} from 'react-native'
import { cn } from '@/lib/format'

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

type ButtonVariant = 'primary' | 'surface' | 'ghost' | 'danger'

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-accent active:bg-accent-hover',
  surface: 'bg-surface border border-line active:bg-hover',
  ghost: 'bg-transparent active:bg-hover',
  danger: 'bg-red/15 border border-red-border active:bg-red/25',
}
const BUTTON_TEXT: Record<ButtonVariant, string> = {
  primary: 'text-accent-ink',
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
        'flex-row items-center justify-center rounded-control px-3.5 py-2.5',
        BUTTON_VARIANTS[variant],
        disabled && 'opacity-40',
        className,
      )}
      {...props}
    >
      <Text className={cn('text-[13px] font-medium', BUTTON_TEXT[variant])}>{label}</Text>
    </Pressable>
  )
}

export function Chip({
  tone = 'dim',
  children,
  className,
}: {
  tone?: Tone
  children: React.ReactNode
  className?: string
}) {
  return (
    <View className={cn('flex-row items-center rounded-chip bg-surface px-2.5 py-1', className)}>
      <View className={cn('mr-1.5 size-[7px] rounded-full', TONE_DOT[tone])} />
      <Text className={cn('text-[11px] font-medium', TONE_TEXT[tone])}>{children}</Text>
    </View>
  )
}

/** The status pill: a dot + label, pulsing while work is genuinely in flight. */
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
    <View className={cn('flex-row items-center rounded-chip bg-surface px-2.5 py-1', className)}>
      <View className={cn('mr-1.5 size-[7px] rounded-full', TONE_DOT[tone], pulse && 'opacity-70')} />
      <Text className={cn('text-[11px] font-medium', TONE_TEXT[tone])}>{label}</Text>
    </View>
  )
}

export function Card({ className, ...props }: ViewProps) {
  return <View className={cn('rounded-card border border-line bg-surface', className)} {...props} />
}

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
    <View className="flex-row items-center border-b border-line bg-canvas px-4 pb-3 pt-6">
      {left ? <View className="mr-3">{left}</View> : null}
      <View className="flex-1">
        <Text className="text-base font-semibold text-ink" numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text className="mt-0.5 text-xs text-ink-3" numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>
      {right ? <View className="ml-3 flex-row items-center">{right}</View> : null}
    </View>
  )
}

export function EmptyState({ title, body }: { title: string; body?: string }) {
  return (
    <View className="flex-1 items-center justify-center px-8 py-16">
      <Text className="text-center text-sm font-medium text-ink-2">{title}</Text>
      {body ? <Text className="mt-1.5 text-center text-xs text-ink-3">{body}</Text> : null}
    </View>
  )
}

export function Spinner({ className }: { className?: string }) {
  return <ActivityIndicator color="#5b8def" className={className} />
}
