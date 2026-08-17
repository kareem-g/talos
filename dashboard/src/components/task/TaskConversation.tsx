import { useMemo } from 'react'
import {
  ActionBarPrimitive,
  AuiIf,
  AssistantRuntimeProvider,
  MessagePrimitive,
  ThreadPrimitive,
  generateId,
  useExternalStoreRuntime,
  useThreadViewport,
  type AttachmentAdapter,
  type CompleteAttachment,
  type DataMessagePart,
  type PendingAttachment,
  type TextMessagePart,
  type ThreadMessageLike,
} from '@assistant-ui/react'
import { Bot, Copy, Loader2 } from 'lucide-react'
import { api } from '../../lib/api'
import { buildThreadMessages } from '../../lib/taskMessages'
import type { ChatItem } from '../../lib/chatItems'
import type { MobileAgentEvent, MobileAgentModel, MobileApproval, MobileQuestion } from '../../types/mobile'
import { TaskComposer } from './TaskComposer'
import {
  TaskActivityDataPart,
  TaskApprovalDataPart,
  TaskDataFallback,
  TaskDiffDataPart,
  TaskEmptyPart,
  TaskPlanDataPart,
  TaskQuestionDataPart,
  TaskReasoningPart,
  TaskSystemDataPart,
  TaskTextPart,
  TaskToolCallPart,
  TaskInteractionContext,
} from './taskParts'
import { MessageStreamingDuration } from '../status/StreamingStatus'

/**
 * The streaming conversation host for a mobile task.
 *
 * All history + live WebSocket frames are folded into ThreadMessages (see
 * lib/taskMessages) and pushed into an external-store assistant-ui runtime.
 * The runtime reconciles incrementally: the newest assistant message grows
 * text chunk by chunk, tool-call parts resolve in place, and the thread
 * reacts the moment a frame arrives.
 */

interface TaskConversationProps {
  taskId: string
  items: ChatItem[]
  rawEvents: Map<string, MobileAgentEvent>
  optimisticMessages: Array<{ id: string; content: string; timestamp: string }>
  working: boolean
  /** True right after Send, before the backend confirms the run — renders the
   *  ✦ Thinking… placeholder immediately. */
  optimisticRunning?: boolean
  streamingId: string | null
  pendingApprovals: MobileApproval[]
  pendingQuestions: MobileQuestion[]
  resolvedDecisionById: Map<string, string>
  connection: 'connected' | string
  error: string | null
  ended: boolean
  agentLabel: string
  models: MobileAgentModel[]
  reasoningLevels: string[]
  supportsModelSwitch: boolean
  supportsEffort: boolean
  onSend: (text: string, attachments: Array<{ ref: string; fileName: string }>) => boolean
  onStop: () => void
  onModelCommand: (command: string) => void
  onOpenContext: () => void
  onRetry: () => void
  onQuestionAnswer: (answer: {
    question_id: string
    session_id: string
    selected_options: string[]
    custom_text: string | null
  }) => void
  onResolveApproval: (approval: MobileApproval, decision: string) => void
}

const userParts = {
  Text: ({ text }: { text?: string }) => (
    <p className="whitespace-pre-wrap break-words text-[13.5px] leading-6 text-ink">{text}</p>
  ),
}
const assistantParts = {
  Text: TaskTextPart,
  Reasoning: TaskReasoningPart,
  tools: {
    by_name: { bash: TaskToolCallPart },
    Fallback: TaskToolCallPart,
  },
  data: {
    by_name: {
      'agent-diff': TaskDiffDataPart,
      'agent-plan': TaskPlanDataPart,
      'agent-system': TaskSystemDataPart,
      'agent-activity': TaskActivityDataPart,
      'agent-thinking-chip': TaskActivityDataPart,
      'agent-approval': TaskApprovalDataPart,
      'agent-question': TaskQuestionDataPart,
    },
    Fallback: TaskDataFallback,
  },
  Empty: TaskEmptyPart,
}

