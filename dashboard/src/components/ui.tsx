/**
 * UI kit — Beautiful UI collection idiom.
 *
 * Conventions carried over from `beautifului-collection/`: explicit pixel type
 * sizes (`text-[12.5px]`), `rounded-control`/`rounded-chip`/`rounded-card`,
 * `bg-surface`/`bg-hover` for elevation, `text-ink`/`ink-2`/`ink-3` for text
 * hierarchy, 100–150ms color transitions, and `fade-up`/`pop-in` entrances.
 *
 * Touch targets are ≥36px even where the collection uses 28px rows, because
 * mobile is a primary client here rather than a desktop showcase.
 */

import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { createPortal } from 'react-dom'
import { cn } from '@/lib/format'

/* ── Icons ─────────────────────────────────────────────────────────────────
 * Inline SVG, matching the collection's approach (no icon dependency).
 */

type IconProps = { className?: string; size?: number; style?: React.CSSProperties }

function svgProps(size: number) {
  return {
    width: size,
    height: size,
    viewBox: '0 0 24 24',
    fill: 'none' as const,
    stroke: 'currentColor',
    strokeWidth: 2.2,
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
  }
}

export function ChevronDown({ className, size = 12, style }: IconProps) {
  return (
    <svg {...svgProps(size)} className={className} style={style}>
      <path d="M6 9l6 6 6-6" />
    </svg>
  )
}

export function ChevronLeft({ className, size = 16, style }: IconProps) {
  return (
    <svg {...svgProps(size)} className={className} style={style}>
      <path d="M15 18l-6-6 6-6" />
    </svg>
  )
}

export function Close({ className, size = 14 }: IconProps) {
  return (
    <svg {...svgProps(size)} className={className}>
      <path d="M18 6L6 18M6 6l12 12" />
    </svg>
  )
}

export function Check({ className, size = 13 }: IconProps) {
  return (
    <svg {...svgProps(size)} className={className}>
      <path d="M20 6L9 17l-5-5" />
    </svg>
  )
}

/** Hollow circle — a pending plan step. */
export function Circle({ className, size = 13 }: IconProps) {
  return (
    <svg {...svgProps(size)} className={className}>
      <circle cx="12" cy="12" r="8.5" />
    </svg>
  )
}

export function Plus({ className, size = 14 }: IconProps) {
  return (
    <svg {...svgProps(size)} className={className}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}

export function Search({ className, size = 13 }: IconProps) {
  return (
    <svg {...svgProps(size)} className={className}>
      <circle cx="11" cy="11" r="7" />
      <path d="M20 20l-3.5-3.5" />
    </svg>
  )
}

export function Terminal({ className, size = 13 }: IconProps) {
  return (
    <svg {...svgProps(size)} className={className}>
      <path d="M4 17l6-5-6-5M12 19h8" />
    </svg>
  )
}

export function MessageIcon({ className, size = 13 }: IconProps) {
  return (
    <svg {...svgProps(size)} className={className}>
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
    </svg>
  )
}

export function ArrowUp({ className, size = 15 }: IconProps) {
  return (
    <svg {...svgProps(size)} className={className}>
      <path d="M12 19V5M5 12l7-7 7 7" />
    </svg>
  )
}

export function StopIcon({ className, size = 13 }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" className={className}>
      <rect x="6" y="6" width="12" height="12" rx="2" />
    </svg>
  )
}

export function Sparkle({ className, size = 13 }: IconProps) {
  return (
    <svg viewBox="0 0 24 24" width={size} height={size} fill="currentColor" className={className}>
      <path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8z" />
    </svg>
  )
}

export function FileIcon({ className, size = 13 }: IconProps) {
  return (
    <svg {...svgProps(size)} className={className}>
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <path d="M14 2v6h6" />
    </svg>
  )
}

export function PencilIcon({ className, size = 13 }: IconProps) {
  return (
    <svg {...svgProps(size)} className={className}>
      <path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z" />
    </svg>
  )
}

export function AlertIcon({ className, size = 14 }: IconProps) {
  return (
    <svg {...svgProps(size)} className={className}>
      <path d="M12 9v4M12 17h.01" />
      <path d="M10.3 3.9L1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
    </svg>
  )
}

/* ── Buttons ─────────────────────────────────────────────────────────────── */

type ButtonVariant = 'primary' | 'surface' | 'ghost' | 'danger'

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: 'bg-accent text-white font-semibold enabled:hover:bg-accent-2 border border-line-strong shadow-sm',
  surface: 'bg-surface border border-line/60 text-ink enabled:hover:bg-hover enabled:hover:border-line-strong',
  ghost: 'border border-line/40 text-ink-2 enabled:hover:bg-hover-2 enabled:hover:text-ink',
  danger: 'bg-red/[0.06] text-red enabled:hover:bg-red/[0.10] border border-red/20',
}

