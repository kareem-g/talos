import { useEffect, useState } from 'react'
import { Check, Copy, FileCode2, ChevronDown } from 'lucide-react'

/**
 * Code block adapted from Beautiful UI's Code Block.
 * Shows a filename header with copy control; optionally streams lines in.
 * Lazy-loads the copy state so large snippets don't re-render aggressively.
 */

export function CodeBlock({
  filename,
  code,
  language,
  streaming = false,
}: {
  filename?: string
  code: string
  language?: string
  streaming?: boolean
}) {
  const [copied, setCopied] = useState(false)
  const [collapsed, setCollapsed] = useState(false)
  const [shownLines, setShownLines] = useState<number | null>(streaming ? 0 : null)
  const lines = code.split('\n')

  useEffect(() => {
    if (!streaming) {
      setShownLines(null)
      return
    }
    let cancelled = false
    let index = 0
    const timer = setInterval(() => {
      if (cancelled) return
      index += 1
      setShownLines(index)
      if (index >= lines.length) clearInterval(timer)
    }, 70)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streaming])

  const visible = shownLines === null ? lines : lines.slice(0, shownLines)

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(code)
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {
      // clipboard unavailable — nothing to do
    }
  }

  return (
    <div className="ai-scroll-thin overflow-hidden rounded-lg border border-border bg-surface ai-hairline" data-ai-anim>
      <div className="flex items-center gap-2 border-b border-border/70 px-3 py-1.5">
        <FileCode2 className="h-3.5 w-3.5 shrink-0 text-text-muted" />
        {filename && <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-text-muted">{filename}</span>}
        {language && !filename && <span className="min-w-0 flex-1 truncate font-mono text-[11.5px] text-text-muted">{language}</span>}
        <button
          onClick={() => setCollapsed((value) => !value)}
          className="flex h-6 w-6 items-center justify-center rounded-md text-text-muted hover:bg-surface-hover"
          aria-label={collapsed ? 'Expand code' : 'Collapse code'}
        >
          <ChevronDown className={`h-3.5 w-3.5 transition-transform ${collapsed ? 'rotate-180' : ''}`} />
        </button>
        <button
          onClick={() => void copy()}
          className="flex h-6 items-center gap-1 rounded-md px-1.5 text-[11px] text-text-muted hover:bg-surface-hover hover:text-text"
          aria-label="Copy code"
        >
          {copied ? <Check className="h-3 w-3 text-success" /> : <Copy className="h-3 w-3" />}
          {copied ? 'Copied' : 'Copy'}
        </button>
      </div>
      {!collapsed && (
        <pre className="ai-scroll-thin max-h-80 overflow-auto p-3 font-mono text-[11.5px] leading-5 text-text">
          <code>{visible.join('\n')}</code>
        </pre>
      )}
    </div>
  )
}