function createTaskAttachmentAdapter(sessionId: string): AttachmentAdapter {
  return {
    accept: '*/*',
    add: async ({ file }: { file: File }): Promise<PendingAttachment> => ({
      id: generateId(),
      type: 'file',
      name: file.name,
      contentType: file.type,
      file,
      status: { type: 'running', reason: 'uploading', progress: 0 },
    }),
    send: async (attachment: PendingAttachment): Promise<CompleteAttachment> => {
      const result = await api.attachments.upload(sessionId, attachment.file)
      const uploaded = result.attachments?.[0]
      if (!uploaded) throw new Error('Upload failed')
      return {
        ...attachment,
        status: { type: 'complete' },
        content: [{ type: 'data', name: 'agentdeck-attachment', data: { ref: uploaded.ref, fileName: uploaded.fileName } }],
      }
    },
    remove: async () => {},
  }
}

export function TaskConversation(props: TaskConversationProps) {
  const {
    taskId,
    items,
    rawEvents,
    optimisticMessages,
    working,
    optimisticRunning = false,
    streamingId,
    pendingApprovals,
    pendingQuestions,
    resolvedDecisionById,
    connection,
    error,
    ended,
    agentLabel,
    models,
    reasoningLevels,
    supportsModelSwitch,
    supportsEffort,
    onSend,
    onStop,
    onModelCommand,
    onOpenContext,
    onRetry,
    onQuestionAnswer,
    onResolveApproval,
  } = props

  const pendingApprovalIds = useMemo(
    () => new Set(pendingApprovals.map((a) => a.id)),
    [pendingApprovals],
  )
  const pendingQuestionIds = useMemo(
    () => new Set(pendingQuestions.map((q) => q.question_id)),
    [pendingQuestions],
  )
  const optimistic = useMemo(
    () => optimisticMessages.map((entry) => ({ id: entry.id, content: entry.content })),
    [optimisticMessages],
  )

  const messages: ThreadMessageLike[] = useMemo(
    () =>
      buildThreadMessages({
        items,
        optimistic,
        working,
        optimisticRunning,
        streamingId,
        pendingApprovalIds,
        pendingQuestionIds,
        resolvedDecisionById,
        rawEvents,
      }),
    [items, optimistic, working, optimisticRunning, streamingId, pendingApprovalIds, pendingQuestionIds, resolvedDecisionById, rawEvents],
  )

  const attachmentAdapter = useMemo(() => createTaskAttachmentAdapter(taskId), [taskId])

  const runtime = useExternalStoreRuntime({
    messages,
    isRunning: working,
    convertMessage: (message) => message,
    adapters: { attachments: attachmentAdapter },
    isDisabled: ended,
    isSendDisabled: !ended && connection !== 'connected',
    onNew: async (message) => {
      const text = (message.content || [])
        .filter((part): part is TextMessagePart => part.type === 'text')
        .map((part) => part.text)
        .join('')
        .trim()
      const refs = (message.attachments || [])
        .flatMap((attachment) => attachment.content || [])
        .filter((part): part is DataMessagePart => part.type === 'data')
        .filter((part) => part.name === 'agentdeck-attachment')
        .map((part) => part.data as { ref: string; fileName: string })
      if (!onSend(text, refs)) {
        throw new Error('Unable to send message. Reconnect to the desktop and try again.')
      }
    },
    onCancel: async () => {
      onStop()
    },
  })

  return (
    <TaskInteractionContext.Provider value={{ onQuestionAnswer, onResolveApproval }}>
      <AssistantRuntimeProvider runtime={runtime}>
        <div className="relative flex flex-1 flex-col overflow-hidden">
          <ThreadPrimitive.Root className="flex min-h-0 flex-1 flex-col">
            <ThreadPrimitive.Viewport className="ai-scroll-thin min-h-0 flex-1 overflow-y-auto px-4 pb-6 pt-4">
              <div className="mx-auto flex w-full max-w-lg flex-col gap-3 lg:max-w-2xl">
                {connection !== 'connected' && (
                  <ConnectionNote connection={connection} onRetry={onRetry} />
                )}
                {error && (
                  <p className="rounded-card border border-red/25 bg-red-tint px-3 py-2 text-[11.5px] text-red">{error}</p>
                )}

                <ThreadPrimitive.If empty>
                  <div className="flex flex-col items-center justify-center gap-3 py-14 text-center">
                    <div className="flex size-12 items-center justify-center rounded-2xl bg-accent-tint shadow-hairline">
                      <Bot className="h-6 w-6 text-accent" />
                    </div>
                    <p className="text-[15px] font-medium text-ink">What can I help you with?</p>
                    <p className="max-w-70 text-[12.5px] leading-5 text-ink-3">
                      Send a message to start the agent on this task.
                    </p>
                  </div>
                </ThreadPrimitive.If>

                <ThreadPrimitive.Messages>
                  {({ message }) => (
                    <>
                      {message.role === 'user' ? (
                        <UserMessage key={message.id} />
                      ) : (
                        <AssistantMessage key={message.id} />
                      )}
                    </>
                  )}
                </ThreadPrimitive.Messages>
              </div>
              <JumpToLatest />
            </ThreadPrimitive.Viewport>

            <div className="shrink-0 rounded-t-card border-t border-line bg-surface p-3 pb-[calc(env(safe-area-inset-bottom)+12px)]">
              <div className="mx-auto w-full max-w-lg lg:max-w-2xl">
                <TaskComposer
                  disabled={ended}
                  working={working}
                  offline={connection !== 'connected'}
                  agentLabel={agentLabel}
                  models={models}
                  reasoningLevels={reasoningLevels}
                  supportsModelSwitch={supportsModelSwitch}
                  supportsEffort={supportsEffort}
                  onModelCommand={onModelCommand}
                  onOpenContext={onOpenContext}
                />
              </div>
            </div>
          </ThreadPrimitive.Root>
        </div>
      </AssistantRuntimeProvider>
    </TaskInteractionContext.Provider>
  )
}