export function Button({
  variant = 'surface',
  className,
  children,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: ButtonVariant }) {
  return (
    <button
      type="button"
      {...rest}
      className={cn(
        'inline-flex min-h-9 items-center justify-center gap-1.5 rounded-control px-3',
        'text-[12.5px] transition-colors duration-150',
        'enabled:active:scale-[0.98] disabled:opacity-40',
        BUTTON_VARIANTS[variant],
        className,
      )}
    >
      {children}
    </button>
  )
}

/**
 * Square icon button. 36px rather than the collection's 24px, for touch.
 *
 * `tone` exists so callers never have to override the base classes: opacity
 * modifiers like `bg-accent/90` silently do nothing on a bare `var()` color,
 * which is exactly the kind of override that fails invisibly.
 */
export function IconButton({
  label,
  tone = 'ghost',
  className,
  children,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  label: string
  tone?: 'ghost' | 'accent'
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      {...rest}
      className={cn(
        'flex size-9 shrink-0 items-center justify-center rounded-full',
        'transition-colors duration-100 disabled:opacity-35',
        tone === 'accent'
          ? 'bg-accent/15 text-accent-ink enabled:hover:bg-accent/25'
          : 'text-ink-3 enabled:hover:bg-hover-2 enabled:hover:text-ink',
        className,
      )}
    >
      {children}
    </button>
  )
}

/* ── Chips and badges ────────────────────────────────────────────────────── */

/** The collection's inline chip: pill, field-colored, truncating. */
export function Chip({
  mono,
  tone,
  className,
  children,
}: {
  mono?: boolean
  tone?: 'default' | 'green' | 'red' | 'orange' | 'accent'
  className?: string
  children: ReactNode
}) {
  const tones = {
    default: 'bg-field text-ink-2',
    green: 'bg-green-tint text-green',
    red: 'bg-red-tint text-red',
    orange: 'bg-orange-tint text-orange',
    accent: 'bg-accent-tint text-accent-ink',
  }
  return (
    <span
      className={cn(
        'inline-flex h-5.5 min-w-0 max-w-full items-center truncate rounded-md px-1.5',
        'text-[11.5px]',
        tones[tone ?? 'default'],
        mono && 'font-mono',
        className,
      )}
    >
      {children}
    </span>
  )
}

/** A small colored dot. Pulses only when something is genuinely in flight. */
export function Dot({
  tone,
  pulse,
}: {
  tone: 'green' | 'orange' | 'red' | 'dim' | 'accent'
  pulse?: boolean
}) {
  const tones = {
    green: 'bg-green',
    orange: 'bg-orange',
    red: 'bg-red',
    accent: 'bg-accent',
    dim: 'bg-ink-3',
  }
  return (
    <span
      aria-hidden
      className={cn('size-[7px] shrink-0 rounded-full', tones[tone], pulse && 'breathe')}
    />
  )
}

/**
 * The one status pill. Headers and rosters all render state through this, so
 * a given state looks — and reads — the same everywhere. Tone follows the
 * traffic-light discipline: green alive, amber needs-you, red failed, dim ended.
 */
export function StatusPill({
  label,
  tone,
  pulse,
  detail,
  className,
}: {
  label: string
  tone: 'green' | 'orange' | 'red' | 'dim'
  pulse?: boolean
  /** Optional mono detail (the file being edited, the command running). */
  detail?: string
  className?: string,
}) {
  const tones = {
    green: 'text-green',
    orange: 'text-orange',
    red: 'text-red',
    dim: 'text-ink-3',
  } as const
  return (
    <span
      className={cn(
        'inline-flex h-6 min-w-0 max-w-full items-center gap-1.5 rounded-full border border-line/40 bg-surface/80 px-2',
        'text-[11px] font-medium',
        tones[tone],
        className,
      )}
    >
      <Dot tone={tone} pulse={pulse} />
      <span className="shrink-0 whitespace-nowrap">{label}</span>
      {detail ? (
        <span className="hidden min-w-0 truncate font-mono text-[10.5px] font-normal text-ink-3 md:inline">
          {detail}
        </span>
      ) : null}
    </span>
  )
}

/* ── Layers (sheets, popovers) ───────────────────────────────────────────
 * Rendered through a portal into a stack container rather than a native
 * `<dialog>`. `showModal()` puts every open dialog in the same top layer, so a
 * picker opened from inside a sheet sat *alongside* its parent — three dialogs
 * visible at once, and ambiguous queries. A portal stack nests correctly.
 */

