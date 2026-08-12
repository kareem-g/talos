import { useState } from "react";

/* ─────────────────────────────────────────────────────────
 * TOOL CHIPS (Beautiful UI collection, adapted for live data)
 * An agent run as compact rows: tool calls with inline
 * chips, then file-diff chips summarizing the edits.
 * Hover a row to reveal its chevron; every row expands
 * to show what the tool actually did.
 * The demo's staggered self-play timer is replaced by props
 * so rows mirror real tool events; animations are unchanged.
 * ───────────────────────────────────────────────────────── */

const Icons: Record<string, React.ReactNode> = {
  think: <path d="M12 2l2.4 7.2L22 12l-7.6 2.8L12 22l-2.4-7.2L2 12l7.6-2.8z" />,
  write: <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M17 3a2.8 2.8 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5z" /></g>,
  run: <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M4 17l6-5-6-5M12 19h8" /></g>,
  read: <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" /><path d="M14 2v6h6" /></g>,
  search: <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="7" /><path d="M21 21l-4.3-4.3" /></g>,
  tool: <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z" /></g>,
};

export type ToolChipDetailLine = { text: string; tone?: "add" | "del" };

export type ToolChipRow = {
  id: string;
  icon: string;
  label: string;
  chip?: string;
  mono?: boolean;
  detail?: ToolChipDetailLine[];
  detailMono?: boolean;
  running?: boolean;
  failed?: boolean;
};

export type ToolChipDiff = { file: string; add: number; del: number };

export default function ToolChips({
  rows,
  diffs = [],
  header,
  defaultOpen = true,
}: {
  rows: ToolChipRow[];
  diffs?: ToolChipDiff[];
  /** Collapsed-run header override; defaults to "N tool calls". */
  header?: string;
  defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  const [openRows, setOpenRows] = useState<Set<string>>(new Set());

  if (rows.length === 0 && diffs.length === 0) return null;

  const toggleRow = (id: string) =>
    setOpenRows((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const label = header || `${rows.length} tool call${rows.length === 1 ? "" : "s"}`;

  return (
    <div className="w-full max-w-80 pb-1">
      {/* collapsed run header */}
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
        className="-mx-1.5 flex w-fit items-center gap-1.5 rounded-control px-1.5 py-1 text-[12.5px] text-ink-2 transition-colors duration-100 hover:bg-hover-2"
      >
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" className="transition-transform duration-200" style={{ transform: open ? "rotate(0deg)" : "rotate(-90deg)" }}>
          <path d="M6 9l6 6 6-6" />
        </svg>
        <span className="tabular-nums">{label}</span>
      </button>

      {/* tool call rows */}
      <div className="grid transition-[grid-template-rows,opacity] duration-300" style={{ gridTemplateRows: open ? "1fr" : "0fr", opacity: open ? 1 : 0 }}>
        {/* -mx-1 + px-1.5 keeps content at the same x while giving the
            row hover pills room inside this overflow-hidden clip box */}
        <div className="-mx-1 overflow-hidden px-1.5 pb-1">
        <div className="mt-1.5 flex flex-col gap-1">
          {rows.map((row, index) => {
            const rowOpen = openRows.has(row.id);
            return (
            <div key={row.id} style={{ animation: `fade-up 300ms cubic-bezier(0.23,1,0.32,1) ${Math.min(index * 60, 360)}ms both` }}>
              <button
                type="button"
                aria-expanded={rowOpen}
                onClick={() => toggleRow(row.id)}
                className="group/row -mx-[3px] flex h-7 w-[calc(100%+6px)] min-w-0 items-center gap-2 rounded-control px-[3px] text-left transition-colors duration-100 hover:bg-hover-2"
              >
                <span className="relative flex size-4 shrink-0 items-center justify-center text-ink-3">
                  {row.running ? (
                    <span className="size-3 rounded-full border-[1.5px] border-line-strong border-t-ink-2" style={{ animation: "spin 700ms linear infinite" }} />
                  ) : (
                    <>
                      <svg
                        width="13" height="13" viewBox="0 0 24 24" fill={row.icon === "think" ? "currentColor" : "none"} stroke="currentColor"
                        className={`transition-opacity duration-100 group-hover/row:opacity-0 ${rowOpen ? "opacity-0" : ""} ${row.failed ? "text-red" : ""}`}
                      >
                        {Icons[row.icon] ?? Icons.tool}
                      </svg>
                      {row.detail && row.detail.length > 0 && (
                        <svg
                          width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
                          className={`absolute transition-[opacity,transform] duration-150 group-hover/row:opacity-100 ${rowOpen ? "opacity-100" : "opacity-0"}`}
                          style={{ transform: rowOpen ? "rotate(0deg)" : "rotate(-90deg)" }}
                        >
                          <path d="M6 9l6 6 6-6" />
                        </svg>
                      )}
                    </>
                  )}
                </span>
                <span className={`shrink-0 text-[12.5px] font-medium ${row.failed ? "text-red" : "text-ink"}`}>{row.label}</span>
                {row.chip && (
                  <span
                    className={`inline-flex h-5.5 min-w-0 flex-1 cursor-pointer items-center truncate rounded-chip bg-hover-2 px-1.5
                      text-[11.5px] text-[#43464c] shadow-hairline transition-colors duration-100 hover:bg-line-strong
                      dark:bg-field dark:text-ink-2 dark:hover:bg-hover
                      ${row.mono ? "font-mono" : ""}`}
                  >
                    {row.chip}
                  </span>
                )}
              </button>

              {/* expanded detail */}
              {row.detail && row.detail.length > 0 && (
                <div
                  className="grid transition-[grid-template-rows,opacity] duration-300"
                  style={{ gridTemplateRows: rowOpen ? "1fr" : "0fr", opacity: rowOpen ? 1 : 0, transitionTimingFunction: "cubic-bezier(0.23, 1, 0.32, 1)" }}
                >
                  <div className="min-h-0 overflow-hidden">
                    <div className="mt-0.5 mb-1 ml-2 flex flex-col gap-0.5 border-l border-line py-0.5 pl-3.5">
                      {row.detail.map((line, lineIndex) => (
                        <span
                          key={`${line.text}-${lineIndex}`}
                          className={`truncate text-[11.5px] leading-[1.6] ${row.detailMono ? "font-mono" : ""} ${line.tone === "add" ? "text-green" : line.tone === "del" ? "text-red" : "text-ink-2"}`}
                        >
                          {line.text}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              )}
            </div>
            );
          })}
        </div>

      {/* file-diff chips */}
      {diffs.length > 0 && (
        <div className="mt-2.5 flex max-w-full flex-wrap gap-1.5 border-t border-line pt-2.5">
          {diffs.map((d, i) => (
            <span
              key={d.file}
              className="inline-flex h-7 max-w-full cursor-pointer items-center gap-1.5 rounded-chip
                bg-surface px-2 font-mono text-[11.5px] text-ink shadow-btn
                transition-colors duration-100 hover:bg-hover"
              style={{ animation: `pop-in 250ms cubic-bezier(0.23,1,0.32,1) ${i * 80}ms both` }}
            >
              <span className="min-w-0 truncate">{d.file}</span>
              <span className="shrink-0 text-green tabular-nums">+{d.add}</span>
              {d.del > 0 && <span className="shrink-0 text-red tabular-nums">−{d.del}</span>}
            </span>
          ))}
        </div>
      )}
        </div>
      </div>
    </div>
  );
}