function UserMessage() {
  return (
    <MessagePrimitive.Root className="flex justify-end">
      <div className="max-w-[85%] rounded-[20px] rounded-br-[6px] bg-hover px-4 py-2.5 shadow-hairline">
        <MessagePrimitive.Content components={userParts} />
      </div>
    </MessagePrimitive.Root>
  )
}

function AssistantMessage() {
  return (
    <MessagePrimitive.Root className="flex min-w-0 gap-2.5">
      <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full bg-accent-tint">
        <Bot className="h-3.5 w-3.5 text-accent" />
      </div>
      <div className="flex min-w-0 flex-1 flex-col gap-2.5">
        <MessagePrimitive.Content components={assistantParts} />
        <MessageStreamingDuration />
        <AuiIf condition={(s) => s.message.status?.type === 'complete'}>
          <ActionBarPrimitive.Root className="flex h-6 items-center gap-1 self-start text-ink-3">
            <ActionBarPrimitive.Copy
              aria-label="Copy response"
              className="flex items-center gap-1 rounded-full border border-line bg-surface px-2.5 py-1 text-[10.5px] font-medium text-ink-2 shadow-hairline transition-colors hover:bg-hover-2 hover:text-ink"
            >
              <Copy className="h-3 w-3" />
              Copy
            </ActionBarPrimitive.Copy>
          </ActionBarPrimitive.Root>
        </AuiIf>
      </div>
    </MessagePrimitive.Root>
  )
}

/**
 * "↓ Jump to latest" pill: appears only when the user has scrolled up away
 * from the bottom while the conversation is streaming. Clicking it smoothly
 * returns to the newest message. assistant-ui tracks `isAtBottom`, so this
 * never fights the user's deliberate scroll position.
 */
function JumpToLatest() {
  const isAtBottom = useThreadViewport((state) => state.isAtBottom)
  const scrollToBottom = useThreadViewport((state) => state.scrollToBottom)
  if (isAtBottom) return null
  return (
    <button
      type="button"
      onClick={() => scrollToBottom({ behavior: 'smooth' })}
      className="sticky bottom-3 z-10 mx-auto flex items-center gap-1.5 rounded-chip border border-line bg-surface px-3 py-1.5 text-[11px] font-medium text-ink-2 shadow-overlay transition-colors hover:bg-hover-2 hover:text-ink"
    >
      <span aria-hidden="true">↓</span>
      Jump to latest
    </button>
  )
}

function ConnectionNote({ connection, onRetry }: { connection: string; onRetry: () => void }) {
  if (connection === 'connected') return null
  return (
    <button
      type="button"
      onClick={onRetry}
      className="flex w-full items-center justify-center gap-1.5 rounded-chip border border-line bg-surface px-3 py-1.5 text-[11px] text-orange shadow-hairline"
    >
      <Loader2 className="h-3 w-3 animate-spin" /> Reconnecting — {connection}. Tap to retry.
    </button>
  )
}
