/**
 * BrandMark — the QAI signal mark: a ring, a 45° tail cutting out of it, and
 * a live core dot. A "Q" that reads as a beacon at 16px and as an app icon
 * at 1024. The mobile app draws the identical geometry (its `BrandMark` in
 * `components/ui.tsx` and the generated PNG assets), so the mark is one
 * design across both surfaces.
 *
 * Colours are tokens, so it follows the theme: the accent for the ring and
 * tail, at full strength — the mark is the one place the accent is allowed to
 * be the whole picture.
 */

export function BrandMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 1024 1024"
      className={className}
      role="img"
      aria-label="QAI"
      fill="none"
    >
      {/* The ring. */}
      <circle cx="512" cy="512" r="240" stroke="var(--accent)" strokeWidth="64" />
      {/* The tail, cutting out at 45°. */}
      <path
        d="M626 626 L810 810"
        stroke="var(--accent)"
        strokeWidth="64"
        strokeLinecap="round"
      />
      {/* The live core. */}
      <circle cx="512" cy="512" r="48" fill="var(--accent)" />
    </svg>
  )
}
