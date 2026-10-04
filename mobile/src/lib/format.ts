import { clsx, type ClassValue } from 'clsx'
import { extendTailwindMerge } from 'tailwind-merge'

import { PALETTE, TEXT_SIZES } from '@/design/tokens'

/**
 * `text-*` carries both font sizes and colours, and tailwind-merge resolves
 * that overlap by guessing from its own default tables — which do not know
 * this theme. Guessing wrong drops a real class: `cn('text-ink',
 * 'text-pill')` looks like two colours, so the white disappears and the label
 * falls back to black. Teaching the merger the theme's own vocabulary removes
 * the ambiguity.
 */
const twMerge = extendTailwindMerge({
  extend: {
    classGroups: {
      'font-size': [{ text: Object.keys(TEXT_SIZES) }],
      'text-color': [{ text: Object.keys(PALETTE) }],
    },
  },
})

/** Conditional class names with Tailwind conflict resolution. */
export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Compact relative time: "now", "4m", "2h", "3d". */
export function relativeTime(iso: string): string {
  const then = new Date(iso).getTime()
  if (Number.isNaN(then)) return ''
  const seconds = Math.floor((Date.now() - then) / 1000)
  if (seconds < 45) return 'now'
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m`
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h`
  return `${Math.floor(seconds / 86400)}d`
}

/** Duration for a completed step: "820ms", "3.4s", "2m 05s". */
export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`
  if (ms < 60000) return `${(ms / 1000).toFixed(1)}s`
  const minutes = Math.floor(ms / 60000)
  const seconds = Math.round((ms % 60000) / 1000)
  return `${minutes}m ${String(seconds).padStart(2, '0')}s`
}

/** Last path segment, for showing a project directory compactly. */
export function basename(path: string): string {
  const trimmed = path.replace(/\/+$/, '')
  const index = trimmed.lastIndexOf('/')
  return index === -1 ? trimmed : trimmed.slice(index + 1) || trimmed
}
