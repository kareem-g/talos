import { useCallback, useEffect, useRef, useState } from "react";

/* ─────────────────────────────────────────────────────────
 * CODE BLOCK (Beautiful UI collection, adapted for live data)
 * Agent-written code streams line by line; copy is live.
 * The demo constants were replaced with props so the block
 * renders real agent output, but the token palette, line
 * fade-up reveal, caret and copy control are unchanged.
 * ───────────────────────────────────────────────────────── */

type Tok = { t: string; c?: "kw" | "str" | "num" | "fn" | "dim" };

const COLORS: Record<string, string> = {
  kw: "var(--accent-ink)",
  str: "var(--green)",
  num: "var(--orange)",
  fn: "var(--ink)",
  dim: "var(--ink-3)",
};

const KEYWORDS = new Set([
  "export", "import", "from", "const", "let", "var", "function", "return",
  "async", "await", "if", "else", "for", "while", "switch", "case", "break",
  "continue", "new", "class", "extends", "interface", "type", "enum", "try",
  "catch", "finally", "throw", "typeof", "instanceof", "in", "of", "null",
  "undefined", "true", "false", "this", "def", "lambda", "pass", "None",
  "True", "False", "fn", "pub", "struct", "impl", "match", "use", "mut",
]);

/** Lightweight tokenizer that keeps the collection's token palette for real code. */
function tokenize(line: string): Tok[] {
  const tokens: Tok[] = [];
  const re = /("(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*'|`(?:[^`\\]|\\.)*`)|(\b\d[\d_.]*\b)|([A-Za-z_$][\w$]*)|(\s+)|(.)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(line)) !== null) {
    const [, str, num, word, space, other] = match;
    if (str !== undefined) tokens.push({ t: str, c: "str" });
    else if (num !== undefined) tokens.push({ t: num, c: "num" });
    else if (word !== undefined) {
      const next = line.slice(re.lastIndex).match(/^\s*\(/);
      if (KEYWORDS.has(word)) tokens.push({ t: word, c: "kw" });
      else if (next) tokens.push({ t: word, c: "fn" });
      else tokens.push({ t: word });
    } else if (space !== undefined) tokens.push({ t: space, c: "dim" });
    else if (other !== undefined) tokens.push({ t: other, c: "dim" });
  }
  return tokens;
}

export default function CodeBlock({
  filename,
  language,
  code,
  streaming = false,
}: {
  filename?: string;
  language?: string;
  code: string;
  streaming?: boolean;
}) {
  const [copied, setCopied] = useState(false);
  const lines = code.replace(/\n$/, "").split("\n");
  const done = !streaming;

  // Only newly appended lines get the fade-up reveal so history renders calmly.
  const previousCount = useRef(lines.length);
  useEffect(() => {
    previousCount.current = lines.length;
  }, [lines.length]);
  const animatedFrom = streaming ? Math.max(0, previousCount.current - 1) : lines.length;

  const copy = useCallback(() => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    }).catch(() => undefined);
  }, [code]);

  return (
    <div className="w-full overflow-hidden rounded-card bg-surface shadow-card">
      {/* header */}
      <div className="primitive-card-bar flex items-center justify-between border-b border-line">
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="truncate font-mono text-[12px] font-medium text-ink">{filename || "code"}</span>
          {language && <span className="shrink-0 text-[11.5px] text-ink-3">{language}</span>}
        </span>
        <button
          aria-label="Copy code"
          onClick={copy}
          className={`flex h-6 shrink-0 items-center gap-1 rounded-[6px] px-1.5 text-[11.5px]
            font-medium transition-colors duration-100 hover:bg-hover
            ${copied ? "text-green" : "text-ink-3 hover:text-ink"}`}
        >
          {copied ? (
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"><path d="M20 6L9 17l-5-5" /></svg>
          ) : (
            <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="12" height="12" rx="2.5" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
          )}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>

      {/* code */}
      <pre className="ai-scroll-thin max-h-96 overflow-auto bg-inset px-3 py-2.5 font-mono text-[11.5px] leading-[1.7]">
        {lines.map((line, i) => (
          <div
            key={i}
            className="flex"
            style={i >= animatedFrom ? { animation: "fade-up 250ms cubic-bezier(0.23,1,0.32,1) both" } : undefined}
          >
            <span className="w-5 shrink-0 text-right text-[10.5px] leading-[1.86] text-ink-3/60 select-none">
              {i + 1}
            </span>
            <span className="pl-2.5 whitespace-pre">
              {tokenize(line).map((tok, j) => (
                <span key={j} style={{ color: tok.c ? COLORS[tok.c] : "var(--ink-2)" }}>
                  {tok.t}
                </span>
              ))}
              {i === lines.length - 1 && !done && (
                <span className="ml-0.5 inline-block h-3 w-[3px] translate-y-0.5 rounded-full bg-accent" />
              )}
            </span>
          </div>
        ))}
      </pre>
    </div>
  );
}
