import { useRef, useEffect, useState } from 'react'
import { AlertCircle, Check } from 'lucide-react'
import { useWebSocket } from '../hooks/useWebSocket'
import { cleanTerminalText, normalizedText } from '../lib/terminalText'
import { QuestionCard } from './QuestionCard'
import { Thinking } from './ai/Thinking'
import { CodeBlock } from './ai/CodeBlock'
import { ToolActivityRow, type ToolActivityItem } from './ai/ToolActivity'
import type { MobileQuestion } from '../types/mobile'

interface TranscriptProps {
  sessionId: string
}

interface TranscriptItem {
  id: string
  content: string
  kind: 'user' | 'agent' | 'system' | 'error' | 'activity' | 'question'
  question?: MobileQuestion
  timestamp: string
  source: 'ws' | 'history'
  event?: { kind: string; payload: Record<string, unknown>; duration_ms?: number }
}

/** Maps a semantic AgentEvent to a compact tool row for the AI activity feed. */
function activityEventToTool(event: TranscriptItem['event']): ToolActivityItem | null {
  if (!event) return null
  const payload = event.payload || {}
  const kind = event.kind
  const duration = typeof event.duration_ms === 'number' ? `${(event.duration_ms / 1000).toFixed(1)}s` : undefined
  let label = kind.replace(/_/g, ' ')
  let icon: ToolActivityItem['icon'] = 'tool'

  if (kind.includes('search')) {
    icon = 'search'
    label = `Search${payload.query ? ` · ${String(payload.query)}` : ''}`
  } else if (kind.includes('file') || kind.includes('edit') || kind.includes('read')) {
    label = `${kind.includes('edit') ? 'Editing' : kind.includes('read') ? 'Reading' : 'File'} ${payload.path ? String(payload.path) : ''}`
  } else if (kind.includes('command')) {
    icon = 'command'
    label = `$ ${payload.command ? String(payload.command) : 'command'}`
  } else if (kind.includes('tool')) {
    label = payload.tool_name ? String(payload.tool_name) : label
  }

  const isStart = /_started$/.test(kind)
  const isFail = /failed|error$/.test(kind)
  return {
    id: `event-${kind}-${String(payload.path || payload.query || payload.tool_name || payload.command || '')}-${event.duration_ms ?? ''}`,
    label,
    state: isFail ? 'failed' : isStart ? 'running' : 'completed',
    detail: payload.detail ? String(payload.detail) : undefined,
    duration,
    icon,
  }
}

const kindStyle = (kind: string) => {
  switch (kind) {
    case 'user':
      return 'bg-accent/10 border-accent/20 ml-8'
    case 'agent':
      return 'bg-surface-hover border-border mr-8'
    case 'system':
      return 'bg-surface-active border-border/50 mx-12 text-center text-xs italic'
    case 'error':
      return 'bg-error/10 border-error/20 mx-8 text-sm'
    case 'activity':
      return 'bg-surface-active/50 border-border/50 mx-8 text-xs'
    case 'question':
      return 'mx-2 max-w-full border-transparent bg-transparent p-0'
    default:
      return 'bg-surface-hover border-border mr-8'
  }
}

const textStyle = (kind: string) => {
  switch (kind) {
    case 'user':
      return 'text-text'
    case 'agent':
      return 'text-terminal-fg'
    case 'system':
      return 'text-text-dim'
    case 'error':
      return 'text-error'
    case 'activity':
      return 'text-text-muted'
    case 'question':
      return 'text-text'
    default:
      return 'text-terminal-fg'
  }
}

const alignClass = (kind: string) => {
  switch (kind) {
    case 'user':
      return 'justify-end'
    case 'agent':
      return 'justify-start'
    case 'system':
    case 'error':
      return 'justify-center'
    case 'activity':
      return 'justify-center'
    case 'question':
      return 'justify-center'
    default:
      return 'justify-start'
  }
}

