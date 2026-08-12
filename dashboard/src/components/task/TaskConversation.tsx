import { useMemo } from 'react'
import {
  ActionBarPrimitive,
  AuiIf,
  AssistantRuntimeProvider,
  MessagePrimitive,
  ThreadPrimitive,
  generateId,
  useExternalStoreRuntime,
  type AttachmentAdapter,
  type CompleteAttachment,
  type DataMessagePart,
  type PendingAttachment,
  type TextMessagePart,
  type ThreadMessageLike,
} from '@assistant-ui/react'
import { Bot, Loader2 } from 'lucide-react'
import { api } from '../../lib/api'
import { buildThreadMessages } from '../../lib/taskMessages'
import type { ChatItem } from '../../lib/chatItems'
import type { MobileAgentEvent, MobileAgentModel, MobileApproval, MobileQuestion } from '../../types/mobile'
import { TaskComposer } from './TaskComposer'
import {
  TaskActivityDataPart,
  TaskDataFallback,
  TaskDiffDataPart,
  TaskEmptyPart,
  TaskPlanDataPart,
  TaskReasoningPart,
  TaskSystemDataPart,
  TaskTextPart,
  TaskToolCallPart,
  TaskInteractionContext,
} from './taskParts'

/**
 * The streaming conversation host for a mobile task.
 *
 * All history + live WebSocket frames are folded into ThreadMessages (see
 * lib/taskMessages) and pushed into an external-store assistant-ui runtime.
 * The runtime reconciles incrementally: the newest assistant message grows
 * text chunk by chunk, tool-call parts resolve in place, and the thread
 * reacts the moment a frame arrives — no "wait until the process finishes".
 */

interface TaskConversationProps {
  taskId: string
  items: ChatItem[]
  rawEvents: Map<string, MobileAgentEvent>
  optimisticMessages: Array<{ id: string; content: string; timestamp: string }>
  working: boolean
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

  const pendingApprovalIds = useMemo(() => new Set(pendingApprovals.map((approval) => approval.id)), [pendingApprovals])
  const pendingQuestionIds = useMemo(() => new Set(pendingQuestions.map((question) => question.question_id)), [pendingQuestions])
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
        streamingId,
        pendingApprovalIds,
        pendingQuestionIds,
        resolvedDecisionById,
        rawEvents,
      }),
    [items, optimistic, working, streamingId, pendingApprovalIds, pendingQuestionIds, resolvedDecisionById, rawEvents],
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
            <div className="mx-auto flex w-full max-w-lg flex-col gap-3">
              {connection !== 'connected' && (
                <ConnectionNote connection={connection} onRetry={onRetry} />
              )}
              {error && (
                <p className="rounded-card border border-red/25 bg-red-tint px-3 py-2 text-[11.5px] text-red">{error}</p>
              )}
              <ThreadPrimitive.Empty>
                <div className="flex min-h-[45vh] flex-col items-center justify-center text-center">
                  <div className="flex size-11 items-center justify-center rounded-card border border-line bg-surface shadow-card">
                    <Bot className="h-5 w-5 text-accent" />
                  </div>
                  <p className="mt-4 text-[13.5px] font-medium text-ink">Start the conversation</p>
                  <p className="mt-1 max-w-xs text-[11.5px] leading-5 text-ink-3">
                    Send a message and the agent's thinking, tool calls and results will stream here as they happen.
                  </p>
                </div>
              </ThreadPrimitive.Empty>
              <ThreadPrimitive.Messages components={{ UserMessage, AssistantMessage }} />
            </div>
          </ThreadPrimitive.Viewport>
        </ThreadPrimitive.Root>

          <div className="sticky bottom-0 z-20 border-t border-line bg-canvas/95 px-3 pt-2 backdrop-blur-xl" style={{ paddingBottom: 'calc(env(safe-area-inset-bottom) + 10px)' }}>
          <div className="mx-auto flex w-full max-w-lg flex-col gap-1.5">
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
        </div>
      </AssistantRuntimeProvider>
    </TaskInteractionContext.Provider>
  )
}

function UserMessage() {
  return (
    <MessagePrimitive.Root className="flex justify-end">
      <div className="max-w-[85%] rounded-card rounded-br-[6px] bg-hover px-3.5 py-2.5 shadow-hairline">
        <MessagePrimitive.Content components={userParts} />
      </div>
    </MessagePrimitive.Root>
  )
}

function AssistantMessage() {
  return (
    <MessagePrimitive.Root className="flex min-w-0">
      <div className="flex min-w-0 flex-1 flex-col gap-2.5">
        <MessagePrimitive.Content components={assistantParts} />
        <AuiIf condition={(state) => state.message.status?.type === 'complete'}>
          <ActionBarPrimitive.Root className="flex h-6 items-center gap-1 self-end text-ink-3">
            <ActionBarPrimitive.Copy
              aria-label="Copy response"
              className="rounded-control px-2 py-1 text-[10px] transition-colors hover:bg-hover hover:text-ink"
            >
              Copy
            </ActionBarPrimitive.Copy>
          </ActionBarPrimitive.Root>
        </AuiIf>
      </div>
    </MessagePrimitive.Root>
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
