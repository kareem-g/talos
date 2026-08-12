import { useLayoutEffect, useRef, useState } from "react";

/* ─────────────────────────────────────────────────────────
 * PROMPT BAR (Beautiful UI collection, adapted for live data)
 * A composer with real controls: attach, a model/agent
 * picker, and send. Variants: Rounded (card radius) ·
 * Pill (full radius).
 * The glimm shader sweep, @/slash demo menus, dictation
 * simulation and autoplay loop were removed — the composer
 * is wired to the app's send path. Autosize grid layout,
 * gliding model-picker highlight, focus ring and the
 * tactile send button are unchanged from the collection.
 * ───────────────────────────────────────────────────────── */

function Icon({ children, size = 15, strokeWidth = 1.8 }: { children: React.ReactNode; size?: number; strokeWidth?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

export type PromptModel = { key: string; name: string; tag?: string };

export default function PromptBar({
  variant = "Rounded",
  placeholder = "Write a message…",
  disabled = false,
  onSend,
  onPlus,
  model,
  models,
  onModelChange,
  autoFocus = false,
}: {
  variant?: "Rounded" | "Pill";
  placeholder?: string;
  disabled?: boolean;
  onSend: (text: string) => void;
  /** Shows the + button when provided. */
  onPlus?: () => void;
  model?: PromptModel;
  models?: PromptModel[];
  onModelChange?: (model: PromptModel) => void;
  autoFocus?: boolean;
}) {
  const pill = variant === "Pill";
  const [draft, setDraft] = useState("");
  const [modelOpen, setModelOpen] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [modelBox, setModelBox] = useState<{ top: number; height: number } | null>(null);
  const [modelHovered, setModelHovered] = useState<number | null>(null);
  const controlsRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const measureRef = useRef<HTMLSpanElement>(null);
  const modelRef = useRef<HTMLButtonElement>(null);
  const modelRowRefs = useRef<(HTMLButtonElement | null)[]>([]);

  const pickerModels = models ?? [];
  const hasPicker = Boolean(model && pickerModels.length > 0);
  const modelIndex = model ? pickerModels.findIndex((m) => m.key === model.key) : -1;

  /* gliding highlight in the model menu — floats to the hovered
   * row, falling back to the currently-selected model */
  useLayoutEffect(() => {
    if (!modelOpen) return;
    const target = modelRowRefs.current[modelHovered ?? Math.max(0, modelIndex)];
    if (target) setModelBox({ top: target.offsetTop, height: target.offsetHeight });
  }, [modelOpen, modelHovered, modelIndex]);

  useLayoutEffect(() => {
    if (!modelOpen) setModelHovered(null);
  }, [modelOpen]);

  /* Move wrapped text above the controls, then grow to a compact maximum. */
  useLayoutEffect(() => {
    const input = inputRef.current;
    const controls = controlsRef.current;
    const measure = measureRef.current;
    if (!input || !controls || !measure) return;

    const modelWidth = modelRef.current?.offsetWidth ?? 0;
    const buttons = 1 + (hasPicker ? 1 : 0) + 1; // plus?, model?, send
    const fixedControlsWidth = 28 * buttons + modelWidth;
    const inlineGaps = 4 * 4;
    const inlineInputWidth = controls.clientWidth - fixedControlsWidth - inlineGaps;
    const needsFullWidth = draft.includes("\n") || measure.offsetWidth + 8 > inlineInputWidth;
    if (needsFullWidth !== expanded) {
      setExpanded(needsFullWidth);
    }

    const minHeight = 28;
    const maxHeight = 100;
    input.style.height = "0px";
    const contentHeight = input.scrollHeight;
    input.style.height = `${Math.min(Math.max(contentHeight, minHeight), maxHeight)}px`;
    input.style.overflowY = contentHeight > maxHeight ? "auto" : "hidden";
  }, [draft, expanded, hasPicker]);

  const canSend = draft.trim().length > 0 && !disabled;
  const send = () => {
    if (!canSend) return;
    onSend(draft.trim());
    setDraft("");
    setModelOpen(false);
    if (inputRef.current) inputRef.current.style.height = "auto";
  };

  return (
    <div className="flex w-full flex-col">
      {/* composer is the anchor — menus grow up from its top edge */}
      <div className="relative">
      {/* ── model menu ─────────────────────────────────── */}
      {modelOpen && hasPicker && (
        <div
          onMouseLeave={() => setModelHovered(null)}
          className="absolute right-0 bottom-full z-10 mb-2 w-44 rounded-[10px] bg-surface p-1 shadow-raised"
          style={{ animation: "pop-in 180ms cubic-bezier(0.23,1,0.32,1) both", transformOrigin: "bottom right" }}
        >
          {/* single gliding highlight — floats to the hovered / selected row */}
          <span
            aria-hidden
            className="pointer-events-none absolute inset-x-1 rounded-[6px] bg-hover"
            style={{
              top: modelBox?.top ?? 0,
              height: modelBox?.height ?? 0,
              opacity: modelBox && modelHovered !== null ? 1 : 0,
              transition:
                "top 220ms cubic-bezier(0.23,1,0.32,1), height 220ms cubic-bezier(0.23,1,0.32,1), opacity 150ms ease",
            }}
          />
          {pickerModels.map((m, i) => (
            <button
              key={m.key}
              type="button"
              ref={(el) => {
                modelRowRefs.current[i] = el;
              }}
              onMouseDown={(event) => event.preventDefault()}
              onMouseEnter={() => setModelHovered(i)}
              onClick={() => {
                onModelChange?.(m);
                setModelOpen(false);
                inputRef.current?.focus();
              }}
              className="relative z-10 flex h-7.5 w-full items-center gap-2 rounded-[6px] px-2 text-left"
            >
              <span className="min-w-0 flex-1 truncate text-[12.5px] font-medium text-ink">{m.name}</span>
              {m.tag && <span className="shrink-0 text-[11px] text-ink-3">{m.tag}</span>}
              <span className={`shrink-0 text-ink ${model && m.key === model.key ? "" : "invisible"}`}>
                <Icon size={13} strokeWidth={2.5}><path d="M20 6L9 17l-5-5" /></Icon>
              </span>
            </button>
          ))}
        </div>
      )}

      {/* ── composer ───────────────────────────────────── */}
      <div
        className={`relative isolate flex flex-col gap-1.5 overflow-hidden border border-line bg-surface p-1.5 shadow-card transition-[border-color,border-radius] duration-150 focus-within:border-line-strong ${
          pill ? (expanded ? "rounded-[24px]" : "rounded-full") : "rounded-[14px]"
        }`}
      >
        <span
          ref={measureRef}
          aria-hidden="true"
          className="pointer-events-none absolute invisible whitespace-pre text-[13px] leading-[18px]"
        >
          {draft}
        </span>

        <div
          ref={controlsRef}
          className={`grid items-end gap-x-1 gap-y-1.5 ${
            expanded
              ? `grid-cols-[minmax(0,1fr)${hasPicker ? "_auto" : ""}_28px]`
              : `grid-cols-[${onPlus ? "28px_" : ""}minmax(0,1fr)${hasPicker ? "_auto" : ""}_28px]`
          }`}
        >
          {onPlus && (
            <button
              type="button"
              aria-label="Add context"
              onClick={() => {
                setModelOpen(false);
                onPlus();
                inputRef.current?.focus();
              }}
              className={`flex size-7 shrink-0 items-center justify-center justify-self-start text-ink-3 transition-[background-color,color,transform] duration-150 hover:bg-hover hover:text-ink active:scale-[0.94] ${
                pill ? "rounded-full" : "rounded-[8px]"
              } ${expanded ? "col-start-1 row-start-2" : "col-start-1 row-start-1"}`}
            >
              <Icon size={16} strokeWidth={2}><path d="M12 5v14M5 12h14" /></Icon>
            </button>
          )}

          <textarea
            ref={inputRef}
            rows={1}
            value={draft}
            autoFocus={autoFocus}
            disabled={disabled}
            onChange={(event) => {
              setDraft(event.target.value);
              setModelOpen(false);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                setModelOpen(false);
                return;
              }
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                send();
              }
            }}
            placeholder={placeholder}
            aria-label="Prompt"
            className={`min-h-7 min-w-0 w-full resize-none bg-transparent px-1 py-[5px] text-[13px] leading-[18px] text-ink outline-none [overflow-wrap:anywhere] placeholder:text-ink-3 disabled:opacity-40 ${
              expanded ? "col-span-full col-start-1 row-start-1" : `${onPlus ? "col-start-2" : "col-start-1"} row-start-1`
            }`}
          />

          {/* model / agent picker */}
          {hasPicker && (
            <button
              ref={modelRef}
              type="button"
              aria-expanded={modelOpen}
              aria-label="Choose agent"
              onClick={() => setModelOpen((current) => !current)}
              className={`flex h-7 shrink-0 items-center gap-1 px-1.5 text-[12px] font-medium text-ink-2 transition-colors duration-150 hover:bg-hover hover:text-ink ${
                pill ? "rounded-full" : "rounded-[8px]"
              } ${expanded ? "col-start-2 row-start-2" : `${onPlus ? "col-start-3" : "col-start-2"} row-start-1`}`}
            >
              {model?.name}
              <span className="text-ink-3">
                <Icon size={11} strokeWidth={2.4}><path d="M6 9l6 6 6-6" /></Icon>
              </span>
            </button>
          )}

          {/* send — tactile square (round in the pill variant) */}
          <button
            type="button"
            aria-label="Send"
            disabled={!canSend}
            onClick={send}
            className={`flex size-7 shrink-0 items-center justify-center transition-[background-color,color,transform] duration-200 enabled:active:scale-[0.94] ${
              pill ? "rounded-full" : "rounded-[8px]"
            } ${expanded ? `${hasPicker ? "col-start-3" : "col-start-2"} row-start-2` : `${onPlus ? "col-start-4" : hasPicker ? "col-start-3" : "col-start-2"} row-start-1`}`}
            style={{
              background: canSend ? "var(--ink)" : "var(--line-strong)",
              color: canSend ? "hsl(var(--surface))" : "var(--ink-2)",
            }}
          >
            <Icon size={16} strokeWidth={2.4}><path d="M12 19V5M5 12l7-7 7 7" /></Icon>
          </button>
        </div>
      </div>
      </div>
    </div>
  );
}
