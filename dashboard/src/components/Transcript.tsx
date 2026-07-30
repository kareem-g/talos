import { useRef, useEffect } from 'react'
import { useWebSocket } from '../hooks/useWebSocket'

interface TranscriptProps {
  sessionId: string
}

interface TranscriptChunk {
  id: string
  content: string
  kind: 'stdout' | 'stderr' | 'plan' | 'diff' | 'tool_call' | 'approval' | 'system'
  timestamp: string
}

export function Transcript({ sessionId }: TranscriptProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const { messages } = useWebSocket()

  // Filter messages for this session
  const chunks: TranscriptChunk[] = messages
    .filter((m: any) => m.type === 'TranscriptChunk' && m.payload?.session_id === sessionId)
    .map((m: any, i: number) => ({
      id: `${sessionId}-${i}`,
      content: m.payload?.chunk || '',
      kind: m.payload?.kind || 'stdout',
      timestamp: new Date().toISOString(),
    }))

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [chunks.length])

  return (
    <div 
      ref={scrollRef}
      className="flex-1 overflow-auto p-4 font-mono text-sm space-y-1"
    >
      {chunks.length === 0 ? (
        <div className="flex items-center justify-center h-full text-text-dim text-xs">
          <span>Waiting for output...</span>
        </div>
      ) : (
        chunks.map((chunk) => (
          <div 
            key={chunk.id}
            className={`whitespace-pre-wrap break-all ${
              chunk.kind === 'stderr' ? 'text-terminal-red' :
              chunk.kind === 'plan' ? 'text-terminal-cyan' :
              chunk.kind === 'diff' ? 'text-terminal-yellow' :
              chunk.kind === 'tool_call' ? 'text-terminal-magenta' :
              chunk.kind === 'system' ? 'text-text-dim italic' :
              'text-terminal-fg'
            }`}
          >
            {chunk.content}
          </div>
        ))
      )}
    </div>
  )
}