export function Transcript({ sessionId }: TranscriptProps) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const { messages, sendMessage } = useWebSocket()
  const [history, setHistory] = useState<TranscriptItem[]>([])
  const [loading, setLoading] = useState(true)
  const seenIds = useRef(new Set<string>())

  // Fetch transcript history from API on mount
  useEffect(() => {
    let cancelled = false
    setLoading(true)
    console.log(`[AgentDeck][Persistence] Loading transcript history for session=${sessionId}`)

    fetch(`/api/sessions/${sessionId}/transcripts`)
      .then((res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return res.json()
      })
      .then((data) => {
        if (cancelled) return
        const legacyItems: TranscriptItem[] = (data.transcripts || []).filter((t: any) => t.kind !== 'raw').map((t: any, i: number) => ({
          id: `hist-${t.id || i}`,
          content: cleanTerminalText(t.content || ''),
          kind: (t.kind === 'user' || t.kind === 'agent' || t.kind === 'system' || t.kind === 'error') ? t.kind : 'agent',
          timestamp: t.timestamp || new Date().toISOString(),
          source: 'history' as const,
        }))
        const semanticMessages: TranscriptItem[] = (data.messages || []).map((message: any) => ({
          id: `message-${message.id}`,
          content: message.content || '',
          kind: message.role === 'user' ? 'user' : message.role === 'assistant' ? 'agent' : 'system',
          timestamp: message.timestamp || new Date().toISOString(),
          source: 'history' as const,
        }))
        const answeredQuestions = new Map<string, any>()
        ;(data.events || []).filter((event: any) => event.kind === 'question_answered').forEach((event: any) => answeredQuestions.set(String(event.payload?.question_id || ''), event.payload))
        const semanticEvents: TranscriptItem[] = (data.events || []).flatMap((event: any) => {
          const payload = event.payload || {}
          if (event.kind === 'assistant_text') return [{ id: `event-${event.event_id}`, content: String(payload.text || ''), kind: 'agent' as const, timestamp: event.timestamp, source: 'history' as const }]
          if (event.kind === 'question_started') {
            const question = { ...payload, ...(answeredQuestions.has(String(payload.question_id)) ? { ...answeredQuestions.get(String(payload.question_id)), status: 'answered' } : {}) } as MobileQuestion
            return [{ id: `event-${event.event_id}`, content: '', kind: 'question' as const, question, timestamp: event.timestamp, source: 'history' as const }]
          }
          if (event.kind === 'agent_completed' || event.kind === 'thinking_started' || event.kind === 'thinking_finished' || event.kind === 'tool_started' || event.kind === 'tool_finished' || event.kind === 'file_edited' || event.kind === 'search_started' || event.kind === 'search_finished' || event.kind === 'command_started' || event.kind === 'command_finished') {
            return [{ id: `event-${event.event_id}`, content: activityLabel(event), kind: 'activity' as const, timestamp: event.timestamp, source: 'history' as const }]
          }
          return []
        })
        const items = [...legacyItems, ...semanticMessages, ...semanticEvents].filter((item) => item.kind === 'question' || item.content.trim()).sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime())
        // Mark all history IDs as seen to avoid duplicates from WS
        items.forEach(item => seenIds.current.add(item.id))
        console.log(`[AgentDeck][Persistence] Loaded ${items.length} transcript(s) for session=${sessionId}`)
        if (!cancelled) setHistory(items)
      })
      .catch((err) => {
        console.error(`[AgentDeck][Persistence] Failed to load transcripts:`, err)
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => { cancelled = true }
  }, [sessionId])

  // Process WebSocket messages
  const wsItems: TranscriptItem[] = []
  // Process messages in reverse to keep most recent at end
  for (const msg of messages) {
    if (msg.type === 'Message') {
      const message = msg.payload?.message as { id?: string; session_id?: string; role?: string; content?: string; timestamp?: string } | undefined
      if (message?.session_id === sessionId) {
        const content = cleanTerminalText(message.content || '')
        if (content) wsItems.push({ id: `message-${message.id || content}`, content, kind: message.role === 'user' ? 'user' : message.role === 'assistant' ? 'agent' : 'system', timestamp: message.timestamp || new Date().toISOString(), source: 'ws' })
      }
    } else if (msg.type === 'AgentEvent') {
      const event = msg.payload?.event as { event_id?: string; session_id?: string; kind?: string; payload?: Record<string, unknown>; timestamp?: string; duration_ms?: number } | undefined
      if (event?.session_id === sessionId) {
        if (event.kind === 'assistant_text') {
          const content = cleanTerminalText(String(event.payload?.text || ''))
          if (content) wsItems.push({ id: `event-${event.event_id || content}`, content, kind: 'agent', timestamp: event.timestamp || new Date().toISOString(), source: 'ws' })
        } else if (event.kind === 'question_started') {
          wsItems.push({ id: `event-${event.event_id || event.timestamp}`, content: '', question: event.payload as unknown as MobileQuestion, kind: 'question', timestamp: event.timestamp || new Date().toISOString(), source: 'ws' })
  } else {
    wsItems.push({
      id: `event-${event.event_id || `${event.kind}-${event.timestamp}`}`,
      content: activityLabel(event),
      kind: 'activity',
      timestamp: event.timestamp || new Date().toISOString(),
      source: 'ws',
      event: { kind: event.kind || '', payload: event.payload || {}, duration_ms: event.duration_ms },
    })
  }
      }
    } else if (msg.type === 'SessionError' && msg.payload?.session_id === sessionId) {
      wsItems.push({ id: `session-error-${msg.payload.code || msg.payload.message}`, content: String(msg.payload.message || 'Session error'), kind: 'error', timestamp: new Date().toISOString(), source: 'ws' })
    } else if (msg.type === 'TranscriptChunk' && msg.payload?.session_id === sessionId) {
      const chunk = cleanTerminalText((msg.payload.chunk as string) || '')
      const kind = (msg.payload.kind as string) || 'agent'
      const mappedKind: TranscriptItem['kind'] =
        kind === 'system' ? 'system' :
        kind === 'stdout' || kind === 'stderr' ? 'agent' :
        kind === 'user' ? 'user' : 'agent'

      // Create a stable-ish dedup ID from content + kind
      const dedupId = `ws-${kind}-${chunk.length}-${chunk.substring(0, 40)}`

      // Don't add if we've seen it in history or already added
      if (!seenIds.current.has(dedupId)) {
        seenIds.current.add(dedupId)
        if (chunk.trim()) {
          wsItems.push({
            id: dedupId,
            content: chunk,
            kind: mappedKind,
            timestamp: new Date().toISOString(),
            source: 'ws',
          })
        }
      }
    }
  }

  // Combine history + WS items
  const answeredQuestionAnswers = new Map<string, any>()
  messages.filter((message) => message.type === 'AgentEvent').forEach((message) => {
    const event = message.payload?.event as { kind?: string; payload?: Record<string, unknown> } | undefined
    if (event?.kind === 'question_answered') answeredQuestionAnswers.set(String(event.payload?.question_id || ''), event.payload)
  })
  const allItems = [...history, ...wsItems].map((item) => {
    if (item.kind === 'question' && item.question) {
      const answer = answeredQuestionAnswers.get(item.question.question_id)
      if (answer) return { ...item, question: { ...item.question, status: 'answered', selected_options: Array.isArray(answer.selected_options) ? answer.selected_options.map(String) : [], custom_text: typeof answer.custom_text === 'string' ? answer.custom_text : undefined } }
    }
    return item
  })

  // Deduplicate by id
  const seen = new Set<string>()
  const items = allItems.filter(item => {
    if (seen.has(item.id)) return false
    seen.add(item.id)
    return true
  }).filter((item, index, all) => {
    const previous = all[index - 1]
    return !(item.kind === 'agent' && previous?.kind === 'user' && normalizedText(item.content) === normalizedText(previous.content))
  }).filter((item) => item.kind === 'question' || item.content.trim())

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight
    }
  }, [items.length])

  if (loading) {
    return (
      <div className="flex-1 flex items-center justify-center text-text-dim text-xs">
        Loading conversation history...
      </div>
    )
  }

  return (
    <div
      ref={scrollRef}
      className="flex-1 overflow-auto p-4 space-y-2"
    >
      {items.length === 0 ? (
        <div className="flex items-center justify-center h-full text-text-dim text-xs">
          <span>Send a message to start the conversation</span>
        </div>
      ) : (
          items.map((item) => (
          <div key={item.id} className={`flex ${alignClass(item.kind)}`}>
            {item.kind === 'question' && item.question ? <QuestionCard question={item.question} onAnswer={(answer) => { const sent = sendMessage({ type: 'QuestionAnswer', payload: { answer } }); if (!sent) throw new Error('Connection is unavailable') }} /> :
            item.kind === 'activity' ? renderActivity(item) :
            item.kind === 'system' || item.kind === 'error' ? (
              <div className={`
                inline-flex max-w-[85%] items-center gap-2 rounded-full border px-3 py-1.5 text-[11px] font-medium
                ${item.kind === 'error' ? 'border-error/25 bg-error/10 text-error' : 'border-border bg-surface-hover text-text-muted'}
              `}>
                {item.kind === 'error' && <AlertCircle className="h-3 w-3 shrink-0" />}
                <span>{item.content}</span>
              </div>
            ) : (
            <div
              className={`
                max-w-[80%] rounded-2xl border px-3.5 py-2.5 shadow-sm
                ${kindStyle(item.kind)}
              `}
            >
              <div className={`text-sm leading-relaxed ${textStyle(item.kind)}`}>
                {renderMessageContent(item.content)}
              </div>
              <div className={`mt-1.5 text-[10px] opacity-50 ${textStyle(item.kind)}`}>
                {new Date(item.timestamp).toLocaleTimeString()}
              </div>
            </div>)}
          </div>
        ))
      )}
    </div>
  )
}

