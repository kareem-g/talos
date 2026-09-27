/**
 * BrandMark — the app's logo, as the same geometry the icon uses.
 *
 * Two stacked cards (the "deck") with a terminal prompt knocked out of the top
 * one: the product is a deck of agent sessions driven from a command surface.
 * The icon in `resources/icon.png` is generated from these same proportions
 * (`resources/generate-icons.sh`), so the home-screen icon and the in-app mark
 * stay one design.
 *
 * Colours are tokens, so it follows the theme: the accent ramp for the top card,
 * the accent at low opacity for the one behind it, and the knockout in the
 * surface colour so it reads as cut out of whatever card it sits on.
 */

export function BrandMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 1024 1024"
      className={className}
      role="img"
      aria-label="AgentDeck"
      fill="none"
    >
      <defs>
        <linearGradient id="brand-mark-card" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--accent-hover)" />
          <stop offset="100%" stopColor="var(--accent-2, var(--accent))" />
        </linearGradient>
      </defs>

      {/* Deck: the card behind peeks out down-right. */}
      <rect
        x="236"
        y="212"
        width="624"
        height="624"
        rx="132"
        fill="var(--accent)"
        opacity="0.22"
      />
      {/* Top card. */}
      <rect x="172" y="148" width="624" height="624" rx="132" fill="url(#brand-mark-card)" />

      {/* Prompt: chevron + cursor. */}
      <path
        d="M330 338 L450 460 L330 582"
        stroke="var(--surface)"
        strokeWidth="58"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <rect x="500" y="431" width="140" height="58" rx="29" fill="var(--surface)" />
    </svg>
  )
}
