/* ─────────────────────────────────────────────────────────
 * DIFF TABLE (Beautiful UI collection, adapted for live data)
 * Removed lines tint red with strikethrough; added lines rest
 * on the green tint and reveal with the collection's
 * grid-template-rows animation. The demo's timed stage
 * machine is replaced by props so the diff renders real
 * file edits the moment they arrive.
 * ───────────────────────────────────────────────────────── */

export type DiffLine = { type: "add" | "remove" | "context"; text: string };

export default function DiffTable({
  title,
  lines,
  additions,
  deletions,
}: {
  title: string;
  lines: DiffLine[];
  additions?: number;
  deletions?: number;
}) {
  const addCount = additions ?? lines.filter((line) => line.type === "add").length;
  const delCount = deletions ?? lines.filter((line) => line.type === "remove").length;

  return (
    <div className="w-full max-w-95">
      <div className="relative overflow-hidden rounded-card bg-surface shadow-card">
        <div className="primitive-card-bar flex items-center justify-between border-b border-line">
          <span className="min-w-0 truncate font-mono text-[12px] font-medium text-ink">{title}</span>
          <span className="flex shrink-0 items-center gap-2 font-mono text-[11px] tabular-nums">
            <span className="text-green">+{addCount}</span>
            <span className="text-red">−{delCount}</span>
          </span>
        </div>

        <div className="ai-scroll-thin max-h-72 overflow-auto py-1 font-mono text-[11.5px] leading-[1.7]">
          {lines.map((line, i) => {
            if (line.type === "remove") {
              return (
                <div
                  key={i}
                  className="flex px-3 transition-colors duration-400"
                  style={{ background: "var(--red-tint)", animation: "fade-in 250ms ease-out both" }}
                >
                  <span className="w-4 shrink-0 select-none text-red">−</span>
                  <span
                    className="whitespace-pre text-red"
                    style={{
                      textDecorationLine: "line-through",
                      textDecorationColor: "color-mix(in srgb, var(--red) 50%, transparent)",
                    }}
                  >
                    {line.text}
                  </span>
                </div>
              );
            }
            if (line.type === "add") {
              return (
                <div
                  key={i}
                  className="grid transition-[grid-template-rows,opacity] duration-400"
                  style={{
                    gridTemplateRows: "1fr",
                    opacity: 1,
                    transitionTimingFunction: "cubic-bezier(0.23, 1, 0.32, 1)",
                    animation: "fade-up 300ms cubic-bezier(0.23,1,0.32,1) both",
                  }}
                >
                  <div className="overflow-hidden" style={{ background: "var(--green-tint)" }}>
                    <div className="flex px-3">
                      <span className="w-4 shrink-0 select-none text-green">+</span>
                      <span className="whitespace-pre text-green">{line.text}</span>
                    </div>
                  </div>
                </div>
              );
            }
            return (
              <div key={i} className="flex px-3">
                <span className="w-4 shrink-0 select-none text-ink-3"> </span>
                <span className="whitespace-pre text-ink-2">{line.text}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}
