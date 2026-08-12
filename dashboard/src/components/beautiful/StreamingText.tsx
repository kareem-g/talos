import { useEffect, useRef, useState } from "react";

/* ─────────────────────────────────────────────────────────
 * STREAMING TEXT (Beautiful UI collection, adapted for live data)
 * Words resolve out of blur as the assistant produces them;
 * follow-up prompts become usable once the stream settles.
 * The self-playing demo constants were replaced with props —
 * the stream-in/fade-up motion, caret and typography are kept.
 * ───────────────────────────────────────────────────────── */

const WORD_STAGGER_MS = 28;

export default function StreamingText({
  text,
  streaming = false,
  followUps,
  onFollowUp,
}: {
  text: string;
  streaming?: boolean;
  followUps?: string[];
  onFollowUp?: (text: string) => void;
}) {
  const words = text.split(/\s+/).filter(Boolean);
  const done = !streaming;

  // Words already on screen render statically; only new arrivals animate so a
  // long history doesn't replay its whole stream on mount.
  const seen = useRef(words.length);
  const [animatedFrom, setAnimatedFrom] = useState(words.length);
  useEffect(() => {
    if (words.length > seen.current) {
      setAnimatedFrom(seen.current);
    } else {
      setAnimatedFrom(words.length);
    }
    seen.current = words.length;
  }, [words.length]);

  return (
    <div className="w-full min-w-0">
      <p className="text-[13px] leading-relaxed text-ink">
        {words.map((word, i) => (
          <span
            key={i}
            className="inline [will-change:filter,opacity]"
            style={
              i >= animatedFrom
                ? {
                    animation: `stream-in 420ms cubic-bezier(0.22,0.61,0.25,1) both`,
                    animationDelay: `${Math.min((i - animatedFrom) * WORD_STAGGER_MS, 400)}ms`,
                  }
                : undefined
            }
          >
            {word}{" "}
          </span>
        ))}
        {!done && (
          <span
            className="ml-0.5 inline-block h-3 w-0.5 translate-y-0.5 rounded-full bg-ink"
            style={{ animation: "fade-in 150ms ease-out both" }}
          />
        )}
      </p>

      {/* follow-ups */}
      {followUps && followUps.length > 0 && (
        <div
          className="mt-2.5 transition-opacity duration-400"
          style={{ opacity: done ? 1 : 0, pointerEvents: done ? "auto" : "none" }}
        >
          <p className="text-[12px] font-medium text-ink-2">Follow-ups</p>
          <div className="mt-0.5 flex flex-col">
            {followUps.map((item, i) => (
              <button
                key={item}
                type="button"
                onClick={() => onFollowUp?.(item)}
                className="-mx-1.5 flex items-center gap-2 rounded-[7px] border-b border-line
                  px-1.5 py-1.5 text-left text-[12.5px] text-ink transition-colors
                  duration-100 hover:bg-hover-2"
                style={
                  done
                    ? { animation: `fade-up 350ms cubic-bezier(0.23,1,0.32,1) ${i * 90}ms both` }
                    : { opacity: 0 }
                }
              >
                <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="var(--ink-3)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="shrink-0">
                  <path d="M9 10l-5 5 5 5" />
                  <path d="M20 4v7a4 4 0 0 1-4 4H4" />
                </svg>
                {item}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