const LayerDepth = createContext(0)

export function Layer({
  open,
  onClose,
  title,
  children,
  footer,
  size = 'md',
}: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  footer?: ReactNode
  size?: 'sm' | 'md' | 'lg'
}) {
  const depth = useContext(LayerDepth)
  const titleId = useId()
  const panelRef = useRef<HTMLDivElement>(null)

  // Escape closes the topmost layer. Each layer listens; the deepest one is
  // last to mount, so stopping propagation there keeps parents open.
  useEffect(() => {
    if (!open) return
    function onKeyDown(keyEvent: KeyboardEvent) {
      if (keyEvent.key === 'Escape') {
        keyEvent.stopPropagation()
        onClose()
      }
    }
    const node = panelRef.current
    node?.focus({ preventScroll: true })
    document.addEventListener('keydown', onKeyDown, true)
    return () => document.removeEventListener('keydown', onKeyDown, true)
  }, [open, onClose])

  // Prevent background scroll while any layer is open.
  useEffect(() => {
    if (!open) return
    const previous = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    return () => {
      document.body.style.overflow = previous
    }
  }, [open])

  if (!open) return null

  const widths = { sm: 'sm:max-w-80', md: 'sm:max-w-md', lg: 'sm:max-w-lg' }

  return createPortal(
    <LayerDepth.Provider value={depth + 1}>
      <div
        className="fixed inset-0 flex items-end justify-center sm:items-center"
        style={{ zIndex: 50 + depth * 10 }}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div
          className="absolute inset-0 animate-fade bg-black/65 backdrop-blur-[3px]"
          onClick={onClose}
          aria-hidden
        />
        <div
          ref={panelRef}
          tabIndex={-1}
          className={cn(
            'animate-sheet relative flex max-h-[88dvh] w-full flex-col overflow-hidden',
            'border border-line/60 bg-surface shadow-overlay outline-none',
            'rounded-t-2xl sm:rounded-2xl',
            widths[size],
          )}
        >
          <header className="flex shrink-0 items-center justify-between gap-2 border-b border-line/40 px-3.5 py-2.5">
            <h2 id={titleId} className="text-[13px] font-medium text-ink">
              {title}
            </h2>
            <IconButton label="Close" onClick={onClose} className="-mr-1.5">
              <Close />
            </IconButton>
          </header>

          <div className="scroll-thin min-h-0 flex-1 overflow-y-auto overscroll-contain p-1.5">
            {children}
          </div>

          {footer ? (
            <div
              className="shrink-0 border-t border-line/40 p-2.5"
              style={{ paddingBottom: 'max(0.625rem, env(safe-area-inset-bottom))' }}
            >
              {footer}
            </div>
          ) : (
            <div
              aria-hidden
              style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}
              className="shrink-0"
            />
          )}
        </div>
      </div>
    </LayerDepth.Provider>,
    document.body,
  )
}

/** A selectable row inside a layer. */
export function Row({
  selected,
  onSelect,
  primary,
  secondary,
  trailing,
  disabled,
  mono,
}: {
  selected?: boolean
  onSelect?: () => void
  primary: ReactNode
  secondary?: ReactNode
  trailing?: ReactNode
  disabled?: boolean
  mono?: boolean
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      disabled={disabled || !onSelect}
      aria-current={selected ? 'true' : undefined}
      className={cn(
        'flex min-h-10 w-full items-center gap-2.5 rounded-control px-2.5 py-1.5 text-left',
        'transition-colors duration-100',
        onSelect && !disabled && 'hover:bg-hover-2',
        selected && 'bg-accent-tint',
        disabled && 'opacity-55',
      )}
    >
      <span className="min-w-0 flex-1">
        <span
          className={cn(
            'block truncate text-[12.5px]',
            selected ? 'text-ink' : 'text-ink',
            mono && 'font-mono',
          )}
        >
          {primary}
        </span>
        {secondary ? (
          <span className="mt-0.5 block truncate text-[11.5px] leading-[1.5] text-ink-3">
            {secondary}
          </span>
        ) : null}
      </span>
      {trailing}
      {selected ? <Check className="shrink-0 text-accent-ink" /> : null}
    </button>
  )
}

/** Section heading inside a layer. */
export function SectionLabel({ children }: { children: ReactNode }) {
  return (
    <h3 className="px-2.5 pb-1 pt-2.5 text-[10.5px] font-medium uppercase tracking-[0.06em] text-ink-3">
      {children}
    </h3>
  )
}

