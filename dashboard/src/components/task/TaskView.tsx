import { useMemo, useState } from 'react'
import { Bot } from 'lucide-react'
import { useSessionChat } from '../../hooks/useSessionChat'
import { eventIndexByItemId } from '../../lib/taskMessages'
import LoadingState from '../beautiful/LoadingState'
import { ResumeSession } from '../ResumeSession'
import { assessResumable } from '../../lib/resume'
import { TaskConversation } from './TaskConversation'

/**
 * Desktop task view. Hosts the same TaskConversation used by the mobile task
 * screen so the semantic timeline, composer, action zone and streaming behave
 * identically on desktop. Session state comes from useSessionChat (persisted
 * history + live desktop WebSocket frames); the opt-in terminal debug view
 * stays a side view so raw PTY output never leaks into the conversation.
 */
export function TaskView({ sessionId }: { sessionId: string }) {
  const chat = useSessionChat(sessionId)
  const { items, working, ended, rawOutput } = chat
  const resume = assessResumable(
    chat.status,
    chat.session?.agent,
    chat.session?.resume_command,
    items,
    rawOutput,
  )
  const [debug, setDebug] = useState(false)
  const [stopping, setStopping] = useState(false)

  const rawEvents = useMemo(
    () => eventIndexByItemId(chat.historyEvents, chat.liveEvents),
    [chat.historyEvents, chat.liveEvents],
  )

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

  const stopSession = async () => {
    if (stopping) return
    setStopping(true)
    try {
      await fetch(`/api/sessions/${sessionId}/kill`, { method: 'POST' })
    } catch (error) {
      console.error('[AgentDeck][Task] Stop failed:', error)
    } finally {
      setStopping(false)
    }
  }

  if (chat.loading && items.length === 0) {
    return (
      <div className="flex min-w-0 flex-1 items-center justify-center">
        <LoadingState label="Loading" variant="Dots" showElapsed={false} />
      </div>
    )
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      {debug ? (
        <div className="ai-scroll-thin flex-1 overflow-y-auto px-4 pb-4 pt-4">
          <DebugView rawOutput={rawOutput} />
        </div>
      ) : (
        <>
          {resume.showResume && (
            <ResumeSession
              sessionId={sessionId}
              resumeCommand={resume.resumeCommand?.replace('<session>', sessionId)}
            />
          )}
          <TaskConversation
          taskId={sessionId}
          items={items}
          rawEvents={rawEvents}
          optimisticMessages={chat.optimisticMessages}
          optimisticRunning={chat.optimisticRunning}
          working={working}
          streamingId={streamingId}
          pendingApprovals={chat.pendingApprovals}
          pendingQuestions={chat.pendingQuestions}
          resolvedDecisionById={chat.resolvedDecisionById}
          connection={chat.connected ? 'connected' : 'disconnected'}
          error={null}
          ended={ended}
          agentLabel={chat.session?.agent || 'agent'}
          models={chat.agentMeta.models}
          reasoningLevels={chat.agentMeta.reasoningLevels}
          supportsModelSwitch={chat.agentMeta.supportsModelSwitch}
          supportsEffort={chat.agentMeta.supportsEffort}
          onSend={(text, attachments) => {
            const note = attachments.length
              ? `\n[attachments: ${attachments.map((attachment) => attachment.fileName).join(', ')}]`
              : ''
            return chat.sendText(text + note)
          }}
          onStop={stopSession}
          onModelCommand={(command) => {
            // Real mid-task config switch: typed into the running CLI at its
            // prompt, mirroring the mobile task screen.
            if (!chat.ended) void chat.sendText(command)
          }}
          onOpenContext={() => {}}
          onRetry={() => {}}
          onQuestionAnswer={chat.answerQuestion}
          onResolveApproval={chat.resolveApproval}
        />
        </>
      )}
      <div className="flex h-8 shrink-0 items-center justify-between border-t border-line bg-canvas/95 px-4 backdrop-blur-xl">
        <span className="flex items-center gap-1.5 text-[10.5px] text-ink-3">
          <Bot className="h-3 w-3" />
          {working ? 'Streaming live from the agent' : ended ? 'Read-only history' : 'Ready'}
        </span>
        <button
          type="button"
          onClick={() => setDebug((value) => !value)}
          className="animated-underline text-[10.5px] text-ink-3 transition-colors hover:text-ink"
        >
          {debug ? 'Back to chat' : 'Terminal debug'}
        </button>
      </div>
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