/** Renders user/agent message content, lifting fenced code blocks out of the bubble. */
function renderMessageContent(content: string) {
  const blocks = content.split(/```/)
  return blocks.map((block, index) => {
    if (index % 2 === 1) {
      const lines = block.split('\n')
      const language = lines[0]?.trim() || 'code'
      const code = lines.slice(1).join('\n')
      const looksLikePath = language.includes('.')
      return (
        <CodeBlock
          key={index}
          filename={looksLikePath ? language : undefined}
          language={looksLikePath ? undefined : language}
          code={code}
        />
      )
    }
    if (!block.trim()) return null
    return <p key={index} className="whitespace-pre-wrap break-words">{block}</p>
  })
}

/** Renders a semantic activity event as Thinking / ToolActivityRow / completion pill. */
function renderActivity(item: TranscriptItem) {
  const event = item.event
  if (!event) {
    return (
      <div className="inline-flex items-center gap-2 rounded-full border border-border bg-surface-hover px-3 py-1.5 text-[11px] text-text-muted">
        {item.content}
      </div>
    )
  }

  if (event.kind === 'thinking_started' || event.kind === 'thinking_finished') {
    const payload = event.payload || {}
    const subject = typeof payload.subject === 'string' ? payload.subject : 'Reasoning about the task'
    const seconds = typeof event.duration_ms === 'number' ? Number((event.duration_ms / 1000).toFixed(1)) : undefined
    const done = event.kind === 'thinking_finished'
    return (
      <div className="w-full max-w-[85%]">
        <Thinking
          seconds={seconds}
          defaultOpen={done}
          steps={[{ label: subject, kind: 'step', done }]}
        />
      </div>
    )
  }

  if (event.kind === 'agent_completed') {
    const seconds = typeof event.duration_ms === 'number' ? ` · ${(event.duration_ms / 1000).toFixed(1)}s` : ''
    return (
      <div className="inline-flex items-center gap-1.5 rounded-full border border-success/25 bg-success/10 px-3 py-1.5 text-[11px] font-medium text-success">
        <Check className="h-3 w-3" />Done{seconds}
      </div>
    )
  }

  const tool = activityEventToTool(event)
  if (tool) {
    return (
      <div className="w-full max-w-[85%]">
        <ToolActivityRow item={tool} index={0} />
      </div>
    )
  }

  return (
    <div className="inline-flex items-center gap-2 rounded-full border border-border bg-surface-hover px-3 py-1.5 text-[11px] text-text-muted">
      {item.content}
    </div>
  )
}

function activityLabel(event: any): string {
  const payload = event.payload || {}
  const duration = typeof event.duration_ms === 'number' ? ` · ${(event.duration_ms / 1000).toFixed(1)}s` : ''
  if (event.kind === 'file_edited') return `Edited ${payload.path || 'file'}`
  if (event.kind === 'agent_completed') return `Worked${duration}`
  if (event.kind === 'thinking_started') return 'Thinking'
  if (event.kind === 'thinking_finished') return `Thought${duration}`
  if (event.kind === 'search_started') return `Explore · ${payload.query || 'search'}`
  if (event.kind === 'search_finished') return `Explore · ${payload.result_count || 0} results${duration}`
  if (event.kind === 'command_started' || event.kind === 'command_finished') return `$ ${payload.command || 'command'}${duration}`
  return `${event.kind.replace(/_/g, ' ')}${duration}`
}