/* ── Inputs ──────────────────────────────────────────────────────────────── */

export function TextField({
  className,
  leading,
  ...rest
}: React.InputHTMLAttributes<HTMLInputElement> & { leading?: ReactNode }) {
  return (
    <div
      className={cn(
        'flex min-h-9 items-center gap-2 rounded-xl border border-line/50 bg-surface/80 px-2.5',
        'transition-colors duration-150 focus-within:border-accent/30 focus-within:bg-surface',
        className,
      )}
    >
      {leading ? <span className="shrink-0 text-ink-3">{leading}</span> : null}
      <input
        {...rest}
        className="min-w-0 flex-1 bg-transparent text-[12.5px] text-ink outline-none placeholder:text-ink-3"
      />
    </div>
  )
}

/* ── States ──────────────────────────────────────────────────────────────── */

/** Three-dot loader, the collection's "Dots" loading variant. */
export function Dots({ label }: { label?: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="flex items-center gap-[3px]" aria-hidden>
        {[0, 1, 2].map((index) => (
          <span
            key={index}
            className="size-[4px] rounded-full bg-ink-3"
            style={{ animation: `breathe 1.1s ease-in-out ${index * 160}ms infinite` }}
          />
        ))}
      </span>
      {label ? <span className="text-[11.5px] text-ink-3">{label}</span> : null}
    </span>
  )
}

export function EmptyState({
  title,
  description,
  action,
}: {
  title: string
  description?: string
  action?: ReactNode
}) {
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-1.5 px-8 py-14 text-center">
      <p className="text-[13px] font-medium text-ink">{title}</p>
      {description ? (
        <p className="max-w-80 text-[12px] leading-[1.6] text-ink-3">{description}</p>
      ) : null}
      {action ? <div className="pt-2">{action}</div> : null}
    </div>
  )
}

/** Dismissible inline notice. Carries a backend-supplied reason. */
export function Notice({
  message,
  tone = 'warn',
  onDismiss,
}: {
  message: string
  tone?: 'warn' | 'error'
  onDismiss: () => void
}) {
  return (
    <div
      role="alert"
      className={cn(
        'flex shrink-0 items-start gap-2 border-b px-3.5 py-2 text-[11.5px] leading-[1.6]',
        tone === 'error'
          ? 'border-red/20 bg-red/[0.04] text-ink'
          : 'border-orange/20 bg-orange/[0.04] text-ink',
      )}
    >
      <AlertIcon
        size={13}
        className={cn('mt-[2px] shrink-0', tone === 'error' ? 'text-red' : 'text-orange')}
      />
      <span className="min-w-0 flex-1">{message}</span>
      <button
        type="button"
        onClick={onDismiss}
        aria-label="Dismiss"
        className="-m-1 shrink-0 p-1 text-ink-3 transition-colors hover:text-ink"
      >
        <Close size={12} />
      </button>
    </div>
  )
}

/** Segmented control, used for Chat/Terminal. */
export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T
  options: Array<{ value: T; label: string; icon?: ReactNode }>
  onChange: (value: T) => void
}) {
  return (
    <div
      role="tablist"
      className="flex shrink-0 items-center gap-0.5 rounded-xl border border-line/50 bg-surface/60 p-0.5"
    >
      {options.map((option) => (
        <button
          key={option.value}
          role="tab"
          aria-selected={value === option.value}
          onClick={() => onChange(option.value)}
          className={cn(
            'inline-flex min-h-7 items-center gap-1.5 rounded-lg px-2.5 text-[11.5px]',
            'transition-all duration-150',
            value === option.value
              ? 'bg-hover text-ink border border-line/40'
              : 'text-ink-3 hover:text-ink-2',
          )}
        >
          {option.icon}
          {option.label}
        </button>
      ))}
    </div>
  )
}

/** Copy-to-clipboard button with transient confirmation. */
export function CopyButton({ value, label = 'Copy' }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    if (!copied) return
    const timer = setTimeout(() => setCopied(false), 1400)
    return () => clearTimeout(timer)
  }, [copied])

  return (
    <button
      type="button"
      onClick={() => {
        // Clipboard access can be denied (insecure origin, permissions). Report
        // rather than showing a success state that did not happen.
        navigator.clipboard
          ?.writeText(value)
          .then(() => setCopied(true))
          .catch(() => setCopied(false))
      }}
      className="inline-flex h-6 items-center rounded-[6px] px-1.5 text-[11px] text-ink-3 transition-colors duration-100 hover:bg-hover-2 hover:text-ink"
    >
      {copied ? 'Copied' : label}
    </button>
  )
}
