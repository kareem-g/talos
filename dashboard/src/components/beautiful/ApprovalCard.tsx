import { useState } from "react";

/* ─────────────────────────────────────────────────────────
 * APPROVAL CARD (human-in-the-loop)
 * (Beautiful UI collection, adapted for live question data)
 * One question at a time; the circular arrow sends the
 * answer; single-choice questions auto-send after a beat.
 * Choices and submission are directly controlled. The demo's
 * multi-question pager is replaced by real question payloads,
 * which the backend already delivers one at a time.
 * ───────────────────────────────────────────────────────── */

export type ApprovalQuestion = {
  title: string;
  type: "radio" | "check";
  options: string[];
  allowsCustom?: boolean;
};

export default function ApprovalCard({
  question,
  onSubmit,
  answered,
  answeredSelection = [],
  answeredCustom,
  disabled = false,
}: {
  question: ApprovalQuestion;
  onSubmit: (selected: string[], customText: string | null) => void | Promise<void>;
  /** Renders the settled "Answers sent" state with the chosen options. */
  answered?: boolean;
  answeredSelection?: string[];
  answeredCustom?: string;
  disabled?: boolean;
}) {
  const [selected, setSelected] = useState<number[]>([]);
  const [custom, setCustom] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(Boolean(answered));
  const hasAnswer = selected.length > 0 || Boolean(custom.trim());

  const submit = async (picked: number[], customText: string) => {
    if (sending || sent || disabled) return;
    setSending(true);
    try {
      const labels = picked.map((index) => question.options[index]).filter(Boolean);
      await onSubmit(labels, customText.trim() || null);
      setSent(true);
    } finally {
      setSending(false);
    }
  };

  const toggle = (index: number) => {
    if (sent || sending || disabled) return;
    if (question.type === "radio") {
      setSelected([index]);
      setCustom("");
      // single-choice auto-sends after a beat, like the collection demo auto-advanced
      window.setTimeout(() => void submit([index], ""), 480);
    } else {
      setSelected((current) =>
        current.includes(index) ? current.filter((item) => item !== index) : [...current, index],
      );
    }
  };

  const sentLabels = sent
    ? (answeredSelection.length > 0 ? answeredSelection : selected.map((index) => question.options[index]).filter(Boolean))
    : [];

  return (
    <div className="flex w-full max-w-80 flex-col items-stretch">
      <div className="w-full self-start overflow-hidden rounded-card bg-surface shadow-card">
        {sent ? (
          <div className="flex min-h-37 flex-col items-center justify-center gap-2 px-4 py-6">
            <span
              className="flex size-6 items-center justify-center rounded-full bg-green text-white"
              style={{ animation: "pop-in 300ms cubic-bezier(0.23,1,0.32,1) both" }}
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
            </span>
            <span className="text-[13px] font-medium text-ink" style={{ animation: "fade-up 350ms cubic-bezier(0.23,1,0.32,1) 100ms both" }}>
              Answer sent
            </span>
            {(sentLabels.length > 0 || answeredCustom) && (
              <span className="max-w-full text-center text-[12px] text-ink-2" style={{ animation: "fade-up 350ms cubic-bezier(0.23,1,0.32,1) 160ms both" }}>
                {sentLabels.join(", ")}{answeredCustom ? `${sentLabels.length ? " · " : ""}${answeredCustom}` : ""}
              </span>
            )}
          </div>
        ) : (
          <div className="primitive-card-pad" style={{ animation: "fade-up 350ms cubic-bezier(0.23,1,0.32,1) both" }}>
            <span className="block text-[13px] font-medium text-ink">{question.title}</span>
            <div className="mt-2 flex flex-col gap-0.5">
              {question.options.map((option, i) => {
                const on = selected.includes(i);
                return (
                  <button
                    key={option}
                    type="button"
                    aria-pressed={on}
                    disabled={disabled || sending}
                    onClick={() => toggle(i)}
                    className="-mx-1.5 flex items-center gap-2 rounded-control px-1.5 py-1 text-left transition-colors duration-100 hover:bg-hover"
                  >
                    <span
                      className={`flex size-4 shrink-0 items-center justify-center transition-colors duration-200
                        ${question.type === "radio" ? "rounded-full" : "rounded-[5px]"}
                        ${on ? "bg-ink text-canvas" : "shadow-[inset_0_0_0_1.5px_var(--line-strong)] text-transparent"}`}
                    >
                      {question.type === "radio" ? (
                        <span className="size-1.5 rounded-full bg-canvas transition-transform duration-200" style={{ transform: on ? "scale(1)" : "scale(0)" }} />
                      ) : (
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
                      )}
                    </span>
                    <span className={`text-[13px] transition-colors duration-200 ${on ? "text-ink" : "text-ink-2"}`}>
                      {option}
                    </span>
                  </button>
                );
              })}
              {question.allowsCustom !== false && (
                <label className="-mx-1.5 flex items-center gap-2 rounded-control px-1.5 py-1 transition-colors duration-100 focus-within:bg-hover hover:bg-hover">
                  <span aria-hidden="true" className="size-4 shrink-0" />
                  <input
                    value={custom}
                    onChange={(event) => {
                      setCustom(event.target.value);
                      if (question.type === "radio") setSelected([]);
                    }}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" && hasAnswer) void submit(selected, custom);
                    }}
                    placeholder="Type something…"
                    aria-label="Custom answer"
                    disabled={disabled || sending}
                    className="min-w-0 flex-1 bg-transparent text-[13px] text-ink outline-none placeholder:text-ink-3"
                  />
                </label>
              )}
            </div>
          </div>
        )}

        {/* footer — send arrow */}
        {!sent && (
          <div className="primitive-card-footer flex items-center justify-between">
            <span className="text-[11.5px] text-ink-3">
              {sending ? "Sending…" : question.type === "check" ? "Pick any that apply" : "Pick one"}
            </span>
            <button
              type="button"
              aria-label="Send answer"
              disabled={!hasAnswer || disabled || sending}
              onClick={() => void submit(selected, custom)}
              className="-mr-0.5 flex size-7 items-center justify-center rounded-[8px] transition-[background-color,color,transform] duration-200 enabled:active:scale-[0.96] disabled:opacity-60"
              style={{
                background: hasAnswer ? "var(--ink)" : "var(--field)",
                color: hasAnswer ? "hsl(var(--surface))" : "var(--ink-3)",
                boxShadow: hasAnswer ? "inset 0 1px 0 rgba(255,255,255,0.14)" : "var(--shadow-btn)",
              }}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M12 19V5M5 12l7-7 7 7" />
              </svg>
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
