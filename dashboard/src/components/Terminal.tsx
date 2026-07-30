import { useRef, useEffect, forwardRef } from 'react'
import { Terminal as TerminalIcon } from 'lucide-react'

interface TerminalProps {
  output: string[]
  onInput?: (data: string) => void
  className?: string
}

export const Terminal = forwardRef<HTMLDivElement, TerminalProps>(
  ({ output, className = '' }, ref) => {
    const scrollRef = useRef<HTMLDivElement>(null)

    useEffect(() => {
      if (scrollRef.current) {
        scrollRef.current.scrollTop = scrollRef.current.scrollHeight
      }
    }, [output])

    return (
      <div 
        ref={ref}
        className={`flex flex-col bg-terminal-bg rounded-lg border border-border overflow-hidden ${className}`}
      >
        {/* Terminal Header */}
        <div className="h-8 bg-surface border-b border-border flex items-center px-3 gap-2 shrink-0">
          <TerminalIcon className="w-3.5 h-3.5 text-text-dim" />
          <span className="text-[11px] text-text-muted font-mono">bash</span>
          <div className="flex-1" />
          <div className="flex gap-1.5">
            <div className="w-2.5 h-2.5 rounded-full bg-terminal-red/60" />
            <div className="w-2.5 h-2.5 rounded-full bg-terminal-yellow/60" />
            <div className="w-2.5 h-2.5 rounded-full bg-terminal-green/60" />
          </div>
        </div>

        {/* Terminal Content */}
        <div 
          ref={scrollRef}
          className="flex-1 overflow-auto p-3 font-mono text-sm"
        >
          {output.map((line, i) => (
            <div key={i} className="text-terminal-fg whitespace-pre-wrap break-all">
              {line || ' '}
            </div>
          ))}
        </div>
      </div>
    )
  }
)

Terminal.displayName = 'Terminal'
