import { useEffect, useState } from 'react'
import { User as UserIcon, Bot } from 'lucide-react'

/**
 * AI message bubble adapted from Beautiful UI's Streaming Text.
 * Assistant text resolves word-by-word out of blur while streaming, then settles.
 * Inline fenced code blocks render as compact, scrollable code pieces.
 */

function renderInline(text: string) {
  const parts = text.split(/(```[\w-]*\n[\s\S]*?```)/g)
  return parts.map((part, index) => {
    const match = part.match(/^```([\w-]*)\n([\s\S]*?)```$/)
    if (match) {
      return (
        <pre
          key={index}
          className="ai-scroll-thin overflow-x-auto rounded-lg border border-border bg-background/60 p-2.5 font-mono text-[11.5px] leading-5 text-text"
        >
          <code>{match[2]}</code>
        </pre>
      )
    }
    return part.trim() ? (
      <p key={index} className="whitespace-pre-wrap break-words">
        {part}
      </p>
    ) : null
  })
}

export function AiMessage({
  role,
  content,
  streaming = false,
}: {
  role: 'user' | 'assistant'
  content: string
  streaming?: boolean
}) {
  const [revealed, setRevealed] = useState(streaming ? 0 : content.length)
  const words = content.split(' ')
  const isUser = role === 'user'

  // Drive streaming reveal.
  useEffect(() => {
    if (!streaming) {
      setRevealed(content.length)
      return
    }
    let cancelled = false
    const interval = setInterval(() => {
      if (cancelled) return
      setRevealed((current) => Math.min(current + 1, words.length))
    }, 55)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [streaming, content])

  const done = revealed >= words.length || !streaming
  const shown = words.slice(0, revealed).join(' ')

  return (
    <div className={`flex w-full gap-2 ${isUser ? 'flex-row-reverse' : ''}`}>
      <span
        className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg ${
          isUser ? 'bg-accent/15 text-accent' : 'bg-surface-active text-text-muted'
        }`}
      >
        {isUser ? <UserIcon className="h-3.5 w-3.5" /> : <Bot className="h-3.5 w-3.5" />}
      </span>
      <div
        className={`min-w-0 max-w-[85%] rounded-xl border px-3 py-2 text-[13px] leading-6 ${
          isUser ? 'ml-8 border-accent/20 bg-accent/10' : 'mr-8 border-border bg-surface'
        }`}
      >
        <div className="space-y-2">
          {renderInline(streaming ? shown : content)}
          {!done && streaming && (
            <span className="ml-0.5 inline-block h-3.5 w-[2px] translate-y-0.5 animate-pulse bg-accent" style={{ animation: 'ai-caret 0.9s steps(1) infinite' }} />
          )}
        </div>
      </div>
    </div>
  )
}