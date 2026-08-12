import { useEffect, useMemo, useRef, useState } from 'react'
import { AlertCircle, Bot, ChevronDown } from 'lucide-react'
import { useSessionChat } from '../hooks/useSessionChat'
import {
  ApprovalBlock,
  ChatItemBlock,
  QuestionBlock,
  ToolRun,
  groupBlocks,
} from './chat/blocks'
import LoadingState from './beautiful/LoadingState'
import PromptBar from './beautiful/PromptBar'

/**
 * Desktop chat. Renders the semantic ChatItem timeline through the shared
 * Beautiful UI blocks (StreamingText, ThinkingState, ToolChips, DiffTable,
 * ApprovalCard, CodeBlock) in a readable centered column. Raw terminal
 * output never appears here — it stays behind the separate debug view.
 */
export function ChatView({ sessionId }: { sessionId: string }) {
  const chat = useSessionChat(sessionId)
  const { items, pendingApprovals, pendingQuestions, resolvedApprovals, working, ended, rawOutput } = chat
  const [debug, setDebug] = useState(false)
  const [isAtBottom, setIsAtBottom] = useState(true)
  const [newActivity, setNewActivity] = useState(false)
  const scrollRef = useRef<HTMLDivElement>(null)
  const lastCount = useRef(0)

  useEffect(() => {
    const element = scrollRef.current
    const grew = items.length > lastCount.current
    if (grew && isAtBottom && element) element.scrollTop = element.scrollHeight
    if (grew && !isAtBottom) setNewActivity(true)
    lastCount.current = items.length
  }, [items.length, isAtBottom])

  const handleScroll = () => {
    const element = scrollRef.current
    if (!element) return
    const atBottom = element.scrollHeight - element.scrollTop - element.clientHeight < 48
    setIsAtBottom(atBottom)
    if (atBottom) setNewActivity(false)
  }

  const blocks = useMemo(() => groupBlocks(items), [items])

  // The newest live assistant message streams while the agent is working.
  const streamingId = useMemo(() => {
    if (!working) return null
    for (let i = items.length - 1; i >= 0; i--) {
      const item = items[i]
      if (item.kind === 'agent' && item.id.startsWith('event-')) return item.id
      if (item.kind === 'user') return null
    }
    return null
  }, [items, working])

  const sendText = (text: string) => {
    const sent = chat.sendText(text)
    if (sent) {
      setIsAtBottom(true)
      requestAnimationFrame(() => {
        if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
      })
    }
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <div ref={scrollRef} onScroll={handleScroll} className="ai-scroll-thin relative flex-1 overflow-y-auto">
        <div className="mx-auto w-full max-w-[48rem] px-4 pb-6 pt-6 sm:px-6">
          {chat.loading && items.length === 0 ? (
            <div className="flex min-h-[50vh] items-center justify-center">
              <LoadingState label="Loading" variant="Dots" showElapsed={false} />
            </div>
          ) : debug ? (
            <DebugView rawOutput={rawOutput} />
          ) : items.length === 0 && !working && pendingQuestions.length === 0 && pendingApprovals.length === 0 ? (
            <EmptyState />
          ) : (
            <div className="flex flex-col gap-4">
              {blocks.map((block) =>
                block.kind === 'tools' ? (
                  <ToolRun key={`run-${block.items[0].id}`} items={block.items} working={working} lastItemId={items[items.length - 1]?.id} />
                ) : (
                  <ChatItemBlock
                    key={block.item.id}
                    item={block.item}
                    streaming={block.item.id === streamingId}
                    working={working}
                    isLast={block.item.id === items[items.length - 1]?.id}
                    pendingApprovals={pendingApprovals}
                    resolvedApprovals={resolvedApprovals}
                  />
                ),
              )}
              {/* live questions + approvals anchor the bottom of the timeline */}
              {pendingQuestions.map((question) => (
                <QuestionBlock key={question.question_id} question={question} onAnswer={chat.answerQuestion} />
              ))}
              {pendingApprovals.map((approval) => (
                <ApprovalBlock key={approval.id} approval={approval} onResolve={(decision) => chat.resolveApproval(approval, decision)} />
              ))}
              {working && pendingApprovals.length === 0 && (
                <LoadingState label="Working" variant="Orbit" />
              )}
            </div>
          )}
          {newActivity && !debug && (
            <button
              type="button"
              onClick={() => {
                if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight
                setNewActivity(false)
              }}
              className="sticky bottom-2 left-1/2 mt-4 flex -translate-x-1/2 items-center gap-1.5 rounded-chip border border-line bg-surface px-3 py-1.5 text-[11.5px] font-medium text-ink shadow-raised"
            >
              <ChevronDown className="h-3.5 w-3.5" />
              New activity
            </button>
          )}
        </div>
      </div>

      {/* composer */}
      <div className="shrink-0 border-t border-line bg-canvas/95 px-4 py-3 backdrop-blur-xl">
        <div className="mx-auto flex w-full max-w-[48rem] flex-col gap-1.5">
          {!chat.connected && (
            <p className="flex items-center gap-1.5 text-[11.5px] text-orange">
              <AlertCircle className="h-3 w-3" /> Reconnecting to the desktop — messages will send once it is back.
            </p>
          )}
          {debug && (
            <p className="text-[11.5px] text-ink-3">Terminal debug view — raw output only shown here, never in the chat.</p>
          )}
          <div className="flex items-end gap-2">
            <div className="min-w-0 flex-1">
              <PromptBar
                variant="Rounded"
                placeholder={ended ? 'Session ended — create a new session' : working ? 'Send a follow-up…' : 'Message the agent…'}
                disabled={ended}
                onSend={sendText}
                onPlus={() => setDebug((value) => !value)}
                autoFocus
              />
            </div>
          </div>
          <div className="flex items-center justify-between px-1 text-[10.5px] text-ink-3">
            <button
              type="button"
              onClick={() => setDebug((value) => !value)}
              className="animated-underline text-ink-3 transition-colors hover:text-ink"
            >
              {debug ? 'Back to chat' : 'Terminal debug'}
            </button>
            <span>{working ? 'Follow-ups queue for this session' : ended ? 'Read-only history' : 'Enter to send · Shift+Enter for a new line'}</span>
          </div>
        </div>
      </div>
    </div>
  )
}

function EmptyState() {
  return (
    <div className="flex min-h-[50vh] flex-col items-center justify-center text-center">
      <div className="flex size-11 items-center justify-center rounded-card border border-line bg-surface shadow-card">
        <Bot className="h-5 w-5 text-accent" />
      </div>
      <p className="mt-4 text-[13.5px] font-medium text-ink">Start the conversation</p>
      <p className="mt-1 max-w-xs text-[12px] leading-5 text-ink-3">
        Send a message and the agent's thinking, tool calls and results will appear here as they happen.
      </p>
    </div>
  )
}

function DebugView({ rawOutput }: { rawOutput: string }) {
  return (
    <div className="rounded-card border border-line bg-inset p-3 shadow-card">
      <div className="mb-2 text-[10px] uppercase tracking-[0.14em] text-ink-3">Terminal / debug</div>
      {rawOutput ? (
        <pre className="max-h-[60vh] overflow-auto whitespace-pre-wrap break-all font-mono text-[11.5px] leading-5 text-ink-2">{rawOutput}</pre>
      ) : (
        <p className="py-8 text-center font-mono text-[11.5px] text-ink-3">No raw output captured for this session.</p>
      )}
    </div>
  )
}
