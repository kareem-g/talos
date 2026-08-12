import { useState } from "react";

/* ─────────────────────────────────────────────────────────
 * TASK ROWS (Beautiful UI collection, adapted for live data)
 * Spinner rings while running, red/green badges on failure
 * and completion, expandable detail steps. The demo's timed
 * status run is replaced by props so rows mirror real task
 * state; staggered entry and expansion motion are unchanged.
 * ───────────────────────────────────────────────────────── */

function SpinnerRing({ active, children }: { active?: boolean; children?: React.ReactNode }) {
  const size = 24, stroke = 2;
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  return (
    <span className="relative inline-flex shrink-0 items-center justify-center" style={{ width: size, height: size }}>
      <svg
        width={size} height={size} className="absolute inset-0"
        style={active ? { animation: "spin 1.1s linear infinite" } : undefined}
      >
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--line)" strokeWidth={stroke} />
        {active && (
          <circle
            cx={size / 2} cy={size / 2} r={r} fill="none"
            stroke="var(--ink-3)" strokeWidth={stroke} strokeLinecap="round"
            strokeDasharray={`${c * 0.28} ${c * 0.72}`}
          />
        )}
      </svg>
      <span className="relative text-[10.5px] font-semibold tabular-nums text-ink">{children}</span>
    </span>
  );
}

function Badge({ tone, children }: { tone: "red" | "green"; children: React.ReactNode }) {
  return (
    <span
      className={`flex size-5.5 shrink-0 items-center justify-center rounded-full text-white
        ${tone === "red" ? "bg-red" : "bg-green"}`}
      style={{ animation: "pop-in 300ms cubic-bezier(0.23,1,0.32,1) both" }}
    >
      {children}
    </span>
  );
}

const XIcon = (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round"><path d="M18 6L6 18M6 6l12 12" /></svg>
);
const CheckIcon = (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3.5" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
);
const RetryIcon = (
  <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M21 12a9 9 0 1 1-2.64-6.36M21 3v6h-6" /></svg>
);

export type TaskRowState = "pending" | "running" | "failed" | "done";

export type TaskRowItem = {
  key: string;
  label: string;
  amount?: string;
  state: TaskRowState;
  /** Number rendered inside the spinner ring while running/pending. */
  ring?: number;
  details?: { label: string; meta: string }[];
};

export default function TaskRows({
  rows,
  variant = "Capsules",
  defaultOpenKey,
  onRetry,
}: {
  rows: TaskRowItem[];
  variant?: "Capsules" | "List";
  defaultOpenKey?: string;
  onRetry?: (key: string) => void;
}) {
  const [manualOpen, setManualOpen] = useState<Record<string, boolean>>({});
  const list = variant === "List";

  if (rows.length === 0) return null;

  return (
    <div
      className={`flex w-full max-w-110 flex-col ${
        list ? "gap-0 self-start overflow-hidden rounded-card bg-surface shadow-card" : "gap-2"
      }`}
    >
      {rows.map((row, i) => {
        const open = manualOpen[row.key] ?? row.key === defaultOpenKey;
        const badge =
          row.state === "failed" ? (
            <Badge tone="red">{XIcon}</Badge>
          ) : row.state === "done" ? (
            <Badge tone="green">{CheckIcon}</Badge>
          ) : (
            <SpinnerRing active={row.state === "running"}>{row.ring ?? i + 1}</SpinnerRing>
          );
        const pill =
          row.state === "failed" ? (
            <button
              type="button"
              onClick={() => onRetry?.(row.key)}
              className="inline-flex h-5.5 items-center gap-1.5 rounded-full bg-red-tint px-2 text-[11.5px] font-medium text-red transition-colors duration-100 hover:bg-red-tint"
              style={{ animation: "fade-in 200ms ease-out both" }}
            >
              Failed {onRetry && <span style={{ animation: "spin 1.2s linear infinite" }} className="flex">{RetryIcon}</span>}
            </button>
          ) : row.state === "done" ? (
            <span className="inline-flex h-5.5 items-center gap-1.5 rounded-full bg-green-tint px-2 text-[11.5px] font-medium text-green" style={{ animation: "fade-in 200ms ease-out both" }}>
              Completed
            </span>
          ) : null;
        return (
          <div
            key={row.key}
            className={`self-stretch overflow-hidden transition-[border-radius] duration-300 ${
              list ? "border-b border-line last:border-0" : "bg-surface shadow-card"
            }`}
            style={{
              borderRadius: list ? 0 : open ? 14 : 22,
              animation: `fade-up 450ms cubic-bezier(0.23,1,0.32,1) ${i * 80}ms both`,
            }}
          >
            <button
              type="button"
              aria-expanded={open}
              onClick={() => setManualOpen((current) => ({ ...current, [row.key]: !open }))}
              className="flex h-11 w-full items-center gap-2.5 px-2.5 text-left transition-colors duration-100 hover:bg-inset"
            >
              <span className="flex size-6 shrink-0 items-center justify-center">
                {badge}
              </span>
              <span className="min-w-0 flex-1 truncate text-[13px] font-medium text-ink">
                {row.label}
              </span>
              {row.amount && <span className="text-[12.5px] text-ink-2 tabular-nums">{row.amount}</span>}
              {pill}
              <span
                aria-hidden="true"
                className="-ml-2 flex size-7 shrink-0 items-center justify-center rounded-full text-ink-3"
              >
                <svg
                  width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
                  className="transition-transform duration-300"
                  style={{ transform: open ? "rotate(180deg)" : "rotate(0)" }}
                >
                  <path d="M6 9l6 6 6-6" />
                </svg>
              </span>
            </button>

            {/* dropdown detail — same expandable grammar as Chain of Thought */}
            {row.details && row.details.length > 0 && (
              <div
                className="grid transition-[grid-template-rows,opacity] duration-300"
                style={{
                  gridTemplateRows: open ? "1fr" : "0fr",
                  opacity: open ? 1 : 0,
                  transitionTimingFunction: "cubic-bezier(0.23, 1, 0.32, 1)",
                }}
              >
                <div className="overflow-hidden">
                  <div className="mb-2.5 grid grid-cols-[24px_1fr] gap-2.5 px-2.5">
                    <span aria-hidden className="mx-auto h-full w-px bg-line" />
                    <div className="flex flex-col gap-1.5">
                      {row.details.map((d, j) => (
                        <div
                          key={d.label}
                          className="flex items-center justify-between"
                          style={
                            open
                              ? { animation: `fade-up 300ms cubic-bezier(0.23,1,0.32,1) ${120 + j * 100}ms both` }
                              : undefined
                          }
                        >
                          <span className="text-[12px] text-ink-2">{d.label}</span>
                          <span className="font-mono text-[11.5px] text-ink-3 tabular-nums">
                            {d.meta}
                          </span>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
